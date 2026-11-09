package com.dbviewer.app.llm;

/**
 * The system prompt in its two halves.
 *
 * <p>Split because the halves change at different rates, and prompt caching is a prefix match.
 * The instructions are identical for every question anyone asks; the schema is identical for
 * every question about one file until somebody edits it. Sending them as two blocks lets the
 * provider cache through the end of the schema, so turn two of a conversation re-reads the
 * whole prompt from cache instead of paying for it again.
 *
 * @param instructions what the assistant is and how it should answer — never per-request data
 * @param schema       the open file's structure, rendered as text
 */
public record SystemPrompt(String instructions, String schema) {

    /** Both halves as one string, for providers that take the system prompt as plain text. */
    public String full() {
        return instructions + "\n" + schema;
    }
}
