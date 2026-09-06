package com.dbviewer.sql;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Rewrites a MySQL/MariaDB dump so SQLite can execute it.
 *
 * <p>The interesting part is not the syntax scrubbing but the <b>key folding</b>. A phpMyAdmin
 * dump declares primary keys, auto-increment and foreign keys <i>after</i> the fact:
 *
 * <pre>
 * CREATE TABLE `account` (`Acc_id` int(255) NOT NULL, ...) ENGINE=InnoDB;
 * ALTER TABLE `account` ADD PRIMARY KEY (`Acc_id`);
 * ALTER TABLE `account` MODIFY `Acc_id` int(255) NOT NULL AUTO_INCREMENT;
 * ALTER TABLE `account` ADD CONSTRAINT ... FOREIGN KEY (`Cust_id`) REFERENCES `customer` (`Cust_id`);
 * </pre>
 *
 * <p>SQLite supports none of those ALTER forms. Executed as-is they all fail, and the import
 * ends up with tables that have no primary keys and no relationships - so the diagram is a set
 * of disconnected boxes. This translator collects them and folds them into the originating
 * {@code CREATE TABLE} instead.
 */
public final class MySqlToSqliteTranslator {

    /** Translated statements, plus human-readable notes about anything dropped along the way. */
    public record Result(List<String> statements, List<String> notes) {
    }

