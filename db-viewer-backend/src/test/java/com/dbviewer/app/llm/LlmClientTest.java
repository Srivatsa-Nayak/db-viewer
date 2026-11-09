package com.dbviewer.app.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.OutputStream;
import java.io.StringReader;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * What goes on the wire to the provider, and how its stream is read back.
 *
 * <p>Plain unit tests on a bare {@code new LlmClient()}: no Spring, and no real provider. The
 * request-body tests call the body builders directly; the end-to-end tests point the client at a
 * local {@link HttpServer} that answers the way a provider does. Configured values keep their
 * field defaults, which are what a deployment gets when it sets nothing.
 */
class LlmClientTest {

    private final LlmClient client = new LlmClient();
    private final ObjectMapper json = new ObjectMapper();
    private HttpServer server;

    private static final List<ChatTurn> ONE_QUESTION = List.of(ChatTurn.user("What is orders for?"));
    private static final SystemPrompt SYSTEM = new SystemPrompt("instructions", "SCHEMA\nTABLE t");

    private static LlmCredentials openRouter(String model) {
        return new LlmCredentials(LlmProvider.OPENROUTER, "k", model, false);
    }

    private JsonNode anthropicBody() throws Exception {
        return json.readTree(client.anthropicBody(
                new LlmCredentials(LlmProvider.ANTHROPIC, "k", "claude-sonnet-5-5", true),
                SYSTEM, ONE_QUESTION));
    }

