package com.dbviewer.app.importing;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Reads a CSV file into rows.
 *
 * <p>Replaces a line-at-a-time reader that split on every comma outside a quote. That is right
 * often enough to look finished and wrong on three things real files do constantly: a quoted
 * field containing a newline (any address or free-text column), a doubled quote as the way to
 * write a literal one, and a file exported from a European locale, where the separator is a
 * semicolon because the comma is the decimal point.
 *
 * <p>The separator is therefore detected rather than assumed — from the header line, where the
 * true separator is the character that appears most consistently outside quotes.
 */
public final class CsvReader {

    /** A parsed file: its header row, its data rows, and the separator that was found. */
    public record CsvTable(List<String> headers, List<List<String>> rows, char delimiter) {

        public boolean isEmpty() {
            return headers.isEmpty();
        }

        /** The value at a column index, or null when the row is short. */
        public String valueAt(List<String> row, int column) {
            return column < row.size() ? row.get(column) : null;
        }
    }

    private static final char[] CANDIDATE_DELIMITERS = {',', ';', '\t', '|'};

    private CsvReader() {
    }

    public static CsvTable read(String content) {
        if (content == null || content.isBlank()) {
            return new CsvTable(List.of(), List.of(), ',');
        }

        // A byte-order mark survives as a character and would otherwise become part of the first
        // column's name, which then fails to match anything the user types.
        String text = content.charAt(0) == '﻿' ? content.substring(1) : content;
        char delimiter = detectDelimiter(text);

        List<List<String>> records = parse(text, delimiter);
        if (records.isEmpty()) {
            return new CsvTable(List.of(), List.of(), delimiter);
        }

        List<String> headers = new ArrayList<>();
        List<String> rawHeaders = records.get(0);
        for (int i = 0; i < rawHeaders.size(); i++) {
            headers.add(safeColumnName(rawHeaders.get(i), i, headers));
        }

        List<List<String>> rows = records.size() > 1
                ? new ArrayList<>(records.subList(1, records.size()))
                : List.of();

        // A trailing newline produces one empty record, which is not a row of data.
        rows.removeIf(row -> row.size() == 1 && (row.get(0) == null || row.get(0).isBlank()));

        return new CsvTable(headers, rows, delimiter);
    }

    /**
     * Turns a header cell into a usable column name.
     *
     * <p>Anything outside {@code [A-Za-z0-9_]} is replaced rather than quoted, because the name
     * goes on to be used in generated DDL and in the diagram. A blank or duplicate header still
     * has to produce something unique, or the CREATE TABLE fails on a file the user cannot see
     * anything wrong with.
     */
    private static String safeColumnName(String raw, int index, List<String> taken) {
        String cleaned = (raw == null ? "" : raw)
                .trim()
                .replaceAll("\\s+", "_")
                .replaceAll("[^A-Za-z0-9_]", "_")
                .replaceAll("_+", "_")
                .replaceAll("^_|_$", "");

        if (cleaned.isEmpty()) {
            cleaned = "column_" + (index + 1);
        }
        if (Character.isDigit(cleaned.charAt(0))) {
            cleaned = "c_" + cleaned;
        }

        String candidate = cleaned;
        int suffix = 2;
        while (containsIgnoreCase(taken, candidate)) {
            candidate = cleaned + "_" + suffix++;
        }
        return candidate;
    }

    private static boolean containsIgnoreCase(List<String> names, String candidate) {
        return names.stream().anyMatch(n -> n.equalsIgnoreCase(candidate));
    }

    /** The separator that carves the header into the most fields without splitting a quote. */
    private static char detectDelimiter(String text) {
        String header = firstLogicalLine(text);
        char best = ',';
        int bestCount = 0;
        for (char candidate : CANDIDATE_DELIMITERS) {
            int count = countOutsideQuotes(header, candidate);
            if (count > bestCount) {
                best = candidate;
                bestCount = count;
            }
        }
        return best;
    }

    /** The first line, ignoring newlines that are inside a quoted field. */
    private static String firstLogicalLine(String text) {
        boolean inQuotes = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == '\n' && !inQuotes) {
                return text.substring(0, i);
            }
        }
        return text;
    }

    private static int countOutsideQuotes(String line, char target) {
        boolean inQuotes = false;
        int count = 0;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == target && !inQuotes) {
                count++;
            }
        }
        return count;
    }

    /** RFC 4180 parsing: quoted fields may span lines, and {@code ""} is a literal quote. */
    private static List<List<String>> parse(String text, char delimiter) {
        List<List<String>> records = new ArrayList<>();
        List<String> current = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);

            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field.append(c);
                }
                continue;
            }

            if (c == '"' && field.isEmpty()) {
                inQuotes = true;
            } else if (c == delimiter) {
                current.add(field.toString());
                field.setLength(0);
            } else if (c == '\n') {
                current.add(field.toString());
                field.setLength(0);
                records.add(current);
                current = new ArrayList<>();
            } else if (c != '\r') {
                field.append(c);
            }
        }

        if (!field.isEmpty() || !current.isEmpty()) {
            current.add(field.toString());
            records.add(current);
        }
        return records;
    }

    /** A name for the table, derived from the file it came from. */
    public static String tableNameFor(String fileName) {
        String base = (fileName == null || fileName.isBlank() ? "imported_data" : fileName)
                .replaceAll("(?i)\\.csv$", "")
                .replaceAll("[^A-Za-z0-9_]", "_")
                .replaceAll("_+", "_")
                .replaceAll("^_|_$", "");
        if (base.isEmpty()) {
            base = "imported_data";
        }
        if (Character.isDigit(base.charAt(0))) {
            base = "t_" + base;
        }
        return base.toLowerCase(Locale.ROOT);
    }
}
