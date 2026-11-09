package com.dbviewer.app.llm;

import lombok.Getter;

/**
 * A model call that failed, carrying the provider's HTTP status so the message shown to the user
 * can name the actual problem.
 *
 * <p>The distinction matters because the four common failures need four different actions from
 * four different people: 401 means the key is wrong (the user fixes it), 402 means the account is
 * out of credit (whoever owns the key tops it up), 404 means the model id is wrong (an operator
 * fixes the configuration), and 429 means wait. "The chatbot is not working" covers all of them
 * and helps with none.
 */
@Getter
public class LlmException extends RuntimeException {

    /** The provider's HTTP status, or 0 when the request never got that far. */
    private final int status;

    public LlmException(String message, int status) {
        super(message);
        this.status = status;
    }

    public LlmException(String message, int status, Throwable cause) {
        super(message, cause);
        this.status = status;
    }
}
