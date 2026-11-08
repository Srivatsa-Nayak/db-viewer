package com.dbviewer.app.service;

import com.dbviewer.app.llm.ChatTurn;
import com.dbviewer.app.llm.LlmCredentials;
import com.dbviewer.app.llm.StreamResult;

import java.util.List;
import java.util.function.Consumer;

/**
 * The schema assistant: answers questions about the open file, and writes DDL for the user to
 * review.
 *
 * <p>Split into two calls on purpose, and the split is load-bearing rather than stylistic.
 * {@link #prepare} reads the workspace schema and the caller's credentials, both of which come
 * from thread-locals bound by the servlet filters. {@link #stream} runs on a different thread —
 * Spring dispatches a streaming response body asynchronously, after the filter chain has already
 * unwound — where those thread-locals are gone. Gathering everything first means the streaming
 * half needs no request context at all.
 */
public interface ChatService {

    /**
     * Everything one model call needs, resolved while the request context still exists.
     *
     * @param credentials whose key pays for the call
     * @param system      the system prompt, including the schema of the open file
     * @param messages    the trimmed conversation, ending with the new question
     * @param tableCount  how many tables the assistant was shown, for the UI's context badge
     * @param truncated   true when the schema was too large to send in full
     */
    record ChatPrompt(LlmCredentials credentials, String system, List<ChatTurn> messages,
                      int tableCount, boolean truncated) {
    }

    /**
     * Builds the prompt for a question. Must be called on the request thread.
     *
     * @param history prior turns, oldest first; trimmed and filtered here rather than trusted
     */
    ChatPrompt prepare(String message, List<ChatTurn> history);

    /**
     * Streams the answer, handing each fragment to {@code onFragment}. Safe to call off the
     * request thread.
     *
     * @return how much was streamed and why it stopped. Zero characters means the model answered
     *         with nothing, which is a failure the user has to be told about rather than an empty
     *         bubble; a truncated or refused result has to be said out loud for the same reason
     */
    StreamResult stream(ChatPrompt prompt, Consumer<String> onFragment);
}
