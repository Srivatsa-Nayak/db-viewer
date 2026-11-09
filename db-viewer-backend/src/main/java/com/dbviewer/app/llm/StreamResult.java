package com.dbviewer.app.llm;

/**
 * How a streamed answer ended.
 *
 * <p>The character count alone could not tell a finished answer from one the provider cut off.
 * A reply that ran out of {@code max_tokens} arrives as a perfectly successful stream, often with
 * a half-written SQL block at the end, and without the stop reason the UI presented it as
 * complete.
 *
 * @param characters how much text was streamed; zero is an empty answer, which is a failure
 * @param stopReason the provider's own value as sent ({@code end_turn}, {@code max_tokens},
 *                   {@code stop}, {@code length}, {@code refusal}, {@code content_filter}…), or
 *                   null when the stream ended without stating one
 * @param usage      tokens and cost as the provider reported them; {@link Usage#NONE} if it
 *                   reported nothing
 */
public record StreamResult(int characters, String stopReason, Usage usage) {

    public StreamResult(int characters, String stopReason) {
        this(characters, stopReason, Usage.NONE);
    }

    /** True when the answer was cut off by the output-token limit rather than finishing. */
    public boolean truncated() {
        return "max_tokens".equals(stopReason) || "length".equals(stopReason);
    }

    /** True when the provider declined to answer, rather than answering or running out of room. */
    public boolean refused() {
        return "refusal".equals(stopReason) || "content_filter".equals(stopReason);
    }
}
