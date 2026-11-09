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
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
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
     * Statuses worth one more try. Rate limits, an overloaded or restarting backend (529 is
     * Anthropic's "overloaded"), and gateway timeouts all clear by themselves within seconds;
     * a 400 or a 401 will be exactly as wrong the second time.
     */
    private static final Set<Integer> RETRYABLE = Set.of(408, 429, 500, 502, 503, 504, 529);

    /** Attempts after the first. Two keeps a user waiting at most a few seconds before an error. */
    private static final int MAX_RETRIES = 2;

    /**
     * OpenRouter's refusal when a key's credit cannot cover the requested {@code max_tokens}:
     * "This request requires more credits, or fewer max_tokens. You requested up to 8192 tokens,
     * but can only afford 2025." The number is what to ask for instead.
     */
    private static final java.util.regex.Pattern CAN_ONLY_AFFORD =
            java.util.regex.Pattern.compile("can only afford (\\d+)", java.util.regex.Pattern.CASE_INSENSITIVE);

    /**
     * Below this, retrying with what the account can afford is not worth it: the answer would be
     * cut off almost at once, especially by a model that thinks before it writes.
     */
    static final int MIN_AFFORDABLE_TOKENS = 512;

    /** The longest a {@code Retry-After} is honoured. Anything longer is better reported than waited on. */
    private static final long MAX_RETRY_WAIT_MS = 10_000;

    /**
     * OpenRouter models that need an explicit {@code cache_control} breakpoint to cache a prompt.
     * OpenAI, DeepSeek and most others behind OpenRouter cache a repeated prefix automatically;
     * Anthropic and Gemini models only cache what is marked.
     */
    private static final List<String> EXPLICIT_CACHE_PREFIXES = List.of("anthropic/", "google/");

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
    private String anthropicEffort = "";

    private final ObjectMapper json = new ObjectMapper();

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    /** How a retry waits. A field so tests can count the waits instead of sitting through them. */
    private Sleeper sleeper = Thread::sleep;

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
    private String openRouterBase = OPENROUTER_BASE;

    @Value("${app.llm.openai-base-url:" + OPENAI_BASE + "}")
    private String openAiBase = OPENAI_BASE;

    @Value("${app.llm.anthropic-base-url:" + ANTHROPIC_BASE + "}")
    private String anthropicBase = ANTHROPIC_BASE;

    @Value("${app.llm.site-url:http://localhost:3000}")
    private String siteUrl = "http://localhost:3000";

    @Value("${app.llm.site-name:DB Viewer}")
    private String siteName = "DB Viewer";

    @FunctionalInterface
    interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }

    /** Points every provider at one base URL, and replaces the retry wait. For tests only. */
    void useForTests(String baseUrl, Sleeper testSleeper) {
        this.openRouterBase = baseUrl;
        this.openAiBase = baseUrl;
        this.anthropicBase = baseUrl;
        this.sleeper = testSleeper;
    }

    /**
     * Streams an answer, handing each text fragment to {@code onFragment} as it arrives.
     *
     * <p>A temporary failure <em>before</em> the stream starts — a rate limit, an overloaded
     * backend, a dropped connection — is retried up to {@value #MAX_RETRIES} times with
     * jittered backoff, honouring {@code Retry-After}. Nothing is ever retried once a fragment has
     * been handed on: the user would see the start of the answer twice.
     *
     * @return how much was streamed, why it stopped, and what it cost, so the caller can tell an
     *         empty, a truncated or a refused answer from a finished one; all four arrive as a
     *         perfectly successful HTTP response
     * @throws LlmException when the provider refuses, times out, or the stream carries an error
     */
    public StreamResult stream(LlmCredentials credentials, SystemPrompt system,
                               List<ChatTurn> messages, Consumer<String> onFragment) {
        HttpResponse<InputStream> response;
        try {
            response = sendWithRetry(buildRequest(credentials, system, messages, maxTokens),
                    credentials.provider());
        } catch (LlmException e) {
            // A key whose remaining credit (or per-key limit) cannot cover the full max_tokens is
            // refused before the model runs, even though it could pay for a shorter answer. Ask
            // again for what it can afford: a shorter answer beats none, and if it does run out
            // the stop reason says so and the UI shows the answer was cut off.
            Integer affordable = affordableTokens(e, maxTokens);
            if (affordable == null) {
                throw e;
            }
            log.info("{} can only afford {} of {} max tokens; asking for {}",
                    credentials.provider().label(), affordable, maxTokens, affordable);
            response = sendWithRetry(buildRequest(credentials, system, messages, affordable),
                    credentials.provider());
        }

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(response.body(), StandardCharsets.UTF_8))) {
            return consume(reader, credentials.provider(), onFragment);
        } catch (IOException e) {
            throw new LlmException("The connection to " + credentials.provider().label()
                    + " dropped mid-answer.", 0, e);
        }
    }

    private HttpResponse<InputStream> sendWithRetry(HttpRequest request, LlmProvider provider) {
        for (int attempt = 0; ; attempt++) {
            boolean lastAttempt = attempt >= MAX_RETRIES;
            HttpResponse<InputStream> response;
            try {
                response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            } catch (IOException e) {
                if (lastAttempt) {
                    throw new LlmException("Could not reach " + provider.label()
                            + ". Check the server's network connection.", 0, e);
                }
                log.debug("{} unreachable (attempt {}), retrying: {}",
                        provider.label(), attempt + 1, e.getMessage());
                pause(backoffMillis(attempt, null));
                continue;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new LlmException("The request was interrupted.", 0, e);
            }

            int status = response.statusCode();
            if (status >= 200 && status < 300) {
                return response;
            }
            if (lastAttempt || !RETRYABLE.contains(status)) {
                throw new LlmException(describeFailure(response), status);
            }
            String retryAfter = response.headers().firstValue("retry-after").orElse(null);
            closeQuietly(response);
            log.info("{} answered {} (attempt {}), retrying", provider.label(), status, attempt + 1);
            pause(backoffMillis(attempt, retryAfter));
        }
    }

    /** 0.5s, then 1.5s, each with up to 250ms of jitter — or what the provider asked for, capped. */
    static long backoffMillis(int attempt, String retryAfter) {
        if (retryAfter != null) {
            try {
                long seconds = Long.parseLong(retryAfter.trim());
                return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_WAIT_MS);
            } catch (NumberFormatException ignored) {
                // An HTTP date. Rare from these APIs; the default backoff is a fine stand-in.
            }
        }
        long base = attempt == 0 ? 500 : 1500;
        return base + ThreadLocalRandom.current().nextLong(250);
    }

    private void pause(long millis) {
        try {
            sleeper.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LlmException("The request was interrupted.", 0, e);
        }
    }

    private void closeQuietly(HttpResponse<InputStream> response) {
        try (InputStream ignored = response.body()) {
            // Closing releases the connection back to the client's pool before the retry.
        } catch (IOException ignored) {
            // Already gone, which is what was wanted.
        }
    }

    /* ------------------------------------------------------------------ *
     * Requests
     * ------------------------------------------------------------------ */

    /**
     * The token budget an account says it can pay for, when a refusal names one worth using.
     *
     * @return null unless this is a 402 naming a number between {@link #MIN_AFFORDABLE_TOKENS}
     *         and what was asked for
     */
    static Integer affordableTokens(LlmException e, int requested) {
        if (e.getStatus() != 402 || e.getMessage() == null) {
            return null;
        }
        java.util.regex.Matcher m = CAN_ONLY_AFFORD.matcher(e.getMessage());
        if (!m.find()) {
            return null;
        }
        try {
            int affordable = Integer.parseInt(m.group(1));
            return affordable >= MIN_AFFORDABLE_TOKENS && affordable < requested ? affordable : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private HttpRequest buildRequest(LlmCredentials credentials, SystemPrompt system,
                                     List<ChatTurn> messages, int tokens) {
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
                                ? anthropicBody(credentials, system, messages, tokens)
                                : openAiBody(credentials, system, messages, tokens),
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

    String openAiBody(LlmCredentials credentials, SystemPrompt system, List<ChatTurn> messages) {
        return openAiBody(credentials, system, messages, maxTokens);
    }

    String openAiBody(LlmCredentials credentials, SystemPrompt system, List<ChatTurn> messages,
                      int tokens) {
        ObjectNode body = json.createObjectNode();
        body.put("model", credentials.model());
        body.put("stream", true);
        if (temperature != null) {
            body.put("temperature", temperature);
        }
        boolean openRouter = credentials.provider() == LlmProvider.OPENROUTER;
        // OpenAI renamed the field, and its reasoning models reject the old name outright.
        // OpenRouter still documents max_tokens and translates it per backend.
        body.put(openRouter ? "max_tokens" : "max_completion_tokens", tokens);

        // Ask for the token counts. Neither API sends them on a stream unless told to; OpenRouter
        // adds the price of the call, which is what the usage log is for.
        if (openRouter) {
            body.putObject("usage").put("include", true);
        } else {
            body.putObject("stream_options").put("include_usage", true);
        }

        ArrayNode array = body.putArray("messages");
        ObjectNode systemMessage = array.addObject().put("role", "system");
        if (openRouter && needsExplicitCacheBreakpoint(credentials.model())) {
            // Two content parts with the breakpoint on the schema, so everything up to the end of
            // the schema is cached. A plain string cannot carry a breakpoint at all.
            ArrayNode parts = systemMessage.putArray("content");
            parts.addObject().put("type", "text").put("text", system.instructions());
            ObjectNode schemaPart = parts.addObject().put("type", "text").put("text", system.schema());
            schemaPart.putObject("cache_control").put("type", "ephemeral");
        } else {
            // Static instructions first, then the schema: a stable prefix is all that automatic
            // caching needs.
            systemMessage.put("content", system.full());
        }
        for (ChatTurn turn : messages) {
            array.addObject().put("role", turn.role()).put("content", turn.content());
        }
        return body.toString();
    }

    static boolean needsExplicitCacheBreakpoint(String model) {
        String id = model == null ? "" : model.toLowerCase();
        return EXPLICIT_CACHE_PREFIXES.stream().anyMatch(id::startsWith);
    }

    String anthropicBody(LlmCredentials credentials, SystemPrompt system, List<ChatTurn> messages) {
        return anthropicBody(credentials, system, messages, maxTokens);
    }

    String anthropicBody(LlmCredentials credentials, SystemPrompt system, List<ChatTurn> messages,
                         int tokens) {
        ObjectNode body = json.createObjectNode();
        body.put("model", credentials.model());
        body.put("stream", true);
        // No temperature unless explicitly configured: current Claude models reject sampling
        // parameters with a 400. See the field's comment.
        if (temperature != null) {
            body.put("temperature", temperature);
        }
        // Required by the Messages API, unlike the OpenAI one where it is optional.
        body.put("max_tokens", tokens);
        if (anthropicEffort != null && !anthropicEffort.isBlank()) {
            body.putObject("output_config").put("effort", anthropicEffort.trim());
        }
        // A top-level field rather than a message with role "system", which the Messages API
        // rejects outright. Two blocks, with the cache breakpoint on the schema: the instructions
        // and the schema are the same on every turn about one file, so turn two reads them from
        // the prompt cache at a tenth of the price.
        ArrayNode systemBlocks = body.putArray("system");
        systemBlocks.addObject().put("type", "text").put("text", system.instructions());
        ObjectNode schemaBlock = systemBlocks.addObject().put("type", "text").put("text", system.schema());
        schemaBlock.putObject("cache_control").put("type", "ephemeral");

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
        UsageTally usage = new UsageTally();
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
            usage.read(frame, provider);

            String fragment = provider.isOpenAiCompatible()
                    ? frame.path("choices").path(0).path("delta").path("content").asText(null)
                    : textDeltaOf(frame);

            if (fragment != null && !fragment.isEmpty()) {
                streamed += fragment.length();
                onFragment.accept(fragment);
            }
        }
        return new StreamResult(streamed, stopReason, usage.toUsage());
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
     * Accumulates token counts across the frames that carry them.
     *
     * <p>Anthropic spreads them out: input and cache counts on {@code message_start}, the running
     * output count on {@code message_delta}. Its {@code input_tokens} excludes cached tokens, so
     * the total prompt is the sum of the three. OpenAI-compatible providers send one
     * {@code usage} object on a final chunk whose {@code choices} is empty.
     */
    private static final class UsageTally {
        long input;
        long output;
        long cached;
        Double cost;

        void read(JsonNode frame, LlmProvider provider) {
            if (provider.isOpenAiCompatible()) {
                JsonNode usage = frame.path("usage");
                if (!usage.isObject()) {
                    return;
                }
                input = usage.path("prompt_tokens").asLong(input);
                output = usage.path("completion_tokens").asLong(output);
                cached = usage.path("prompt_tokens_details").path("cached_tokens").asLong(cached);
                if (usage.path("cost").isNumber()) {
                    cost = usage.path("cost").asDouble();
                }
                return;
            }
            String type = frame.path("type").asText();
            if ("message_start".equals(type)) {
                JsonNode usage = frame.path("message").path("usage");
                long cacheRead = usage.path("cache_read_input_tokens").asLong(0);
                long cacheWrite = usage.path("cache_creation_input_tokens").asLong(0);
                input = usage.path("input_tokens").asLong(0) + cacheRead + cacheWrite;
                cached = cacheRead;
                output = usage.path("output_tokens").asLong(output);
            } else if ("message_delta".equals(type)) {
                output = frame.path("usage").path("output_tokens").asLong(output);
            }
        }

        Usage toUsage() {
            return new Usage(input, output, cached, cost);
        }
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
