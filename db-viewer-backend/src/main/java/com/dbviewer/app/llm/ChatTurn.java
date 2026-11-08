package com.dbviewer.app.llm;

/**
 * One message in a conversation.
 *
 * @param role    {@code user} or {@code assistant}; the system prompt is passed separately,
 *                because Anthropic takes it as a top-level field rather than a message
 * @param content the text
 */
public record ChatTurn(String role, String content) {

    public static ChatTurn user(String content) {
        return new ChatTurn("user", content);
    }

    public static ChatTurn assistant(String content) {
        return new ChatTurn("assistant", content);
    }

    /** True for a turn this application is willing to send on: a non-empty user or assistant say. */
    public boolean isUsable() {
        return content != null && !content.isBlank()
                && ("user".equals(role) || "assistant".equals(role));
    }
}
