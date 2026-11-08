package com.dbviewer.app.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.function.Consumer;

/**
 * Streams a completion from the configured model vendor.
 *
 * <p>Ported from the standalone document chatbot's {@code src/llm.js}, and deliberately still a
 * plain HTTP call rather than three vendor SDKs. Only one operation is needed — stream a chat
 * completion — and the three providers between them need two request bodies and two stream
 * parsers, which is less code than the dependency declarations would be. It also keeps the set of
 * things that can break at one: a bad response is a bad response, not an SDK version.
 *
 * <p>Both wire formats are server-sent events, and both are consumed the same way: read the body
 * a line at a time as it arrives, keep the {@code data:} lines, and pull the text fragment out of
 * each frame. What differs is where the fragment lives. OpenAI-compatible providers put it at
 * {@code choices[0].delta.content} and end with a literal {@code [DONE]}; Anthropic puts it at
 * {@code delta.text} on a {@code content_block_delta} event and ends by closing the stream.
 *
 * <p>The body is read with a raw {@link InputStream} rather than {@code BodyHandlers.ofLines()}
 * so that the caller's {@link Consumer} is fed as each frame arrives. That is the whole point of
 * streaming here: the first words should reach the browser in a second, not the last ones in
 * thirty.
 */
@Slf4j
@Component
public class LlmClient {

    private static final String OPENROUTER_BASE = "https://openrouter.ai/api/v1";
    private static final String OPENAI_BASE = "https://api.openai.com/v1";
    private static final String ANTHROPIC_BASE = "https://api.anthropic.com/v1";

    /** The Messages API is versioned by header, and the header is not optional. */
    private static final String ANTHROPIC_VERSION = "2023-06-01";

    /**
     * The output-token ceiling for one answer.
     *
     * <p>It was 2,000, which was too low once providers began thinking by default: current
     * Claude models run adaptive thinking when no {@code thinking} field is sent, and thinking
     * tokens count against this limit. A schema summary could use up the budget while still
     * thinking and come back empty or cut off. The call streams, so a higher ceiling costs
     * nothing in timeouts; it only stops the model from being cut off. 8,192 fits within every
     * default model's output limit, which matters because some OpenRouter backends reject a
     * value above their own cap rather than clamping it.
     */
    @Value("${app.llm.max-tokens:8192}")
    private int maxTokens = 8192;

    /**
     * Sampling temperature, sent only when configured.
     *
     * <p>It used to be a hard-coded 0.2 on every request, and that broke the Anthropic path:
     * sampling parameters have been removed on the current Claude models (Sonnet 5, Sonnet 5.5,
     * Opus 5/5.5, Fable), which answer a request carrying {@code temperature} with HTTP 400.
     * OpenAI reasoning models reject it too. Omitting it is the only value that works
     * everywhere; set {@code app.llm.temperature} only for a model known to accept it.
     */
    @Value("${app.llm.temperature:#{null}}")
    private Double temperature;

    /**
     * Anthropic {@code output_config.effort} ({@code low}, {@code medium}, {@code high}...),
     * sent only when configured.
     *
     * <p>The cost lever for thinking models: {@code low} is plenty for schema questions. It is
     * opt-in because older models (Haiku 4.5, Sonnet 4.5) reject the field, and a user's own key
     * may name any model.
     */
    @Value("${app.llm.anthropic-effort:}")
    private String anthropicEffort;

    private final ObjectMapper json = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    /**
     * Base URLs, overridable per provider.
     *
     * <p>Not a test hook — a gateway is the normal way these APIs are consumed in an
     * organisation. Azure OpenAI, LiteLLM, an internal proxy that adds logging or a spend cap,
     * and OpenRouter's own enterprise endpoints all speak one of the two wire formats at a
     * different host. Hardcoding the vendor's public URL would mean such a deployment could not
     * use this feature at all.
     */
    @Value("${app.llm.openrouter-base-url:" + OPENROUTER_BASE + "}")
    private String openRouterBase;

    @Value("${app.llm.openai-base-url:" + OPENAI_BASE + "}")
    private String openAiBase;

    @Value("${app.llm.anthropic-base-url:" + ANTHROPIC_BASE + "}")
    private String anthropicBase;