    private static final Pattern CREATE_TABLE = Pattern.compile(
            "^CREATE\\s+(?:TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?([^\\s(]+)\\s*\\((.*)\\)([^)]*)$",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private static final Pattern ALTER_TABLE = Pattern.compile(
            "^ALTER\\s+TABLE\\s+(\\S+)\\s+(.*)$",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private static final Pattern ADD_PRIMARY_KEY = Pattern.compile(
            "ADD\\s+PRIMARY\\s+KEY\\s*\\(([^)]*)\\)", Pattern.CASE_INSENSITIVE);

    private static final Pattern INLINE_PRIMARY_KEY = Pattern.compile(
            "^PRIMARY\\s+KEY\\s*\\(([^)]*)\\)", Pattern.CASE_INSENSITIVE);

    private static final String FOREIGN_KEY_BODY =
            "FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+([^\\s(]+)\\s*\\(([^)]*)\\)"
                    + "((?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+(?:CASCADE|RESTRICT|NO\\s+ACTION|SET\\s+NULL|SET\\s+DEFAULT))*)";

    private static final Pattern ADD_FOREIGN_KEY = Pattern.compile(
            "ADD\\s+(?:CONSTRAINT\\s+\\S+\\s+)?" + FOREIGN_KEY_BODY,
            Pattern.CASE_INSENSITIVE);

    private static final Pattern INLINE_FOREIGN_KEY = Pattern.compile(
            "^(?:CONSTRAINT\\s+\\S+\\s+)?" + FOREIGN_KEY_BODY,
            Pattern.CASE_INSENSITIVE);

    private static final Pattern MODIFY_AUTO_INCREMENT = Pattern.compile(
            "(?:MODIFY|CHANGE)\\s+(?:COLUMN\\s+)?(\\S+)[^,]*?AUTO_INCREMENT",
            Pattern.CASE_INSENSITIVE);

    /** Client directives and MySQL-only objects that SQLite can neither run nor emulate. */
    private static final Pattern UNSUPPORTED = Pattern.compile(
            "^(SET|START\\s+TRANSACTION|BEGIN|COMMIT|ROLLBACK|LOCK\\s+TABLES|UNLOCK\\s+TABLES"
                    + "|USE|DELIMITER|FLUSH|GRANT|REVOKE"
                    + "|CREATE\\s+(?:DEFINER\\s*=\\s*\\S+\\s+)?(?:TRIGGER|PROCEDURE|FUNCTION|EVENT)"
                    + "|DROP\\s+(?:TRIGGER|PROCEDURE|FUNCTION|EVENT)"
                    + "|CREATE\\s+DATABASE|DROP\\s+DATABASE|ALTER\\s+DATABASE)\\b",
            Pattern.CASE_INSENSITIVE);

    /** Column attributes that are valid MySQL but rejected or meaningless in SQLite. */
    private static final Pattern COLUMN_NOISE = Pattern.compile(
            "\\s+(?:AUTO_INCREMENT"
                    + "|CHARACTER\\s+SET\\s+\\S+"
                    + "|COLLATE\\s+\\S+"
                    + "|COMMENT\\s+'(?:[^']|'')*'"
                    + "|ON\\s+UPDATE\\s+CURRENT_TIMESTAMP(?:\\(\\d*\\))?"
                    + "|UNSIGNED|ZEROFILL)",
            Pattern.CASE_INSENSITIVE);

    private MySqlToSqliteTranslator() {
    }

    public static Result translate(List<String> statements) {
        List<String> notes = new ArrayList<>();
        Map<String, TableExtras> extras = new LinkedHashMap<>();
        List<String> kept = new ArrayList<>();

        // Pass 1 - drop what SQLite cannot run, and harvest the ALTER TABLE key declarations.
        for (String statement : statements) {
            String trimmed = statement.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (UNSUPPORTED.matcher(trimmed).find()) {
                notes.add("Skipped MySQL-only statement: " + summarize(trimmed));
                continue;
            }
            Matcher alter = ALTER_TABLE.matcher(trimmed);
            if (alter.matches()) {
                collectAlter(unquote(alter.group(1)), alter.group(2), extras, notes);
                continue;
            }
            kept.add(trimmed);
        }

        // Pass 2 - fold the harvested keys into each CREATE TABLE.
        List<String> out = new ArrayList<>();
        Set<String> rewritten = new LinkedHashSet<>();
        for (String statement : kept) {
            Matcher create = CREATE_TABLE.matcher(statement);
            if (create.matches()) {
                String tableName = unquote(create.group(1));
                out.add(rewriteCreateTable(create, tableName, extras.get(tableName), notes));
                rewritten.add(tableName);
            } else {
                out.add(statement);
            }
        }

        // Keys addressed at a table this script never creates cannot be applied anywhere.
        extras.forEach((table, ex) -> {
            if (!rewritten.contains(table) && ex.hasAnything()) {
                notes.add("Ignored key definitions for `" + table
                        + "` because the script does not create that table here.");
            }
        });

        return new Result(out, notes);
    }

    // --- ALTER TABLE harvesting ----------------------------------------------

    private static void collectAlter(String table, String body,
                                     Map<String, TableExtras> extras, List<String> notes) {
        TableExtras ex = extras.computeIfAbsent(table, k -> new TableExtras());
        boolean recognised = false;

        Matcher pk = ADD_PRIMARY_KEY.matcher(body);
        while (pk.find()) {
            ex.primaryKey.addAll(splitColumnList(pk.group(1)));
            recognised = true;
        }

        Matcher fk = ADD_FOREIGN_KEY.matcher(body);
        while (fk.find()) {
            ex.foreignKeys.add(renderForeignKey(fk.group(1), fk.group(2), fk.group(3), fk.group(4)));
            recognised = true;
        }

        Matcher autoInc = MODIFY_AUTO_INCREMENT.matcher(body);
        while (autoInc.find()) {
            ex.autoIncrement.add(unquote(autoInc.group(1)));
            recognised = true;
        }

        if (!recognised) {
            notes.add("Skipped unsupported ALTER TABLE on `" + table + "`: " + summarize(body));
        }
    }

    // --- CREATE TABLE rewriting ----------------------------------------------

    private static String rewriteCreateTable(Matcher create, String tableName,
                                             TableExtras alterExtras, List<String> notes) {
        String quotedName = create.group(1);
        String body = create.group(2);

        TableExtras extras = alterExtras == null ? new TableExtras() : alterExtras;
        List<String> columnDefs = new ArrayList<>();
        List<String> columnNames = new ArrayList<>();
        List<String> primaryKey = new ArrayList<>(extras.primaryKey);
        List<String> foreignKeys = new ArrayList<>(extras.foreignKeys);
        Set<String> autoIncrement = new LinkedHashSet<>(extras.autoIncrement);

        for (String item : splitTopLevel(body)) {
            String trimmed = item.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String upper = trimmed.toUpperCase();

            Matcher inlinePk = INLINE_PRIMARY_KEY.matcher(trimmed);
            if (inlinePk.find()) {
                primaryKey.addAll(splitColumnList(inlinePk.group(1)));
                continue;
            }

            Matcher inlineFk = INLINE_FOREIGN_KEY.matcher(trimmed);
            if (inlineFk.find()) {
                foreignKeys.add(renderForeignKey(
                        inlineFk.group(1), inlineFk.group(2), inlineFk.group(3), inlineFk.group(4)));
                continue;
            }

            if (upper.startsWith("KEY ") || upper.startsWith("INDEX ")
                    || upper.startsWith("UNIQUE ") || upper.startsWith("FULLTEXT")
                    || upper.startsWith("SPATIAL") || upper.startsWith("CONSTRAINT")) {
                notes.add("Ignored index definition on `" + tableName + "`: " + summarize(trimmed));
                continue;
            }

            // Anything else is a column definition.
            String name = unquote(firstToken(trimmed));
            if (name.isEmpty()) {
                continue;
            }
            if (trimmed.toUpperCase().contains("AUTO_INCREMENT")) {
                autoIncrement.add(name);
            }
            columnNames.add(name);
            columnDefs.add(COLUMN_NOISE.matcher(trimmed).replaceAll("").trim());
        }

        // SQLite only accepts AUTOINCREMENT on a single-column INTEGER PRIMARY KEY, and it has
        // to be declared inline on the column rather than as a table-level constraint.
        boolean inlineKey = primaryKey.size() == 1
                && autoIncrement.contains(primaryKey.get(0))
                && columnNames.contains(primaryKey.get(0));

        if (inlineKey) {
            String keyColumn = primaryKey.get(0);
            int index = columnNames.indexOf(keyColumn);
            columnDefs.set(index, forceIntegerKey(columnDefs.get(index), keyColumn));
        }

        List<String> definitions = new ArrayList<>(columnDefs);
        if (!inlineKey && !primaryKey.isEmpty()) {
            List<String> present = primaryKey.stream().filter(columnNames::contains).toList();
            if (!present.isEmpty()) {
                definitions.add("PRIMARY KEY (" + String.join(", ", quoteAll(present)) + ")");
            }
        }
        definitions.addAll(foreignKeys);

        return "CREATE TABLE " + quotedName + " (\n  " + String.join(",\n  ", definitions) + "\n)";
    }

    /** Rewrites a column definition as {@code "name" INTEGER ... PRIMARY KEY AUTOINCREMENT}. */
    private static String forceIntegerKey(String columnDef, String columnName) {
        String rest = columnDef.substring(firstToken(columnDef).length()).trim();
        // Drop the declared type (e.g. int(255)); SQLite requires exactly INTEGER here.
        String withoutType = rest.replaceFirst("^\\S+(\\s*\\([^)]*\\))?", "").trim();
        // NOT NULL is implied by PRIMARY KEY and would be redundant noise.
        withoutType = withoutType.replaceAll("(?i)\\bNOT\\s+NULL\\b", "").trim();
        String tail = withoutType.isEmpty() ? "" : " " + withoutType;
        return "`" + columnName + "` INTEGER PRIMARY KEY AUTOINCREMENT" + tail;
    }

    private static String renderForeignKey(String columns, String targetTable,
                                           String targetColumns, String actions) {
        String normalisedActions = actions == null ? "" : actions.replaceAll("\\s+", " ").trim();
        return "FOREIGN KEY (" + String.join(", ", quoteAll(splitColumnList(columns))) + ")"
                + " REFERENCES `" + unquote(targetTable) + "`"
                + " (" + String.join(", ", quoteAll(splitColumnList(targetColumns))) + ")"
                + (normalisedActions.isEmpty() ? "" : " " + normalisedActions);
    }

    // --- Helpers -------------------------------------------------------------

    /** Splits on commas that sit outside parentheses and outside quotes. */
    static List<String> splitTopLevel(String body) {
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int depth = 0;
        char quote = 0;

        for (int i = 0; i < body.length(); i++) {
            char c = body.charAt(i);
            if (quote != 0) {
                current.append(c);
                if (c == '\\' && quote != '`' && i + 1 < body.length()) {
                    current.append(body.charAt(++i));
                } else if (c == quote) {
                    quote = 0;
                }
                continue;
            }
            switch (c) {
                case '\'', '"', '`' -> {
                    quote = c;
                    current.append(c);
                }
                case '(' -> {
                    depth++;
                    current.append(c);
                }
                case ')' -> {
                    depth--;
                    current.append(c);
                }
                case ',' -> {
                    if (depth == 0) {
                        parts.add(current.toString());
                        current.setLength(0);
                    } else {
                        current.append(c);
                    }
                }
                default -> current.append(c);
            }
        }
        parts.add(current.toString());
        return parts;
    }

    private static List<String> splitColumnList(String list) {
        List<String> columns = new ArrayList<>();
        for (String part : list.split(",")) {
            String name = unquote(part.trim());
            // phpMyAdmin can emit a prefix length, e.g. `Name`(20).
            name = name.replaceAll("\\s*\\(\\d+\\)$", "").trim();
            if (!name.isEmpty()) {
                columns.add(name);
            }
        }
        return columns;
    }

    private static List<String> quoteAll(List<String> names) {
        return names.stream().map(n -> "`" + n + "`").toList();
    }

    private static String firstToken(String definition) {
        String trimmed = definition.trim();
        if (trimmed.startsWith("`") || trimmed.startsWith("\"") || trimmed.startsWith("[")) {
            char close = trimmed.charAt(0) == '[' ? ']' : trimmed.charAt(0);
            int end = trimmed.indexOf(close, 1);
            return end < 0 ? trimmed : trimmed.substring(0, end + 1);
        }
        int space = trimmed.indexOf(' ');
        return space < 0 ? trimmed : trimmed.substring(0, space);
    }

    static String unquote(String identifier) {
        String trimmed = identifier == null ? "" : identifier.trim();
        if (trimmed.length() >= 2) {
            char first = trimmed.charAt(0);
            char last = trimmed.charAt(trimmed.length() - 1);
            if ((first == '`' && last == '`') || (first == '"' && last == '"')
                    || (first == '[' && last == ']')) {
                return trimmed.substring(1, trimmed.length() - 1);
            }
        }
        return trimmed;
    }

    private static String summarize(String statement) {
        String oneLine = statement.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 70 ? oneLine : oneLine.substring(0, 70) + "...";
    }

    private static final class TableExtras {
        private final List<String> primaryKey = new ArrayList<>();
        private final List<String> foreignKeys = new ArrayList<>();
        private final Set<String> autoIncrement = new LinkedHashSet<>();

        boolean hasAnything() {
            return !primaryKey.isEmpty() || !foreignKeys.isEmpty() || !autoIncrement.isEmpty();
        }
    }
}
