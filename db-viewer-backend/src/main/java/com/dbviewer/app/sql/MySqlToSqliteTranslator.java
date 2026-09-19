package com.dbviewer.app.sql;

import java.util.List;

/**
 * The MySQL-specific entry point into {@link SqlDialectTranslator}.
 *
 * <p>This class was the whole importer once, when a MySQL dump was the only thing anyone could
 * bring in. Supporting PostgreSQL and SQL Server as well made every rule in it dialect-aware, so
 * the logic moved to {@link SqlDialectTranslator} and this became the name the MySQL path calls
 * it by — useful on its own, because a caller that already knows the file is a MySQL dump should
 * not pay for detection or risk it guessing differently.
 *
 * @see SqlDialectTranslator for the translation itself
 * @see SqlDialectDetector for the path that works the dialect out instead of being told
 */
public final class MySqlToSqliteTranslator {

    /** Translated statements, plus human-readable notes about anything dropped along the way. */
    public record Result(List<String> statements, List<String> notes) {
    }

    private MySqlToSqliteTranslator() {
    }

    public static Result translate(List<String> statements) {
        SqlDialectTranslator.Result result =
                SqlDialectTranslator.translate(statements, SqlDialect.MYSQL);
        return new Result(result.statements(), result.notes());
    }

    /**
     * Splits on commas that sit outside parentheses and outside quotes.
     *
     * @see SqlDialectTranslator#splitTopLevel(String)
     */
    public static List<String> splitTopLevel(String body) {
        return SqlDialectTranslator.splitTopLevel(body);
    }

    static String unquote(String identifier) {
        return SqlDialectTranslator.unquote(identifier);
    }
}