    @Value("${app.llm.site-url:http://localhost:3000}")
    private String siteUrl;

    @Value("${app.llm.site-name:DB Viewer}")
    private String siteName;

    /**
     * Streams an answer, handing each text fragment to {@code onFragment} as it arrives.
     *
     * @return how much was streamed and why it stopped, so the caller can tell an empty, a
     *         truncated or a refused answer from a finished one; all four arrive as a perfectly
     *         successful HTTP response
     * @throws LlmException when the provider refuses, times out, or the stream carries an error
     */
    public StreamResult stream(LlmCredentials credentials, String system, List<ChatTurn> messages,
                               Consumer<String> onFragment) {
        HttpRequest request = buildRequest(credentials, system, messages);

        HttpResponse<InputStream> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            throw new LlmException("Could not reach " + credentials.provider().label()
                    + ". Check the server's network connection.", 0, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmException("The request was interrupted.", 0, e);
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new LlmException(describeFailure(response), response.statusCode());
        }

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
            return consume(reader, credentials.provider(), onFragment);
        } catch (IOException e) {
            throw new LlmException("The connection to " + credentials.provider().label()
                    + " dropped mid-answer.", 0, e);
        }
    }

    /* ------------------------------------------------------------------ *
     * Requests
     * ------------------------------------------------------------------ */

    private HttpRequest buildRequest(LlmCredentials credentials, String system,
                                     List<ChatTurn> messages) {
        boolean anthropic = credentials.provider() == LlmProvider.ANTHROPIC;
        String endpoint = switch (credentials.provider()) {
            case OPENROUTER -> trimSlash(openRouterBase) + "/chat/completions";
            case OPENAI -> trimSlash(openAiBase) + "/chat/completions";
            case ANTHROPIC -> trimSlash(anthropicBase) + "/messages";
        };

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(endpoint))
                .header("Content-Type", "application/json")
                // Generous, because it covers the whole answer and a long schema summary on a
                // slow model legitimately takes a while. It is still a cap: without one, a
                // provider that stops responding holds a request thread for ever.
                .timeout(Duration.ofSeconds(120))
                .POST(HttpRequest.BodyPublishers.ofString(
                        anthropic
                                ? anthropicBody(credentials, system, messages)
                                : openAiBody(credentials, system, messages),
                        StandardCharsets.UTF_8));

        if (anthropic) {
            builder.header("x-api-key", credentials.apiKey())
                    .header("anthropic-version", ANTHROPIC_VERSION);
        } else {
            builder.header("Authorization", "Bearer " + credentials.apiKey());
        }
        if (credentials.provider() == LlmProvider.OPENROUTER) {
            // OpenRouter attributes usage to these, and asks that callers send them.
            builder.header("HTTP-Referer", siteUrl).header("X-Title", siteName);
        }
        return builder.build();
    }

    /** So a base URL configured with or without a trailing slash behaves the same. */
    private String trimSlash(String base) {
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }

    String openAiBody(LlmCredentials credentials, String system, List<ChatTurn> messages) {
        ObjectNode body = json.createObjectNode();
        body.put("model", credentials.model());
        body.put("stream", true);
        if (temperature != null) {
            body.put("temperature", temperature);
        }
        // OpenAI renamed the field, and its reasoning models reject the old name outright.
        // OpenRouter still documents max_tokens and translates it per backend.
        body.put(credentials.provider() == LlmProvider.OPENAI ? "max_completion_tokens" : "max_tokens",
                maxTokens);

        ArrayNode array = body.putArray("messages");
        array.addObject().put("role", "system").put("content", system);
        for (ChatTurn turn : messages) {
            array.addObject().put("role", turn.role()).put("content", turn.content());
        }
        return body.toString();
    }

    String anthropicBody(LlmCredentials credentials, String system, List<ChatTurn> messages) {
        ObjectNode body = json.createObjectNode();
        body.put("model", credentials.model());
        body.put("stream", true);
        // No temperature unless explicitly configured: current Claude models reject sampling
        // parameters with a 400. See the field's comment.
        if (temperature != null) {
            body.put("temperature", temperature);
        }
        // Required by the Messages API, unlike the OpenAI one where it is optional.
        body.put("max_tokens", maxTokens);
        if (anthropicEffort != null && !anthropicEffort.isBlank()) {
            body.putObject("output_config").put("effort", anthropicEffort.trim());
        }
        // A top-level field rather than a message with role "system", which the Messages API
        // rejects outright.
        body.put("system", system);

        ArrayNode array = body.putArray("messages");
        for (ChatTurn turn : messages) {
            array.addObject().put("role", turn.role()).put("content", turn.content());
        }
        return body.toString();
    }

    /* ------------------------------------------------------------------ *
     * Streams
     * ------------------------------------------------------------------ */

    StreamResult consume(BufferedReader reader, LlmProvider provider, Consumer<String> onFragment)
            throws IOException {
        int streamed = 0;
        String stopReason = null;
        String rawLine;
        while ((rawLine = reader.readLine()) != null) {
            String line = rawLine.trim();
            // Blank lines separate frames; ":" lines are keep-alive comments, which OpenRouter
            // sends as ": OPENROUTER PROCESSING" while a slow model warms up. Both are noise.
            if (line.isEmpty() || line.startsWith(":") || !line.startsWith("data:")) {
                continue;
            }

            String payload = line.substring("data:".length()).trim();
            if ("[DONE]".equals(payload)) {
                break;
            }

            JsonNode frame;
            try {
                frame = json.readTree(payload);
            } catch (Exception e) {
                // A malformed frame is not worth failing the whole answer over.
                continue;
            }

            JsonNode error = frame.get("error");
            if (error != null && !error.isNull()) {
                String message = error.path("message").asText("The model returned an error.");
                throw new LlmException(message, error.path("code").asInt(502));
            }

            String reason = stopReasonOf(frame, provider);
            if (reason != null) {
                stopReason = reason;
            }

            String fragment = provider.isOpenAiCompatible()
                    ? frame.path("choices").path(0).path("delta").path("content").asText(null)
                    : textDeltaOf(frame);

            if (fragment != null && !fragment.isEmpty()) {
                streamed += fragment.length();
                onFragment.accept(fragment);
            }
        }
        return new StreamResult(streamed, stopReason);
    }

    /**
     * Why the model stopped, if this frame says.
     *
     * <p>Anthropic puts it on the {@code message_delta} event near the end of the stream.
     * OpenAI-compatible providers put {@code finish_reason} on the last choice delta, and send it
     * as JSON null on every frame before that.
     */
    private String stopReasonOf(JsonNode frame, LlmProvider provider) {
        JsonNode reason;
        if (provider.isOpenAiCompatible()) {
            reason = frame.path("choices").path(0).path("finish_reason");
        } else if ("message_delta".equals(frame.path("type").asText())) {
            reason = frame.path("delta").path("stop_reason");
        } else {
            return null;
        }
        if (reason.isMissingNode() || reason.isNull()) {
            return null;
        }
        String text = reason.asText();
        return text.isBlank() ? null : text;
    }

    /**
     * The text out of one Anthropic stream frame.
     *
     * <p>The Messages API interleaves several event types — {@code message_start},
     * {@code content_block_start}, {@code ping}, {@code message_delta} — and only
     * {@code content_block_delta} carries prose. Matching on the frame's own {@code type} rather
     * than the preceding {@code event:} line means the parser does not have to hold state
     * between lines.
     */
    private String textDeltaOf(JsonNode frame) {
        if (!"content_block_delta".equals(frame.path("type").asText())) {
            return null;
        }
        return frame.path("delta").path("text").asText(null);
    }

    /* ------------------------------------------------------------------ *
     * Errors
     * ------------------------------------------------------------------ */

    /** Pulls the provider's own explanation out of a failed response, falling back to the status. */
    private String describeFailure(HttpResponse<InputStream> response) {
        String body = "";
        try (InputStream stream = response.body()) {
            body = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            log.debug("Could not read the error body: {}", e.getMessage());
        }
        try {
            JsonNode parsed = json.readTree(body);
            String message = parsed.path("error").path("message").asText(null);
            if (message != null && !message.isBlank()) {
                return message;
            }
        } catch (Exception e) {
            // Not JSON. The raw body, trimmed, is still better than nothing.
        }
        return body.isBlank()
                ? "HTTP " + response.statusCode()
                : body.substring(0, Math.min(300, body.length()));
    }
}
