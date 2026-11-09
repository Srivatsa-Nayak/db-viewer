package com.dbviewer.app.sql;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Rewrites a dump written for MySQL, MariaDB, PostgreSQL or SQL Server so SQLite can execute it.
 *
 * <p>A workspace is a SQLite database, so every import is a translation. The syntax scrubbing is
 * the obvious half; the half that decides whether the canvas comes up connected or as a field of
 * disconnected boxes is <b>key folding</b>. Every one of these engines declares keys after the
 * fact, in statements SQLite cannot execute:
 *
 * <pre>
 * -- MySQL / phpMyAdmin
 * ALTER TABLE `account` ADD PRIMARY KEY (`Acc_id`);
 * ALTER TABLE `account` MODIFY `Acc_id` int(255) NOT NULL AUTO_INCREMENT;
 *
 * -- PostgreSQL / pg_dump
 * ALTER TABLE ONLY public.account ADD CONSTRAINT account_pkey PRIMARY KEY (acc_id);
 * ALTER TABLE ONLY public.account ALTER COLUMN acc_id SET DEFAULT nextval('account_id_seq');
 *
 * -- SQL Server
 * ALTER TABLE [dbo].[account] ADD CONSTRAINT [PK_account] PRIMARY KEY CLUSTERED ([Acc_id] ASC);
 * </pre>
 *
 * <p>Run as written they all fail, and the import finishes with tables that have no primary keys
 * and no relationships. This class collects them in a first pass and folds them into the
 * originating {@code CREATE TABLE} in a second, so the diagram is drawn from real metadata.
 *
 * <p><b>Graceful degradation is the rule.</b> Anything that cannot be represented — a trigger, a
 * stored procedure, an index, a storage option — is dropped with a note explaining what and why,
 * never by failing the import. A file that is half vendor-specific still produces every table it
 * can, and the user is told exactly what did not survive.
 */
public final class SqlDialectTranslator {

    /** Translated statements, the dialect they were read as, and notes about anything dropped. */
    public record Result(List<String> statements, List<String> notes, SqlDialect dialect) {
    }

    /* ── Statement shapes ────────────────────────────────────────────────────── */

    private static final Pattern CREATE_TABLE_HEAD = Pattern.compile(
            "^CREATE\\s+(?:(?:TEMPORARY|TEMP|GLOBAL|LOCAL|UNLOGGED)\\s+)*TABLE\\s+"
                    + "(?:IF\\s+NOT\\s+EXISTS\\s+)?([^\\s(]+)\\s*\\(",
            Pattern.CASE_INSENSITIVE);

