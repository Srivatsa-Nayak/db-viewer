package com.dbviewer.sql;

import java.util.ArrayList;
import java.util.List;

/**
 * Splits a SQL script into individual statements.
 *
 * <p>Replaces a naive {@code script.split(";")}, which broke on real dumps in three ways:
 * a semicolon inside a string literal split a statement in half; a statement preceded by a
 * {@code --} comment block looked like a comment and was skipped whole (in a phpMyAdmin dump
 * that is every statement); and {@code DELIMITER $$} blocks around triggers were shredded.
 *
 * <p>This splitter is comment-, quote- and {@code DELIMITER}-aware. Comments are stripped, so
 * a returned statement always starts with real SQL.
 */
public final class SqlScriptSplitter {

    private SqlScriptSplitter() {
    }

    public static List<String> split(String script) {
        List<String> statements = new ArrayList<>();
        if (script == null || script.isBlank()) {
            return statements;
        }

        StringBuilder current = new StringBuilder();
        String delimiter = ";";
        boolean atLineStart = true;
        int i = 0;
        final int n = script.length();

        while (i < n) {
            char c = script.charAt(i);

            // DELIMITER is a client directive, not SQL, and only valid at the start of a line.
            if (atLineStart && regionMatchesIgnoreCase(script, i, "DELIMITER")) {
                int afterKeyword = i + "DELIMITER".length();
                if (afterKeyword < n && isInlineSpace(script.charAt(afterKeyword))) {
                    int eol = endOfLine(script, i);
                    String candidate = script.substring(afterKeyword, eol).trim();
                    if (!candidate.isEmpty()) {
                        flush(statements, current);
                        delimiter = candidate;
                        i = eol;
                        continue;
                    }
                }
            }

            // -- line comment (requires whitespace or end-of-line after the dashes, so that
            // an expression such as `a--1` is not mistaken for one).
            if (c == '-' && i + 1 < n && script.charAt(i + 1) == '-'
                    && (i + 2 >= n || isWhitespace(script.charAt(i + 2)))) {
                i = endOfLine(script, i);
                continue;
            }

            // # line comment (MySQL)
            if (c == '#') {
                i = endOfLine(script, i);
                continue;
            }

            // /* block comment */ - this also swallows MySQL's /*!40101 ... */ conditional comments,
            // whose contents are MySQL-only session setup we could not run anyway.
            if (c == '/' && i + 1 < n && script.charAt(i + 1) == '*') {
                int end = script.indexOf("*/", i + 2);
                i = end < 0 ? n : end + 2;
                continue;
            }

            // String literals and quoted identifiers are copied verbatim, so a delimiter or a
            // comment marker inside them is not treated as syntax.
            if (c == '\'' || c == '"' || c == '`') {
                i = consumeQuoted(script, i, current);
                atLineStart = false;
                continue;
            }

            if (script.startsWith(delimiter, i)) {
                flush(statements, current);
                i += delimiter.length();
                atLineStart = false;
                continue;
            }

            current.append(c);
            atLineStart = c == '\n' || (atLineStart && isWhitespace(c));
            i++;
        }

        flush(statements, current);
        return statements;
    }

    private static int consumeQuoted(String script, int start, StringBuilder out) {
        char quote = script.charAt(start);
        out.append(quote);
        int i = start + 1;
        while (i < script.length()) {
            char c = script.charAt(i);
            // Backtick-quoted identifiers do not honour backslash escapes.
            if (c == '\\' && quote != '`' && i + 1 < script.length()) {
                out.append(c).append(script.charAt(i + 1));
                i += 2;
                continue;
            }
            if (c == quote) {
                // A doubled quote is an escaped quote, not the end of the literal.
                if (i + 1 < script.length() && script.charAt(i + 1) == quote) {
                    out.append(quote).append(quote);
                    i += 2;
                    continue;
                }
                out.append(quote);
                return i + 1;
            }
            out.append(c);
            i++;
        }
        return i;
    }

    private static void flush(List<String> statements, StringBuilder current) {
        String statement = current.toString().trim();
        if (!statement.isEmpty()) {
            statements.add(statement);
        }
        current.setLength(0);
    }

    private static int endOfLine(String script, int from) {
        int newline = script.indexOf('\n', from);
        return newline < 0 ? script.length() : newline;
    }

    private static boolean regionMatchesIgnoreCase(String script, int offset, String keyword) {
        return script.regionMatches(true, offset, keyword, 0, keyword.length());
    }

    private static boolean isInlineSpace(char c) {
        return c == ' ' || c == '\t';
    }

    private static boolean isWhitespace(char c) {
        return Character.isWhitespace(c);
    }
}
