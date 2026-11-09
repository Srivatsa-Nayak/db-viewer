package com.dbviewer.app.llm;

/**
 * What one answer cost, as the provider reported it.
 *
 * <p>Read from the stream itself rather than estimated: Anthropic reports it on
 * {@code message_start} and {@code message_delta}; OpenAI on a final chunk when asked with
 * {@code stream_options.include_usage}; OpenRouter on its final chunk, including the price in
 * dollars. Any field a provider did not report is zero (or null for the cost).
 *
 * @param inputTokens  every prompt token, cached or not
 * @param outputTokens the answer, including any thinking the model did
 * @param cachedTokens prompt tokens served from the provider's prompt cache. A non-zero value on
 *                     the second turn of a conversation is how to see caching working
 * @param costUsd      the provider's own price for the call, when it states one (OpenRouter)
 */
public record Usage(long inputTokens, long outputTokens, long cachedTokens, Double costUsd) {

    public static final Usage NONE = new Usage(0, 0, 0, null);

    public boolean isEmpty() {
        return inputTokens == 0 && outputTokens == 0 && cachedTokens == 0 && costUsd == null;
    }
}
