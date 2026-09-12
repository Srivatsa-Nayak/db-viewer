package com.dbviewer.app.exception;

/** Thrown when an action that requires an account is attempted anonymously. Maps to 401. */
public class UnauthorizedException extends RuntimeException {
    public UnauthorizedException(String message) {
        super(message);
    }
}
