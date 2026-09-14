package com.dbviewer.app.controller;

import com.dbviewer.app.exception.UnauthorizedException;
import com.dbviewer.app.exception.WorkspaceForbiddenException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

import java.util.Map;

/**
 * Global exception handler for clean error responses
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

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
        return ResponseEntity.badRequest().body(Map.of("error", "File too large. Max size is 50MB."));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<?> handleMissingMultipartFile(MissingServletRequestPartException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "File is required."));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<?> handleUnreadableRequestBody(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "Invalid JSON request body."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGeneral(Exception e) {
        log.error("Unhandled exception", e);
        return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
    }
}
