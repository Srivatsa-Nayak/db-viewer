package com.dbviewer.app.controller;

import com.dbviewer.app.exception.UnauthorizedException;
import com.dbviewer.app.exception.WorkspaceForbiddenException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

/**
 * Global exception handler for clean error responses
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @Value("${spring.servlet.multipart.max-file-size:50MB}")
    private String maxUploadSize;

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    /**
     * The caller is identified perfectly well and simply does not own the workspace, so this is
     * 403 and not 401 — signing in again would change nothing.
     */
    @ExceptionHandler(WorkspaceForbiddenException.class)
    public ResponseEntity<?> handleWorkspaceForbidden(WorkspaceForbiddenException e) {
        return ResponseEntity.status(403).body(Map.of(
                "error", e.getMessage(),
                "notYourWorkspace", true));
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<?> handleUnauthorized(UnauthorizedException e) {
        return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<?> handleFileTooLarge(MaxUploadSizeExceededException e) {
        return ResponseEntity.badRequest().body(Map.of("error",
                "File too large. The limit is " + maxUploadSize + "."));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<?> handleMissingMultipartFile(MissingServletRequestPartException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "File is required."));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<?> handleUnreadableRequestBody(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "Invalid JSON request body."));
    }

    /**
     * A URL nothing is mapped to. Spring 6 reports it as an exception, and the catch-all below
     * used to turn it into a 500 — so a typo in a path looked like the server breaking.
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<?> handleNotFound(NoResourceFoundException e) {
        return ResponseEntity.status(404).body(Map.of("error", "Not found."));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<?> handleWrongMethod(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(405).body(Map.of("error", e.getMethod() + " is not supported here."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGeneral(Exception e) {
        // A database error is about the caller's own data and is theirs to read; anything else
        // is reported generically, with a reference that matches the logged stack trace.
        return ErrorResponses.failure(e, log, "Unhandled request");
    }
}