    /** {@code ONLY} is pg_dump's; everything after the table name is the body of the change. */
    private static final Pattern ALTER_TABLE = Pattern.compile(
            "^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?(\\S+)\\s+(.*)$",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private static final String PRIMARY_KEY_BODY =
            "PRIMARY\\s+KEY(?:\\s+(?:CLUSTERED|NONCLUSTERED))?\\s*\\(([^)]*)\\)";

    private static final Pattern ADD_PRIMARY_KEY = Pattern.compile(
            "ADD\\s+(?:CONSTRAINT\\s+\\S+\\s+)?" + PRIMARY_KEY_BODY, Pattern.CASE_INSENSITIVE);

    private static final Pattern INLINE_PRIMARY_KEY = Pattern.compile(
            "^(?:CONSTRAINT\\s+\\S+\\s+)?" + PRIMARY_KEY_BODY, Pattern.CASE_INSENSITIVE);

    private static final String FOREIGN_KEY_BODY =
            "FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+([^\\s(]+)\\s*\\(([^)]*)\\)"
                    + "((?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+(?:CASCADE|RESTRICT|NO\\s+ACTION|SET\\s+NULL|SET\\s+DEFAULT))*)";

    private static final Pattern ADD_FOREIGN_KEY = Pattern.compile(
            "ADD\\s+(?:CONSTRAINT\\s+\\S+\\s+)?" + FOREIGN_KEY_BODY, Pattern.CASE_INSENSITIVE);

    private static final Pattern INLINE_FOREIGN_KEY = Pattern.compile(
            "^(?:CONSTRAINT\\s+\\S+\\s+)?" + FOREIGN_KEY_BODY, Pattern.CASE_INSENSITIVE);

    /**
     * A table-level unique constraint, in every vendor's spelling: {@code UNIQUE (a, b)},
     * {@code CONSTRAINT x UNIQUE (a)}, MySQL's {@code UNIQUE KEY name (a)}, SQL Server's
     * {@code UNIQUE NONCLUSTERED (a ASC)}. Ends at the opening parenthesis of the column list,
     * which is read with {@link #bodyOf} so a prefix length such as {@code (name(20))} survives.
     */
    private static final String UNIQUE_HEAD =
            "UNIQUE(?:\\s+(?:KEY|INDEX))?(?:\\s+(?!\\()[^\\s(]+)?\\s*\\(";

    private static final Pattern TABLE_UNIQUE = Pattern.compile(
            "^(?:CONSTRAINT\\s+\\S+\\s+)?" + UNIQUE_HEAD, Pattern.CASE_INSENSITIVE);

    private static final Pattern ADD_UNIQUE = Pattern.compile(
            "ADD\\s+(?:CONSTRAINT\\s+\\S+\\s+)?" + UNIQUE_HEAD, Pattern.CASE_INSENSITIVE);

    /** MySQL's inline secondary index: {@code KEY idx_name (col)} inside a CREATE TABLE. */
    private static final Pattern TABLE_INDEX = Pattern.compile(
            "^(?:KEY|INDEX)\\s+([^\\s(]+)\\s*(?:USING\\s+\\w+\\s*)?\\(", Pattern.CASE_INSENSITIVE);

    /** The same, added afterwards: phpMyAdmin's {@code ALTER TABLE t ADD KEY idx (col)}. */
    private static final Pattern ADD_INDEX = Pattern.compile(
            "ADD\\s+(UNIQUE\\s+)?(?:KEY|INDEX)\\s+([^\\s(]+)\\s*(?:USING\\s+\\w+\\s*)?\\(",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern TABLE_CHECK = Pattern.compile(
            "^(?:CONSTRAINT\\s+\\S+\\s+)?CHECK\\s*\\(", Pattern.CASE_INSENSITIVE);

    private static final Pattern ADD_CHECK = Pattern.compile(
            "ADD\\s+(?:CONSTRAINT\\s+\\S+\\s+)?CHECK\\s*\\(", Pattern.CASE_INSENSITIVE);

    /**
     * Functions a CHECK may call and still mean the same thing in SQLite. Anything else —
     * {@code char_length}, {@code len}, a regex operator — is engine-specific, and one unknown
     * function makes SQLite reject the whole CREATE TABLE, losing the table rather than the check.
     */
    private static final Set<String> PORTABLE_CALLS = Set.of(
            "IN", "AND", "OR", "NOT", "LENGTH", "LOWER", "UPPER", "ABS", "TRIM", "LTRIM", "RTRIM",
            "COALESCE", "IFNULL", "NULLIF", "SUBSTR", "ROUND");

    private static final Pattern CALL = Pattern.compile("\\b([A-Za-z_][A-Za-z0-9_]*)\\s*\\(");

    private static final Pattern NON_PORTABLE_CHECK = Pattern.compile(
            "~|@|#|\\$|::|\\bREGEXP\\b|\\bRLIKE\\b|\\bSIMILAR\\b|\\bILIKE\\b",
            Pattern.CASE_INSENSITIVE);

    /** MySQL's after-the-fact auto-increment: {@code ALTER TABLE t MODIFY id int AUTO_INCREMENT}. */
    private static final Pattern MODIFY_AUTO_INCREMENT = Pattern.compile(
            "(?:MODIFY|CHANGE)\\s+(?:COLUMN\\s+)?(\\S+)[^,]*?AUTO_INCREMENT",
            Pattern.CASE_INSENSITIVE);

    /** PostgreSQL's: a default that reads from a sequence is what makes a column serial. */
    private static final Pattern ALTER_COLUMN_NEXTVAL = Pattern.compile(
            "ALTER\\s+(?:COLUMN\\s+)?(\\S+)\\s+SET\\s+DEFAULT\\s+nextval\\s*\\(",
            Pattern.CASE_INSENSITIVE);

    /** Column-level {@code NOT NULL} added later, which we can fold back into the column. */
    private static final Pattern ALTER_COLUMN_SET_NOT_NULL = Pattern.compile(
            "ALTER\\s+(?:COLUMN\\s+)?(\\S+)\\s+SET\\s+NOT\\s+NULL", Pattern.CASE_INSENSITIVE);

    /**
     * Client directives and vendor-only objects that SQLite can neither run nor emulate.
     *
     * <p>One list across all four engines rather than one per engine: a rule that only ever drops
     * a statement is safe to apply to a script that never contained it, and a dump that mixes
     * vendors (an ORM-generated file, a hand-edited one) is then still handled.
     */
    private static final Pattern UNSUPPORTED = Pattern.compile(
            "^(SET|START\\s+TRANSACTION|BEGIN|COMMIT|ROLLBACK|LOCK\\s+TABLES|UNLOCK\\s+TABLES"
                    + "|USE|DELIMITER|FLUSH|GRANT|REVOKE|ANALYZE|VACUUM|CHECKPOINT"
                    // Objects with no SQLite equivalent, in every vendor's spelling.
                    + "|CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:DEFINER\\s*=\\s*\\S+\\s+)?"
                    + "(?:TRIGGER|PROCEDURE|FUNCTION|EVENT|SEQUENCE|TYPE|DOMAIN|EXTENSION"
                    + "|SCHEMA|AGGREGATE|OPERATOR|RULE|POLICY|SERVER|LANGUAGE|CAST)"
                    + "|DROP\\s+(?:TRIGGER|PROCEDURE|FUNCTION|EVENT|SEQUENCE|TYPE|DOMAIN"
                    + "|EXTENSION|SCHEMA|INDEX|POLICY)"
                    + "|ALTER\\s+(?:SEQUENCE|SCHEMA|TYPE|DOMAIN|FUNCTION|PROCEDURE|DEFAULT\\s+PRIVILEGES)"
                    + "|CREATE\\s+(?:DATABASE|DATABASE\\s+IF\\s+NOT\\s+EXISTS)|DROP\\s+DATABASE|ALTER\\s+DATABASE"
                    // PostgreSQL psql meta-commands and catalogue chatter.
                    + "|COMMENT\\s+ON|SELECT\\s+pg_catalog|\\\\connect|\\\\\\."
                    // SQL Server batch chatter.
                    + "|EXEC(?:UTE)?\\b|PRINT\\b|IF\\s+NOT\\s+EXISTS\\s*\\(|IF\\s+EXISTS\\s*\\("
                    // CREATE VIEW used to be listed here and dropped on import. SQLite supports
                // views perfectly well and the canvas now draws them, so discarding one silently
                // lost part of the schema the user was importing. A MATERIALIZED view is still
                // unsupported — SQLite has no equivalent — so only the plain form is let through.
                + "|CREATE\\s+(?:OR\\s+REPLACE\\s+)?MATERIALIZED\\s+VIEW)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Column attributes that are valid somewhere but rejected or meaningless in SQLite.
     *
     * <p>Anchored on {@code (?:^|\s+)} rather than {@code \s+}: by the time this runs the column
     * name and its type have been taken off the front, so the first attribute left has no
     * whitespace before it — and a {@code COLLATE utf8mb4_general_ci} that survives is not
     * cosmetic, it fails the entire CREATE TABLE with "no such collation sequence".
     */
    private static final Pattern COLUMN_NOISE = Pattern.compile(
            "(?:^|\\s+)(?:AUTO_INCREMENT"
                    + "|CHARACTER\\s+SET\\s+\\S+"
                    + "|COLLATE\\s+\\S+"
                    + "|COMMENT\\s+'(?:[^']|'')*'"
                    + "|ON\\s+UPDATE\\s+CURRENT_TIMESTAMP(?:\\(\\d*\\))?"
                    + "|NOT\\s+FOR\\s+REPLICATION"
                    + "|ROWGUIDCOL|SPARSE|FILESTREAM|UNSIGNED|ZEROFILL"
                    + "|STORAGE\\s+\\w+|DEFERRABLE|NOT\\s+DEFERRABLE|INITIALLY\\s+\\w+)",
            Pattern.CASE_INSENSITIVE);

    /** SQL Server's identity, in both the bare and seeded spellings. */
    private static final Pattern IDENTITY_CLAUSE = Pattern.compile(
            "\\s*\\bIDENTITY\\s*(?:\\(\\s*\\d+\\s*,\\s*\\d+\\s*\\))?", Pattern.CASE_INSENSITIVE);

    /** The ANSI spelling of the same idea, used by PostgreSQL 10+ and SQL Server 2012+. */
    private static final Pattern GENERATED_IDENTITY = Pattern.compile(
            "\\s*\\bGENERATED\\s+(?:ALWAYS|BY\\s+DEFAULT)\\s+AS\\s+IDENTITY(?:\\s*\\([^)]*\\))?",
            Pattern.CASE_INSENSITIVE);

    /** A default that draws from a sequence is auto-increment wearing a different hat. */
    private static final Pattern DEFAULT_NEXTVAL = Pattern.compile(
            "\\s*\\bDEFAULT\\s+nextval\\s*\\([^)]*\\)(?:::[\\w .\"]+)?", Pattern.CASE_INSENSITIVE);

    /** Generators SQLite has no equivalent for; the column simply gets no default. */
    private static final Pattern DEFAULT_UNSUPPORTED_FUNCTION = Pattern.compile(
            "\\s*\\bDEFAULT\\s*\\(?\\s*(?:NEWID|NEWSEQUENTIALID|gen_random_uuid|uuid_generate_v4"
                    + "|uuid_generate_v1|nanoid)\\s*\\(\\s*\\)\\s*\\)?",
            Pattern.CASE_INSENSITIVE);

    /** "Now", in each engine's spelling, all of which SQLite calls CURRENT_TIMESTAMP. */
    private static final Pattern DEFAULT_NOW = Pattern.compile(
            "\\bDEFAULT\\s*\\(?\\s*(?:GETDATE|GETUTCDATE|SYSDATETIME|SYSUTCDATETIME|now|clock_timestamp"
                    + "|statement_timestamp|CURRENT_TIMESTAMP)\\s*\\(\\s*\\)\\s*\\)?",
            Pattern.CASE_INSENSITIVE);

    /** PostgreSQL casts a default to its column type: {@code DEFAULT 'x'::character varying}. */
    private static final Pattern POSTGRES_CAST = Pattern.compile(
            "::\\s*[A-Za-z_][A-Za-z0-9_ ]*(?:\\(\\s*\\d+(?:\\s*,\\s*\\d+)?\\s*\\))?(?:\\[\\s*\\])?");

    /**
     * Leading type of a column definition.
     *
     * <p>Covers the multi-word spellings ({@code CHARACTER VARYING}, {@code DOUBLE PRECISION}),
     * the array suffix, the {@code WITH TIME ZONE} tail — and the quoting, because SQL Server
     * writes the <em>type</em> in brackets too: {@code [Name] [nvarchar](100)}.
     */
    private static final Pattern TYPE_HEAD = Pattern.compile(
            "^[\\[\"`]?(CHARACTER\\s+VARYING|DOUBLE\\s+PRECISION|BIT\\s+VARYING|[A-Za-z_][A-Za-z0-9_]*)[\\]\"`]?"
                    + "(\\s*\\(\\s*[^)]*\\))?"
                    + "((?:\\s*\\[\\s*\\])*)"
                    + "((?:\\s+WITH(?:OUT)?\\s+TIME\\s+ZONE)?)",
            Pattern.CASE_INSENSITIVE);

    /** A pg_dump bulk-load block, captured whole by the splitter and expanded here into INSERTs. */
    private static final Pattern COPY_FROM_STDIN = Pattern.compile(
            "^COPY\\s+([^\\s(]+)\\s*(?:\\(([^)]*)\\))?\\s+FROM\\s+stdin",
            Pattern.CASE_INSENSITIVE);

    /** SQL Server prefixes unicode literals; SQLite has no such marker and rejects the prefix. */
    private static final Pattern UNICODE_LITERAL_PREFIX = Pattern.compile("(?<![A-Za-z0-9_])N'");

    /** Target of an INSERT, which may be schema-qualified and may omit INTO on SQL Server. */
    private static final Pattern INSERT_TARGET = Pattern.compile(
            "^(INSERT\\s+(?:INTO\\s+)?)([^\\s(]+)", Pattern.CASE_INSENSITIVE);

    /** {@code CREATE [UNIQUE] INDEX name ON table (...)}, with the vendor decorations around it. */
    private static final Pattern CREATE_INDEX = Pattern.compile(
            "^CREATE\\s+(UNIQUE\\s+)?(?:CLUSTERED\\s+|NONCLUSTERED\\s+)?INDEX\\s+(\\S+)\\s+ON\\s+"
                    + "([^\\s(]+)\\s*(?:USING\\s+\\w+\\s*)?\\(([^)]*)\\)",
            Pattern.CASE_INSENSITIVE);

    /** A pathological dump must not turn into a million generated statements. */
    private static final int MAX_COPY_ROWS = 20_000;

    private SqlDialectTranslator() {
    }

    /** Translates with the dialect read off the script itself. */
    public static Result translate(List<String> statements) {
        return translate(statements, SqlDialectDetector.detect(String.join(";\n", statements)));
    }

    public static Result translate(List<String> statements, SqlDialect source) {
        return translate(statements, source, Map.of());
    }

    /**
     * @param typeOverrides types the user corrected in the pre-flight dialog, keyed by
     *                      {@code table.column} (or a bare {@code column}, applied to every table
     *                      that has one by that name). A declared type is still only a claim
     *                      about the data — a phone number declared {@code INT} in the source
     *                      dump loses its leading zeros here exactly as it did there — so a
     *                      script's types are correctable too, not just a CSV's.
     */
    public static Result translate(List<String> statements, SqlDialect source,
                                   Map<String, String> typeOverrides) {
        Map<String, String> overrides = normaliseOverrides(typeOverrides);
        List<String> notes = new ArrayList<>();
        Map<String, TableExtras> extras = new LinkedHashMap<>();
        List<String> kept = new ArrayList<>();

        // Pass 1 - drop what SQLite cannot run, expand bulk-load blocks, and harvest the
        // after-the-fact key declarations every one of these engines emits.
        for (String statement : statements) {
            String trimmed = statement.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

            Matcher copy = COPY_FROM_STDIN.matcher(trimmed);
            if (copy.find()) {
                kept.addAll(expandCopy(copy, trimmed, notes));
                continue;
            }

            if (UNSUPPORTED.matcher(trimmed).find()) {
                notes.add("Skipped " + source.label() + "-only statement: " + summarize(trimmed));
                continue;
            }

            Matcher alter = ALTER_TABLE.matcher(trimmed);
            if (alter.matches()) {
                collectAlter(normaliseTableName(alter.group(1)), alter.group(2), extras, notes);
                continue;
            }

            kept.add(trimmed);
        }

        // Pass 2 - fold the harvested keys into each CREATE TABLE, and normalise everything else.
        List<String> out = new ArrayList<>();
        Set<String> rewritten = new LinkedHashSet<>();
        for (String statement : kept) {
            Matcher create = CREATE_TABLE_HEAD.matcher(statement);
            if (create.find()) {
                String body = bodyOf(statement, create.end() - 1);
                if (body == null) {
                    notes.add("Skipped a CREATE TABLE with unbalanced parentheses: " + summarize(statement));
                    continue;
                }
                String tableName = normaliseTableName(create.group(1));
                out.addAll(rewriteCreateTable(tableName, body, extras.get(tableName), source,
                        overrides, notes));
                rewritten.add(tableName);
            } else {
                out.add(normaliseStatement(statement));
            }
        }

        // Keys addressed at a table this script never creates cannot be applied anywhere.
        extras.forEach((table, ex) -> {
            if (!rewritten.contains(table) && ex.hasAnything()) {
                notes.add("Ignored key definitions for `" + table
                        + "` because the script does not create that table here.");
            }
        });

        return new Result(out, notes, source);
    }

    /* ── ALTER TABLE harvesting ──────────────────────────────────────────────── */

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

        Matcher nextval = ALTER_COLUMN_NEXTVAL.matcher(body);
        while (nextval.find()) {
            ex.autoIncrement.add(unquote(nextval.group(1)));
            recognised = true;
        }

        Matcher notNull = ALTER_COLUMN_SET_NOT_NULL.matcher(body);
        while (notNull.find()) {
            ex.notNull.add(unquote(notNull.group(1)));
            recognised = true;
        }

        // Unique constraints, indexes and checks declared after the table: phpMyAdmin's
        // `ADD UNIQUE KEY` / `ADD KEY`, pg_dump's `ADD CONSTRAINT x UNIQUE (...)`, SQL Server's
        // `WITH CHECK ADD CONSTRAINT x CHECK (...)`. They used to be dropped with the rest of the
        // ALTER, which is why imported dumps arrived without their indexes.
        Matcher unique = ADD_UNIQUE.matcher(body);
        while (unique.find()) {
            List<String> columns = indexColumns(bodyOf(body, unique.end() - 1));
            if (columns != null) ex.uniques.add(columns);
            else notes.add("Ignored a unique constraint on `" + table + "` over an expression.");
            recognised = true;
        }

        Matcher index = ADD_INDEX.matcher(body);
        while (index.find()) {
            recognised = true;
            if (index.group(1) != null) {
                continue; // ADD UNIQUE KEY: already taken as a unique constraint above.
            }
            List<String> columns = indexColumns(bodyOf(body, index.end() - 1));
            if (columns != null) ex.indexes.add(new IndexSpec(unquote(index.group(2)), columns));
            else notes.add("Ignored an expression index on `" + table + "`.");
        }

        Matcher check = ADD_CHECK.matcher(body);
        while (check.find()) {
            String expression = bodyOf(body, check.end() - 1);
            String portable = expression == null ? null : portableCheck(expression);
            if (portable != null) ex.checks.add(portable);
            else notes.add("Ignored a CHECK on `" + table + "` that SQLite cannot evaluate: "
                    + summarize(expression == null ? body : expression));
            recognised = true;
        }

        if (!recognised) {
            // Enabling a constraint SQL Server had disabled is a no-op for us, not a warning
            // worth showing: the constraint itself was already folded in above.
            if (body.matches("(?is).*\\b(?:CHECK|NOCHECK)\\s+CONSTRAINT\\b.*")) {
                return;
            }
            notes.add("Skipped unsupported ALTER TABLE on `" + table + "`: " + summarize(body));
        }
    }

    /* ── CREATE TABLE rewriting ──────────────────────────────────────────────── */

    /**
     * Rewrites one CREATE TABLE for SQLite.
     *
     * @return the CREATE TABLE, followed by a CREATE INDEX for each secondary index the source
     *         declared on the table — SQLite has no inline index syntax, so they become separate
     *         statements
     */
    private static List<String> rewriteCreateTable(String tableName, String body, TableExtras alterExtras,
                                                   SqlDialect source, Map<String, String> overrides,
                                                   List<String> notes) {
        TableExtras extras = alterExtras == null ? new TableExtras() : alterExtras;
        List<String> columnDefs = new ArrayList<>();
        List<String> columnNames = new ArrayList<>();
        List<String> primaryKey = new ArrayList<>(extras.primaryKey);
        List<String> foreignKeys = new ArrayList<>(extras.foreignKeys);
        Set<String> autoIncrement = new LinkedHashSet<>(extras.autoIncrement);
        Set<String> inlinePrimaryKeys = new LinkedHashSet<>();
        List<List<String>> uniques = new ArrayList<>(extras.uniques);
        List<String> checks = new ArrayList<>(extras.checks);
        List<IndexSpec> indexes = new ArrayList<>(extras.indexes);

        for (String item : splitTopLevel(body)) {
            String trimmed = item.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

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

            Matcher unique = TABLE_UNIQUE.matcher(trimmed);
            if (unique.find()) {
                List<String> columns = indexColumns(bodyOf(trimmed, unique.end() - 1));
                if (columns != null) uniques.add(columns);
                else notes.add("Ignored a unique constraint on `" + tableName + "` over an expression: "
                        + summarize(trimmed));
                continue;
            }

            Matcher index = TABLE_INDEX.matcher(trimmed);
            if (index.find()) {
                List<String> columns = indexColumns(bodyOf(trimmed, index.end() - 1));
                if (columns != null) indexes.add(new IndexSpec(unquote(index.group(1)), columns));
                else notes.add("Ignored an expression index on `" + tableName + "`: " + summarize(trimmed));
                continue;
            }

            Matcher check = TABLE_CHECK.matcher(trimmed);
            if (check.find()) {
                String expression = bodyOf(trimmed, check.end() - 1);
                String portable = expression == null ? null : portableCheck(expression);
                if (portable != null) checks.add(portable);
                else notes.add("Ignored a CHECK on `" + tableName + "` that SQLite cannot evaluate: "
                        + summarize(trimmed));
                continue;
            }

            if (isConstraintOrIndex(trimmed)) {
                notes.add("Ignored index or constraint on `" + tableName + "`: " + summarize(trimmed));
                continue;
            }

            Column column = parseColumn(trimmed, source, overrides, tableName);
            if (column == null) {
                continue;
            }
            if (column.autoIncrement()) {
                autoIncrement.add(column.name());
            }
            if (column.inlinePrimaryKey()) {
                inlinePrimaryKeys.add(column.name());
            }
            if (extras.notNull.contains(column.name()) && !column.definition().toUpperCase(Locale.ROOT).contains("NOT NULL")) {
                columnDefs.add(column.definition() + " NOT NULL");
            } else {
                columnDefs.add(column.definition());
            }
            columnNames.add(column.name());
        }

        // A column that declared its own PRIMARY KEY keeps it; the harvested list is only for
        // keys that were declared elsewhere.
        primaryKey.removeIf(inlinePrimaryKeys::contains);

        // SQLite only accepts AUTOINCREMENT on a single-column INTEGER PRIMARY KEY, and only
        // when it is declared inline on the column rather than as a table-level constraint.
        boolean inlineKey = primaryKey.size() == 1
                && autoIncrement.contains(primaryKey.get(0))
                && columnNames.contains(primaryKey.get(0));

        if (inlineKey) {
            String keyColumn = primaryKey.get(0);
            int index = columnNames.indexOf(keyColumn);
            columnDefs.set(index, forceIntegerKey(columnDefs.get(index), keyColumn));
        } else {
            // The same shape, for a column that declared the key on itself.
            for (String keyColumn : inlinePrimaryKeys) {
                if (autoIncrement.contains(keyColumn)) {
                    int index = columnNames.indexOf(keyColumn);
                    if (index >= 0) {
                        columnDefs.set(index, forceIntegerKey(columnDefs.get(index), keyColumn));
                    }
                }
            }
        }

        List<String> definitions = new ArrayList<>(columnDefs);
        if (!inlineKey && !primaryKey.isEmpty()) {
            List<String> present = primaryKey.stream().filter(columnNames::contains).toList();
            if (!present.isEmpty()) {
                definitions.add("PRIMARY KEY (" + String.join(", ", quoteAll(present)) + ")");
            }
        }
        definitions.addAll(foreignKeys);

        // A constraint naming a column the table does not have would fail the whole CREATE
        // TABLE, so each is checked against the columns that were actually read.
        for (List<String> columns : uniques) {
            if (allPresent(columns, columnNames)) {
                definitions.add("UNIQUE (" + String.join(", ", columns) + ")");
            } else {
                notes.add("Ignored a unique constraint on `" + tableName + "` naming a column it does not have.");
            }
        }
        for (String expression : checks) {
            definitions.add("CHECK (" + expression + ")");
        }

        if (definitions.isEmpty()) {
            notes.add("Skipped `" + tableName + "`: no column definitions could be read from it.");
            return List.of("SELECT 1");
        }

        List<String> statements = new ArrayList<>();
        statements.add("CREATE TABLE \"" + tableName + "\" (\n  " + String.join(",\n  ", definitions) + "\n)");
        for (IndexSpec index : indexes) {
            if (!allPresent(index.columns(), columnNames)) {
                notes.add("Ignored index `" + index.name() + "` on `" + tableName
                        + "`: it names a column the table does not have.");
                continue;
            }
            // Prefixed with the table: MySQL scopes index names to their table, SQLite to the
            // whole database, and `IF NOT EXISTS` would otherwise silently skip the second
            // `idx_name` in a dump rather than create it.
            statements.add("CREATE INDEX IF NOT EXISTS \"" + tableName + "_" + index.name() + "\" ON \""
                    + tableName + "\" (" + String.join(", ", index.columns()) + ")");
        }
        return statements;
    }

    /**
     * An index's column list, quoted for SQLite, or null when it indexes an expression.
     *
     * <p>Keeps a sort direction and drops MySQL's prefix length ({@code name(20)}), which SQLite
     * has no use for: it indexes the whole value.
     */
    static List<String> indexColumns(String list) {
        if (list == null || list.isBlank()) {
            return null;
        }
        List<String> columns = new ArrayList<>();
        for (String part : splitTopLevel(list)) {
            String item = part.trim();
            String direction = "";
            Matcher dir = Pattern.compile("(?i)\\s+(ASC|DESC)$").matcher(item);
            if (dir.find()) {
                direction = " " + dir.group(1).toUpperCase(Locale.ROOT);
                item = item.substring(0, dir.start()).trim();
            }
            item = item.replaceAll("\\s*\\(\\d+\\)$", "").trim();
            boolean quoted = item.length() >= 2 && "`\"[".indexOf(item.charAt(0)) >= 0;
            String name = unquote(item);
            if (name.isEmpty() || (!quoted && !name.matches("[A-Za-z_][A-Za-z0-9_$]*"))) {
                return null;
            }
            columns.add("\"" + name + "\"" + direction);
        }
        return columns.isEmpty() ? null : columns;
    }

    private static boolean allPresent(List<String> quotedColumns, List<String> columnNames) {
        return quotedColumns.stream()
                .map(c -> c.replaceAll("(?i)\\s+(ASC|DESC)$", ""))
                .map(c -> c.substring(1, c.length() - 1))
                .allMatch(columnNames::contains);
    }

    /**
     * A CHECK expression rewritten for SQLite, or null when it would not mean the same thing
     * there (or would not parse at all).
     *
     * <p>Casts are dropped ({@code (0)::numeric}, pg_dump's habit), backtick and bracket
     * identifiers become double-quoted, and then the expression is kept only if it uses
     * operators and functions SQLite shares. A check that is dropped is reported; one that is
     * kept but wrong would fail the CREATE TABLE and lose the table.
     */
    static String portableCheck(String expression) {
        String e = POSTGRES_CAST.matcher(expression).replaceAll("");
        e = e.replaceAll("`([^`]+)`", "\"$1\"").replaceAll("\\[([^\\]]+)]", "\"$1\"");
        String withoutStrings = e.replaceAll("'(?:[^']|'')*'", "''");
        if (NON_PORTABLE_CHECK.matcher(withoutStrings).find()) {
            return null;
        }
        Matcher call = CALL.matcher(withoutStrings);
        while (call.find()) {
            if (!PORTABLE_CALLS.contains(call.group(1).toUpperCase(Locale.ROOT))) {
                return null;
            }
        }
        String result = e.trim();
        return result.isEmpty() ? null : result;
    }

    /** Table-level items that are neither a column nor a key we can keep. */
    private static boolean isConstraintOrIndex(String item) {
        String upper = item.toUpperCase(Locale.ROOT);
        return upper.startsWith("KEY ") || upper.startsWith("INDEX ")
                || upper.startsWith("UNIQUE") || upper.startsWith("FULLTEXT")
                || upper.startsWith("SPATIAL") || upper.startsWith("CONSTRAINT")
                || upper.startsWith("CHECK ") || upper.startsWith("CHECK(")
                || upper.startsWith("PERIOD FOR") || upper.startsWith("EXCLUDE ");
    }

    /** One parsed column definition, already rewritten for SQLite. */
    private record Column(String name, String definition, boolean autoIncrement,
                          boolean inlinePrimaryKey) {
    }

    /**
     * Rewrites one column definition.
     *
     * <p>The name and the declared type are taken apart so the type can be mapped (SQL Server's
     * {@code NVARCHAR(MAX)} and PostgreSQL's {@code integer[]} are both parse errors in SQLite),
     * and everything after it is scrubbed of attributes that do not exist here. What survives —
     * {@code NOT NULL}, {@code DEFAULT}, {@code UNIQUE}, an inline {@code REFERENCES} — is kept,
     * because those are the parts that still mean something.
     */
    private static Column parseColumn(String definition, SqlDialect source,
                                      Map<String, String> overrides, String tableName) {
        String name = unquote(firstToken(definition));
        if (name.isEmpty()) {
            return null;
        }

        String rest = definition.substring(firstToken(definition).length()).trim();
        boolean autoIncrement = definition.toUpperCase(Locale.ROOT).contains("AUTO_INCREMENT")
                || IDENTITY_CLAUSE.matcher(rest).find()
                || GENERATED_IDENTITY.matcher(rest).find()
                || DEFAULT_NEXTVAL.matcher(rest).find();

        String declaredType = "TEXT";
        Matcher type = TYPE_HEAD.matcher(rest);
        if (type.find()) {
            String base = type.group(1).replaceAll("\\s+", " ");
            String args = type.group(2) == null ? "" : type.group(2).trim();
            String array = type.group(3) == null ? "" : type.group(3).trim();
            String zone = type.group(4) == null ? "" : type.group(4).replaceAll("\\s+", " ");
            declaredType = array.isEmpty() ? base + args + zone : base + "[]";
            rest = rest.substring(type.end()).trim();
            autoIncrement = autoIncrement || base.toUpperCase(Locale.ROOT).endsWith("SERIAL");
        }

        String override = overrideFor(overrides, tableName, name);
        String mappedType = override != null
                ? override
                : SqlTypeMapper.toSqlite(declaredType, source);

        // Scrub the tail, in an order that matters: the sequence-backed default has to go before
        // the cast stripper turns `nextval('x'::regclass)` into something it no longer matches.
        String tail = rest;
        tail = DEFAULT_NEXTVAL.matcher(tail).replaceAll("");
        tail = DEFAULT_UNSUPPORTED_FUNCTION.matcher(tail).replaceAll("");
        tail = DEFAULT_NOW.matcher(tail).replaceAll("DEFAULT CURRENT_TIMESTAMP");
        tail = GENERATED_IDENTITY.matcher(tail).replaceAll("");
        tail = IDENTITY_CLAUSE.matcher(tail).replaceAll("");
        tail = POSTGRES_CAST.matcher(tail).replaceAll("");
        tail = COLUMN_NOISE.matcher(tail).replaceAll("");
        tail = tail.replaceAll("(?i)\\bNOT\\s+NULL\\b", "NOT NULL").trim();

        boolean inlinePk = tail.toUpperCase(Locale.ROOT).matches(".*\\bPRIMARY\\s+KEY\\b.*");

        String built = "\"" + name + "\" " + mappedType + (tail.isEmpty() ? "" : " " + tail);
        return new Column(name, built.replaceAll("\\s+", " ").trim(), autoIncrement, inlinePk);
    }

    /** Rewrites a column definition as {@code "name" INTEGER PRIMARY KEY AUTOINCREMENT}. */
    private static String forceIntegerKey(String columnDef, String columnName) {
        String rest = columnDef.substring(firstToken(columnDef).length()).trim();
        // Drop the declared type (int(255), bigint, SERIAL); SQLite requires exactly INTEGER here.
        String withoutType = rest.replaceFirst("^\\S+(\\s*\\([^)]*\\))?", "").trim();
        // Both are implied by the key and would be redundant - or, in the case of a repeated
        // PRIMARY KEY, a syntax error.
        withoutType = withoutType.replaceAll("(?i)\\bNOT\\s+NULL\\b", "")
                .replaceAll("(?i)\\bPRIMARY\\s+KEY\\b", "")
                .replaceAll("(?i)\\bAUTOINCREMENT\\b", "")
                .replaceAll("\\s+", " ")
                .trim();
        String tail = withoutType.isEmpty() ? "" : " " + withoutType;
        return "\"" + columnName + "\" INTEGER PRIMARY KEY AUTOINCREMENT" + tail;
    }

    private static String renderForeignKey(String columns, String targetTable,
                                           String targetColumns, String actions) {
        String normalisedActions = actions == null ? "" : actions.replaceAll("\\s+", " ").trim();
        return "FOREIGN KEY (" + String.join(", ", quoteAll(splitColumnList(columns))) + ")"
                + " REFERENCES \"" + normaliseTableName(targetTable) + "\""
                + " (" + String.join(", ", quoteAll(splitColumnList(targetColumns))) + ")"
                + (normalisedActions.isEmpty() ? "" : " " + normalisedActions);
    }

    /* ── Everything that is not a CREATE TABLE ───────────────────────────────── */

    /**
     * Makes a non-DDL statement portable: drops the schema qualifier from an INSERT target, the
     * unicode marker from SQL Server string literals, and the type casts from PostgreSQL values.
     */
    private static String normaliseStatement(String statement) {
        String result = statement;

        // An index is worth keeping - it is real schema - but only the ANSI core of it survives:
        // the access method, the fill-factor options and the filegroup are all vendor-only.
        Matcher index = CREATE_INDEX.matcher(result);
        if (index.find()) {
            return "CREATE " + (index.group(1) == null ? "" : "UNIQUE ")
                    + "INDEX IF NOT EXISTS \"" + normaliseTableName(index.group(2)) + "\""
                    + " ON \"" + normaliseTableName(index.group(3)) + "\""
                    + " (" + String.join(", ", quoteAll(splitColumnList(index.group(4)))) + ")";
        }

        // INTO is optional on SQL Server and mandatory everywhere else, so it is written back
        // rather than echoed.
        Matcher insert = INSERT_TARGET.matcher(result);
        if (insert.find()) {
            result = "INSERT INTO \"" + normaliseTableName(insert.group(2))
                    + "\"" + result.substring(insert.end());
        }

        result = UNICODE_LITERAL_PREFIX.matcher(result).replaceAll("'");
        result = POSTGRES_CAST.matcher(result).replaceAll("");
        return result;
    }

    /**
     * Turns a pg_dump {@code COPY ... FROM stdin} block into ordinary INSERTs.
     *
     * <p>Without this, the rows in a PostgreSQL dump are simply lost: the bulk-load protocol is a
     * psql client feature, so the data arrives as a block of tab-separated text that no JDBC
     * driver will accept. Those rows are usually the entire contents of the database.
     */
    private static List<String> expandCopy(Matcher header, String statement, List<String> notes) {
        String table = normaliseTableName(header.group(1));
        List<String> columns = header.group(2) == null ? List.of() : splitColumnList(header.group(2));

        int dataStart = statement.indexOf('\n', header.end());
        if (dataStart < 0 || columns.isEmpty()) {
            notes.add("Skipped a COPY block for `" + table + "`: its column list could not be read.");
            return List.of();
        }

        List<String> inserts = new ArrayList<>();
        String columnList = String.join(", ", quoteAll(columns));
        int skipped = 0;

        for (String line : statement.substring(dataStart + 1).split("\n", -1)) {
            String row = line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
            if (row.isEmpty() || row.equals("\\.")) {
                continue;
            }
            if (inserts.size() >= MAX_COPY_ROWS) {
                skipped++;
                continue;
            }
            String[] fields = row.split("\t", -1);
            if (fields.length != columns.size()) {
                skipped++;
                continue;
            }
            List<String> values = new ArrayList<>(fields.length);
            for (String field : fields) {
                values.add("\\N".equals(field) ? "NULL" : "'" + unescapeCopyField(field) + "'");
            }
            inserts.add("INSERT INTO \"" + table + "\" (" + columnList + ") VALUES ("
                    + String.join(", ", values) + ")");
        }

        if (skipped > 0) {
            notes.add("Loaded " + inserts.size() + " row(s) into `" + table + "`; "
                    + skipped + " could not be read from the COPY block.");
        }
        return inserts;
    }

    /** COPY escapes tabs, newlines and backslashes so a row can live on one line. */
    private static String unescapeCopyField(String field) {
        StringBuilder out = new StringBuilder(field.length());
        for (int i = 0; i < field.length(); i++) {
            char c = field.charAt(i);
            if (c == '\\' && i + 1 < field.length()) {
                char next = field.charAt(++i);
                switch (next) {
                    case 't' -> out.append('\t');
                    case 'n' -> out.append('\n');
                    case 'r' -> out.append('\r');
                    case '\\' -> out.append('\\');
                    default -> out.append(next);
                }
            } else if (c == '\'') {
                out.append("''");
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    /* ── Helpers ─────────────────────────────────────────────────────────────── */

    /**
     * Splits on commas that sit outside parentheses and outside quotes.
     *
     * <p>Public because the template catalogue parses {@code CREATE TABLE} bodies with it too:
     * splitting a column list on a bare comma breaks the moment a type carries its own
     * parentheses, as {@code DECIMAL(10, 2)} does.
     */
    public static List<String> splitTopLevel(String body) {
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

    /**
     * The text inside the {@code CREATE TABLE (...)} parentheses.
     *
     * <p>Found by balancing brackets rather than by regex, because the trailing table options
     * contain parentheses of their own on two of these engines — SQL Server's
     * {@code WITH (PAD_INDEX = OFF, ...)} and MySQL's {@code AUTO_INCREMENT=5} tail — and a
     * greedy regex swallows the first into the column list.
     */
    private static String bodyOf(String statement, int openParen) {
        int depth = 0;
        char quote = 0;
        for (int i = openParen; i < statement.length(); i++) {
            char c = statement.charAt(i);
            if (quote != 0) {
                if (c == quote) quote = 0;
                continue;
            }
            if (c == '\'' || c == '"' || c == '`') {
                quote = c;
                continue;
            }
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
                if (depth == 0) {
                    return statement.substring(openParen + 1, i);
                }
            }
        }
        return null;
    }

    private static List<String> splitColumnList(String list) {
        List<String> columns = new ArrayList<>();
        for (String part : list.split(",")) {
            String name = unquote(part.trim());
            // An index column can carry a sort direction, and phpMyAdmin can emit a prefix
            // length: `Name`(20) ASC.
            name = name.replaceAll("(?i)\\s+(?:ASC|DESC)$", "").trim();
            name = name.replaceAll("\\s*\\(\\d+\\)$", "").trim();
            name = unquote(name);
            if (!name.isEmpty()) {
                columns.add(name);
            }
        }
        return columns;
    }

    private static List<String> quoteAll(List<String> names) {
        return names.stream().map(n -> "\"" + n + "\"").toList();
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

    /**
     * Drops the schema qualifier and the quoting: {@code [dbo].[Users]} and
     * {@code public."users"} are both just {@code users} here.
     *
     * <p>A workspace is one flat database, so a schema prefix has nowhere to go — and leaving it
     * on would give the diagram a table called {@code public.users} that no foreign key, written
     * without the prefix, would ever match.
     */
    static String normaliseTableName(String raw) {
        String name = raw == null ? "" : raw.trim();
        // Split on a dot that is not inside quotes, and keep the last part.
        List<String> parts = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (quote != 0) {
                current.append(c);
                if (c == quote || (quote == '[' && c == ']')) quote = 0;
                continue;
            }
            if (c == '`' || c == '"' || c == '[') {
                quote = c;
                current.append(c);
            } else if (c == '.') {
                parts.add(current.toString());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        parts.add(current.toString());
        return unquote(parts.get(parts.size() - 1));
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

    /**
     * Lower-cases the override keys so lookup is case-insensitive.
     *
     * <p>Column names come from a dialog the user typed into against names a dump wrote in
     * whatever case it liked - {@code Cust_id} in the script, {@code cust_id} in the request -
     * and an override that silently does not apply is worse than one that is rejected.
     */
    private static Map<String, String> normaliseOverrides(Map<String, String> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<String, String> normalised = new LinkedHashMap<>();
        raw.forEach((key, value) -> {
            if (key != null && value != null && !value.isBlank() && isSafeType(value)) {
                normalised.put(key.trim().toLowerCase(Locale.ROOT), value.trim());
            }
        });
        return normalised;
    }

    /** A type goes into generated DDL unescaped, so anything but a plain type name is refused. */
    private static boolean isSafeType(String type) {
        return type.matches("(?i)\\s*[A-Za-z][A-Za-z0-9 ]*(\\(\\s*\\d+\\s*(,\\s*\\d+\\s*)?\\))?\\s*");
    }

    /** A {@code table.column} override wins over a bare {@code column} one. */
    private static String overrideFor(Map<String, String> overrides, String table, String column) {
        if (overrides.isEmpty()) {
            return null;
        }
        String qualified = overrides.get((table + "." + column).toLowerCase(Locale.ROOT));
        return qualified != null ? qualified : overrides.get(column.toLowerCase(Locale.ROOT));
    }

    private static String summarize(String statement) {
        String oneLine = statement.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 70 ? oneLine : oneLine.substring(0, 70) + "...";
    }

    /** Key metadata declared outside the CREATE TABLE it belongs to. */
    /** A secondary index: its name in the source, and its columns already quoted for SQLite. */
    private record IndexSpec(String name, List<String> columns) {
    }

    private static final class TableExtras {
        private final List<String> primaryKey = new ArrayList<>();
        private final List<String> foreignKeys = new ArrayList<>();
        private final Set<String> autoIncrement = new LinkedHashSet<>();
        private final Set<String> notNull = new LinkedHashSet<>();
        private final List<List<String>> uniques = new ArrayList<>();
        private final List<String> checks = new ArrayList<>();
        private final List<IndexSpec> indexes = new ArrayList<>();

        boolean hasAnything() {
            return !primaryKey.isEmpty() || !foreignKeys.isEmpty()
                    || !autoIncrement.isEmpty() || !notNull.isEmpty()
                    || !uniques.isEmpty() || !checks.isEmpty() || !indexes.isEmpty();
        }
    }
}
