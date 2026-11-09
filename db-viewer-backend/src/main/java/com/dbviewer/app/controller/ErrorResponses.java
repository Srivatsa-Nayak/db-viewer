package com.dbviewer.app.controller;

import org.slf4j.Logger;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;

import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

/**
 * How a handler reports a failure it did not expect.
 *
 * <p>Handlers used to answer every exception with {@code 500 {"error": e.getMessage()}}, which
 * mixed two different things. A database error caused by the user's own SQL or data — a
 * {@code UNIQUE} constraint, a column that does not exist — is a message <em>about their file</em>
 * that they need to read; it is a 400. Anything else is the server's fault, and its message can
 * carry class names, file paths and driver internals that are nobody's business; it is a 500
 * with a generic message and a reference that is logged beside the stack trace.
 */
final class ErrorResponses {

    private ErrorResponses() {
    }

    static ResponseEntity<Map<String, Object>> failure(Exception e, Logger log, String what) {
        if (isDatabaseError(e)) {
            return ResponseEntity.badRequest().body(Map.of("error", rootMessage(e)));
        }
        String reference = UUID.randomUUID().toString().substring(0, 8);
        log.error("{} failed (ref {})", what, reference, e);
        return ResponseEntity.internalServerError().body(Map.of(
                "error", "Something went wrong on the server. Reference " + reference + ".",
                "reference", reference));
    }

    /**
     * True when the exception is the database rejecting the caller's SQL or data, anywhere down
     * the cause chain.
     *
     * <p>Not a failure to reach the database at all — a missing file, a refused connection, a
     * full pool. Those are the server's fault, and their messages carry file paths and hosts, so
     * they take the generic 500 instead.
     */
    static boolean isDatabaseError(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof org.springframework.dao.DataAccessResourceFailureException) {
                return false;
            }
        }
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof DataAccessException || t instanceof SQLException) {
                return true;
            }
        }
        return false;
    }

    /** The innermost message, which for a database error is the one the engine wrote. */
    static String rootMessage(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        return cause.getMessage() == null ? error.toString() : cause.getMessage();
    }
}
