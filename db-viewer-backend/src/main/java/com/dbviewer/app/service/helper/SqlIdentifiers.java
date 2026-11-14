package com.dbviewer.app.service.helper;

/** Validation for the table and column names clients send. */
public final class SqlIdentifiers {

    private SqlIdentifiers() { }

    /**
     * Normalises and validates a client-supplied identifier. Table and column names cannot be
     * bound as JDBC parameters, so anything outside {@code [A-Za-z0-9_]} is rejected outright
     * rather than escaped.
     */
    public static String safe(String raw, String what) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Missing " + what);
        }
        String cleaned = raw.trim().replaceAll("[\\s\\-]+", "_");
        if (!cleaned.matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("Invalid " + what + ": \"" + raw + "\"");
        }
        return cleaned;
    }
}
