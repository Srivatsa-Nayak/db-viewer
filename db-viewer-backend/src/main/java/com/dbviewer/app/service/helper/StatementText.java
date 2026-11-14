package com.dbviewer.app.service.helper;

/**
 * How a statement and its failure are described back to the user: one line of the SQL, and the
 * innermost cause's message rather than Spring's wrapper around it. Shared by the import report
 * and the scratchpad report, which must word the same failure the same way.
 */
public final class StatementText {

    private StatementText() { }

    static String summarize(String statement) {
        String oneLine = statement.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 80 ? oneLine : oneLine.substring(0, 80) + "...";
    }

    public static String rootCauseMessage(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        String message = cause.getMessage();
        return message == null || message.isBlank() ? cause.getClass().getSimpleName() : message.trim();
    }
}
