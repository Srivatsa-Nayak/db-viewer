package com.dbviewer.app.service.impl;

import com.dbviewer.app.sql.SqlDialectTranslator;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reading and rewriting fragments of stored SQLite DDL, as text.
 *
 * <p>Some of what a table carries — {@code CHECK} constraints, {@code COLLATE} clauses — is
 * reported by no PRAGMA, so the stored {@code CREATE TABLE} is the only place to find it, and a
 * table rebuild ({@link SqliteTableRebuilder}) has to read it back out. Pure functions with no
 * database access, split out of {@code DatabaseServiceImpl} so they can be read on their own.
 */
final class SqliteDdlText {

    private SqliteDdlText() { }

    /**
     * Table- and column-level {@code CHECK} constraints, pulled out of the table's own DDL.
     *
     * <p>No PRAGMA reports these, so the stored {@code CREATE TABLE} text is the only source. Each
     * is re-emitted as a table-level clause, which is equivalent in SQLite however it was
     * originally written and much simpler than working out which column it belonged to.
     *
     * <p>The scan tracks quoting and nesting rather than using a regex, because a {@code CHECK}
     * body can contain parentheses and the word itself can appear inside a string literal or a
     * quoted column name.
     */
    private static final Pattern COLUMN_COLLATE =
            Pattern.compile("(?i)\\bCOLLATE\\s+(\"[^\"]+\"|[A-Za-z_][A-Za-z0-9_]*)");

    private static final Pattern TABLE_CONSTRAINT_START =
            Pattern.compile("(?i)^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)\\b");

    /** Each column's {@code COLLATE} clause in a stored CREATE TABLE, keyed by column name. */
    static Map<String, String> extractCollations(String createSql) {
        Map<String, String> collations = new HashMap<>();
        if (createSql == null) {
            return collations;
        }
        int open = createSql.indexOf('(');
        int close = createSql.lastIndexOf(')');
        if (open < 0 || close <= open) {
            return collations;
        }
        for (String part : SqlDialectTranslator.splitTopLevel(createSql.substring(open + 1, close))) {
            String item = part.trim();
            if (item.isEmpty() || TABLE_CONSTRAINT_START.matcher(item).find()) {
                continue;
            }
            String name = columnNameOf(item);
            Matcher collate = COLUMN_COLLATE.matcher(item.replaceAll("'(?:[^']|'')*'", "''"));
            if (name != null && collate.find()) {
                collations.put(name, collate.group(1));
            }
        }
        return collations;
    }

    /** The column name at the start of a column definition, without its quotes. */
    static String columnNameOf(String definition) {
        String d = definition.trim();
        if (d.isEmpty()) {
            return null;
        }
        char first = d.charAt(0);
        if (first == '"' || first == '`' || first == '[') {
            char closing = first == '[' ? ']' : first;
            int end = d.indexOf(closing, 1);
            return end > 0 ? d.substring(1, end) : null;
        }
        int space = d.indexOf(' ');
        return space > 0 ? d.substring(0, space) : d;
    }

    static List<String> extractCheckConstraints(String createSql) {
        List<String> checks = new ArrayList<>();
        if (createSql == null) {
            return checks;
        }
        int bodyStart = createSql.indexOf('(');
        if (bodyStart < 0) {
            return checks;
        }

        int depth = 0;
        char quote = 0;
        for (int i = bodyStart; i < createSql.length(); i++) {
            char c = createSql.charAt(i);

            if (quote != 0) {
                if (c == quote) {
                    quote = 0;
                }
                continue;
            }
            if (c == SINGLE_QUOTE || c == DOUBLE_QUOTE || c == BACKTICK) {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
                continue;
            }
            if (c == ')') {
                depth--;
                if (depth == 0) {
                    break;
                }
                continue;
            }

            // Only at the top level of the column list, and only as a whole word.
            if (depth == 1 && matchesWord(createSql, i, "CHECK")) {
                int open = createSql.indexOf('(', i);
                if (open < 0) {
                    break;
                }
                int close = matchingParen(createSql, open);
                if (close < 0) {
                    break;
                }
                checks.add("CHECK " + createSql.substring(open, close + 1));
                i = close;
            }
        }
        return checks;
    }

    private static final char SINGLE_QUOTE = '\'';
    private static final char DOUBLE_QUOTE = '"';
    private static final char BACKTICK = '`';
    private static final String QUOTE = "\"";

    /** True when {@code word} starts at {@code at} and is not part of a longer identifier. */
    private static boolean matchesWord(String text, int at, String word) {
        if (!text.regionMatches(true, at, word, 0, word.length())) {
            return false;
        }
        int before = at - 1;
        int after = at + word.length();
        boolean leftClear = before < 0 || !isIdentifierChar(text.charAt(before));
        boolean rightClear = after >= text.length() || !isIdentifierChar(text.charAt(after));
        return leftClear && rightClear;
    }

    private static boolean isIdentifierChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == DOUBLE_QUOTE;
    }

    /** Index of the {@code )} closing the {@code (} at {@code open}, honouring quotes. */
    static int matchingParen(String text, int open) {
        int depth = 0;
        char quote = 0;
        for (int i = open; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quote != 0) {
                if (c == quote) {
                    quote = 0;
                }
                continue;
            }
            if (c == SINGLE_QUOTE || c == DOUBLE_QUOTE || c == BACKTICK) {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
            } else if (c == ')' && --depth == 0) {
                return i;
            }
        }
        return -1;
    }

    /** Swaps a column name inside an index's DDL, so a rename does not orphan its indexes. */
    static String renameColumnInSql(String sql, String oldName, String newName) {
        String quotedOld = Pattern.quote(QUOTE + oldName + QUOTE);
        String quotedNew = Matcher.quoteReplacement(QUOTE + newName + QUOTE);
        return sql
                .replaceAll(quotedOld, quotedNew)
                .replaceAll("\\b" + Pattern.quote(oldName) + "\\b",
                        Matcher.quoteReplacement(newName));
    }

    /** A type-appropriate default literal, or null when the type has no sensible one. */
    static String defaultLiteralFor(String type) {
        String base = type.toUpperCase();
        if (base.startsWith("VARCHAR") || base.startsWith("TEXT") || base.startsWith("CHAR")) {
            return "''";
        }
        if (base.startsWith("INT") || base.startsWith("DECIMAL") || base.startsWith("NUMERIC")
                || base.startsWith("REAL") || base.startsWith("FLOAT") || base.startsWith("DOUBLE")
                || base.startsWith("BOOL") || base.startsWith("BIT")) {
            return "0";
        }
        if (base.contains("DATE") || base.contains("TIME")) {
            return "'1970-01-01'";
        }
        return null;
    }
}
