package com.dbviewer.app.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * What goes on the wire to the provider, and how its stream is read back.
 *
 * <p>Plain unit tests on a bare {@code new LlmClient()}: no Spring, no network. Configured values
 * keep their field defaults, which are the values a deployment gets when it sets nothing.
 */
class LlmClientTest {

    private final LlmClient client = new LlmClient();
    private final ObjectMapper json = new ObjectMapper();

    private static final List<ChatTurn> ONE_QUESTION = List.of(ChatTurn.user("What is orders for?"));

    private JsonNode anthropicBody() throws Exception {
        return json.readTree(client.anthropicBody(
                new LlmCredentials(LlmProvider.ANTHROPIC, "k", "claude-sonnet-5", true),
                "system prompt", ONE_QUESTION));
    }

    private StreamResult consume(LlmProvider provider, String stream, List<String> fragments)
            throws Exception {
        return client.consume(new BufferedReader(new StringReader(stream)), provider, fragments::add);
    }

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
    void theAnthropicRequestKeepsItsRequiredShape() throws Exception {
        JsonNode body = anthropicBody();

        assertThat(body.path("system").asText()).isEqualTo("system prompt");
        assertThat(body.path("stream").asBoolean()).isTrue();
        // Room for adaptive thinking as well as the answer; 2,000 ran out mid-thought.
        assertThat(body.path("max_tokens").asInt()).isGreaterThanOrEqualTo(8192);
        // The system prompt is a top-level field; a "system" message is rejected by the API.
        assertThat(body.path("messages").get(0).path("role").asText()).isEqualTo("user");
        // Effort is opt-in, because older models reject the field.
        assertThat(body.has("output_config")).isFalse();
    }

    @Test
    void openAiUsesTheCurrentTokenLimitFieldAndOpenRouterTheOneItDocuments() throws Exception {
        JsonNode openAi = json.readTree(client.openAiBody(
                new LlmCredentials(LlmProvider.OPENAI, "k", "gpt-4o", true), "s", ONE_QUESTION));
        JsonNode openRouter = json.readTree(client.openAiBody(
                new LlmCredentials(LlmProvider.OPENROUTER, "k", "openai/gpt-4o", false), "s",
                ONE_QUESTION));

        assertThat(openAi.has("max_completion_tokens")).isTrue();
        assertThat(openAi.has("max_tokens")).isFalse();
        assertThat(openRouter.has("max_tokens")).isTrue();
        assertThat(openAi.has("temperature")).isFalse();
        assertThat(openRouter.has("temperature")).isFalse();
        // The system prompt travels as the first message on this wire format.
        assertThat(openAi.path("messages").get(0).path("role").asText()).isEqualTo("system");
    }

    /* ------------------------------------------------------------------ *
     * Streams
     * ------------------------------------------------------------------ */

    @Test
    void anAnthropicStreamYieldsOnlyTheAnswerText() throws Exception {
        String stream = """
                event: message_start
                data: {"type":"message_start","message":{"id":"m"}}

                event: content_block_delta
                data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}

                event: ping
                data: {"type":"ping"}

                event: content_block_delta
                data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Orders "}}

                event: content_block_delta
                data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"are sales."}}

                event: message_delta
                data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}

                event: message_stop
                data: {"type":"message_stop"}
                """;
        List<String> fragments = new ArrayList<>();

        StreamResult result = consume(LlmProvider.ANTHROPIC, stream, fragments);

        assertThat(String.join("", fragments)).isEqualTo("Orders are sales.");
        assertThat(result.characters()).isEqualTo("Orders are sales.".length());
        assertThat(result.stopReason()).isEqualTo("end_turn");
        assertThat(result.truncated()).isFalse();
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
    void anOpenAiStreamReportsLengthAsTruncatedAndIgnoresKeepAlives() throws Exception {
        String stream = """
                : OPENROUTER PROCESSING

                data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

                data: {"choices":[{"delta":{},"finish_reason":"length"}]}

                data: [DONE]
                """;
        List<String> fragments = new ArrayList<>();

        StreamResult result = consume(LlmProvider.OPENROUTER, stream, fragments);

        assertThat(fragments).containsExactly("Hello");
        assertThat(result.stopReason()).isEqualTo("length");
        assertThat(result.truncated()).isTrue();
    }

    @Test
    void aRefusalIsDistinguishedFromAnAnswer() throws Exception {
        String stream = """
                data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}
                """;

        StreamResult result = consume(LlmProvider.ANTHROPIC, stream, new ArrayList<>());

        assertThat(result.refused()).isTrue();
        assertThat(result.characters()).isZero();
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
}