    private StreamResult consume(LlmProvider provider, String stream, List<String> fragments)
            throws Exception {
        return client.consume(new BufferedReader(new StringReader(stream)), provider, fragments::add);
    }

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
        }
    }

    /**
     * A local stand-in for a provider. Each request takes the next scripted reply; the bodies
     * received are kept so a test can see what was sent.
     */
    private record Reply(int status, String body, String retryAfter) {
    }

    private List<String> serve(List<Reply> replies) throws Exception {
        List<String> received = new CopyOnWriteArrayList<>();
        AtomicInteger next = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            received.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            Reply reply = replies.get(Math.min(next.getAndIncrement(), replies.size() - 1));
            if (reply.retryAfter() != null) {
                exchange.getResponseHeaders().add("Retry-After", reply.retryAfter());
            }
            byte[] bytes = reply.body().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(reply.status(), bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
        List<Long> waits = new ArrayList<>();
        client.useForTests("http://127.0.0.1:" + server.getAddress().getPort(), waits::add);
        return received;
    }

    private static final String OPENROUTER_ANSWER = """
            : OPENROUTER PROCESSING

            data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

            data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}

            data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":1100},"cost":0.00042}}

            data: [DONE]
            """;

    /* ------------------------------------------------------------------ *
     * Requests
     * ------------------------------------------------------------------ */

    /**
     * Current Claude models reject sampling parameters with HTTP 400. A hard-coded temperature
     * made every question fail on the Anthropic path, including on its own default model.
     */
    @Test
    void theAnthropicRequestCarriesNoSamplingParameters() throws Exception {
        JsonNode body = anthropicBody();

        assertThat(body.has("temperature")).isFalse();
        assertThat(body.has("top_p")).isFalse();
        assertThat(body.has("top_k")).isFalse();
    }

    @Test
    void theAnthropicRequestCachesThroughTheEndOfTheSchema() throws Exception {
        JsonNode body = anthropicBody();

        // The system prompt is a top-level array of blocks, never a "system" message.
        JsonNode system = body.path("system");
        assertThat(system.isArray()).isTrue();
        assertThat(system.get(0).path("text").asText()).isEqualTo("instructions");
        assertThat(system.get(0).has("cache_control")).isFalse();
        assertThat(system.get(1).path("text").asText()).contains("TABLE t");
        assertThat(system.get(1).path("cache_control").path("type").asText()).isEqualTo("ephemeral");
        assertThat(body.path("messages").get(0).path("role").asText()).isEqualTo("user");
        // Room for adaptive thinking as well as the answer; 2,000 ran out mid-thought.
        assertThat(body.path("max_tokens").asInt()).isGreaterThanOrEqualTo(8192);
        // Effort is opt-in, because older models reject the field.
        assertThat(body.has("output_config")).isFalse();
    }

    /**
     * OpenRouter's Claude and Gemini models only cache what carries a breakpoint, and a plain
     * string system message cannot carry one. This is the path that can be checked with an
     * OpenRouter key: ask twice about one file and the second call's usage reports cached tokens.
     */
    @Test
    void openRouterClaudeModelsGetACacheBreakpointOnTheSchema() throws Exception {
        JsonNode body = json.readTree(client.openAiBody(
                openRouter("anthropic/claude-sonnet-4.5"), SYSTEM, ONE_QUESTION));

        JsonNode content = body.path("messages").get(0).path("content");
        assertThat(content.isArray()).isTrue();
        assertThat(content.get(1).path("cache_control").path("type").asText()).isEqualTo("ephemeral");
        // And asks for token counts and cost on the stream.
        assertThat(body.path("usage").path("include").asBoolean()).isTrue();
    }

    @Test
    void otherOpenRouterModelsGetAPlainStableSystemString() throws Exception {
        JsonNode body = json.readTree(client.openAiBody(openRouter("openai/gpt-4o"), SYSTEM, ONE_QUESTION));

        JsonNode system = body.path("messages").get(0);
        assertThat(system.path("role").asText()).isEqualTo("system");
        assertThat(system.path("content").asText()).startsWith("instructions\n").contains("TABLE t");
        assertThat(body.has("max_tokens")).isTrue();
        assertThat(body.has("temperature")).isFalse();
    }

    @Test
    void openAiUsesTheCurrentTokenLimitFieldAndAsksForUsage() throws Exception {
        JsonNode body = json.readTree(client.openAiBody(
                new LlmCredentials(LlmProvider.OPENAI, "k", "gpt-4o", true), SYSTEM, ONE_QUESTION));

        assertThat(body.has("max_completion_tokens")).isTrue();
        assertThat(body.has("max_tokens")).isFalse();
        assertThat(body.path("stream_options").path("include_usage").asBoolean()).isTrue();
    }

    /* ------------------------------------------------------------------ *
     * Streams
     * ------------------------------------------------------------------ */

    @Test
    void anAnthropicStreamYieldsOnlyTheAnswerTextAndItsUsage() throws Exception {
        String stream = """
                event: message_start
                data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":100,"cache_read_input_tokens":900,"cache_creation_input_tokens":0,"output_tokens":1}}}

                event: content_block_delta
                data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}

                event: ping
                data: {"type":"ping"}

                event: content_block_delta
                data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Orders "}}

                event: content_block_delta
                data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"are sales."}}

                event: message_delta
                data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":57}}

                event: message_stop
                data: {"type":"message_stop"}
                """;
        List<String> fragments = new ArrayList<>();

        StreamResult result = consume(LlmProvider.ANTHROPIC, stream, fragments);

        assertThat(String.join("", fragments)).isEqualTo("Orders are sales.");
        assertThat(result.stopReason()).isEqualTo("end_turn");
        assertThat(result.truncated()).isFalse();
        // Anthropic's input_tokens excludes cached tokens; the total prompt is the sum.
        assertThat(result.usage()).isEqualTo(new Usage(1000, 57, 900, null));
    }

    /**
     * An answer cut off by the token limit is a successful stream. Without the stop reason the
     * UI showed it as finished, often ending inside a SQL block.
     */
    @Test
    void anAnthropicAnswerCutOffByTheTokenLimitSaysSo() throws Exception {
        String stream = """
                data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"CREATE TABLE t ("}}

                data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}
                """;

        StreamResult result = consume(LlmProvider.ANTHROPIC, stream, new ArrayList<>());

        assertThat(result.truncated()).isTrue();
        assertThat(result.characters()).isPositive();
    }

    @Test
    void anOpenRouterStreamReportsTextStopReasonUsageAndCost() throws Exception {
        List<String> fragments = new ArrayList<>();

        StreamResult result = consume(LlmProvider.OPENROUTER, OPENROUTER_ANSWER, fragments);

        assertThat(fragments).containsExactly("Hello", " there");
        assertThat(result.stopReason()).isEqualTo("stop");
        assertThat(result.usage()).isEqualTo(new Usage(1200, 40, 1100, 0.00042));
    }

    @Test
    void lengthIsTruncatedAndARefusalIsDistinguishedFromAnAnswer() throws Exception {
        StreamResult cut = consume(LlmProvider.OPENROUTER, """
                data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"length"}]}
                """, new ArrayList<>());
        StreamResult refused = consume(LlmProvider.ANTHROPIC, """
                data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}
                """, new ArrayList<>());

        assertThat(cut.truncated()).isTrue();
        assertThat(refused.refused()).isTrue();
        assertThat(refused.characters()).isZero();
    }

    @Test
    void anErrorFrameMidStreamBecomesAnLlmException() {
        String stream = """
                data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Half"}}

                event: error
                data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}
                """;

        assertThatThrownBy(() -> consume(LlmProvider.ANTHROPIC, stream, new ArrayList<>()))
                .isInstanceOf(LlmException.class)
                .hasMessage("Overloaded");
    }

    /* ------------------------------------------------------------------ *
     * End to end, against a local stand-in
     * ------------------------------------------------------------------ */

    @Test
    void aFullOpenRouterCallStreamsTheAnswer() throws Exception {
        List<String> received = serve(List.of(new Reply(200, OPENROUTER_ANSWER, null)));
        List<String> fragments = new ArrayList<>();

        StreamResult result = client.stream(openRouter("openai/gpt-4o"), SYSTEM, ONE_QUESTION, fragments::add);

        assertThat(String.join("", fragments)).isEqualTo("Hello there");
        assertThat(result.usage().cachedTokens()).isEqualTo(1100);
        assertThat(received).hasSize(1);
        assertThat(received.get(0)).contains("\"model\":\"openai/gpt-4o\"");
    }

    /** A rate limit or an overloaded backend before the first byte clears by itself; retry it. */
    @Test
    void aTemporaryFailureBeforeTheStreamIsRetried() throws Exception {
        List<String> received = serve(List.of(
                new Reply(429, "{\"error\":{\"message\":\"slow down\"}}", "0"),
                new Reply(503, "upstream restarting", null),
                new Reply(200, OPENROUTER_ANSWER, null)));
        List<String> fragments = new ArrayList<>();

        client.stream(openRouter("openai/gpt-4o"), SYSTEM, ONE_QUESTION, fragments::add);

        assertThat(received).hasSize(3);
        assertThat(String.join("", fragments)).isEqualTo("Hello there");
    }

    @Test
    void retriesGiveUpAndReportTheProvidersOwnMessage() throws Exception {
        List<String> received = serve(List.of(
                new Reply(503, "{\"error\":{\"message\":\"No endpoints available\"}}", null)));

        assertThatThrownBy(() -> client.stream(openRouter("openai/gpt-4o"), SYSTEM, ONE_QUESTION, f -> { }))
                .isInstanceOf(LlmException.class)
                .hasMessage("No endpoints available")
                .extracting(e -> ((LlmException) e).getStatus()).isEqualTo(503);
        // The first attempt and two retries.
        assertThat(received).hasSize(3);
    }

    /** A 401 will be exactly as wrong the second time. */
    @Test
    void aRejectedKeyIsNotRetried() throws Exception {
        List<String> received = serve(List.of(
                new Reply(401, "{\"error\":{\"message\":\"No auth credentials found\"}}", null)));

        assertThatThrownBy(() -> client.stream(openRouter("openai/gpt-4o"), SYSTEM, ONE_QUESTION, f -> { }))
                .isInstanceOf(LlmException.class)
                .hasMessage("No auth credentials found");
        assertThat(received).hasSize(1);
    }

    @Test
    void retryAfterIsHonouredButCapped() {
        assertThat(LlmClient.backoffMillis(0, "3")).isEqualTo(3000);
        assertThat(LlmClient.backoffMillis(0, "600")).isEqualTo(10_000);
        assertThat(LlmClient.backoffMillis(0, null)).isBetween(500L, 750L);
        assertThat(LlmClient.backoffMillis(1, "not-a-number")).isBetween(1500L, 1750L);
    }
}
