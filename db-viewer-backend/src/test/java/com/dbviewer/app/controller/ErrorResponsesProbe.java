package com.dbviewer.app.controller;

import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;

import java.util.Map;

/** Test access to the package-private {@link ErrorResponses}. */
public final class ErrorResponsesProbe {

    private ErrorResponsesProbe() {
    }

    public static ResponseEntity<Map<String, Object>> unexpected() {
        return ErrorResponses.failure(new IllegalStateException("/opt/app/secret-path exploded"),
                LoggerFactory.getLogger(ErrorResponsesProbe.class), "Probe");
    }

    public static ResponseEntity<Map<String, Object>> database() {
        return ErrorResponses.failure(new DataIntegrityViolationException("UNIQUE constraint failed: users.email"),
                LoggerFactory.getLogger(ErrorResponsesProbe.class), "Probe");
    }
}
