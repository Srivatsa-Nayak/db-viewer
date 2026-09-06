package com.dbviewer.service.impl;

import com.dbviewer.config.DatabaseConfig;
import com.dbviewer.dto.*;
import com.dbviewer.service.DatabaseService;
import com.dbviewer.sql.MySqlToSqliteTranslator;
import com.dbviewer.sql.SqlScriptSplitter;
import com.dbviewer.workspace.WorkspaceContext;
import com.dbviewer.workspace.WorkspaceManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class DatabaseServiceImpl implements DatabaseService {

    private final WorkspaceManager workspaceManager;
    private final DatabaseConfig databaseConfig;

    /**
     * Every statement below runs against the workspace bound to the current request,
     * so two SQL files open side by side can each own a table of the same name.
     * Requests without a workspace id fall back to the default datasource.
     */
    private JdbcTemplate jdbc() {
        return workspaceManager.current();
    }

    /**
     * Handles CSV and SQL file uploads. Mirrors HandleFileUpload in Go.
     */
    @Override
    public Map<String, Object> handleFileUpload(MultipartFile file) throws Exception {
        String filename = file.getOriginalFilename() != null
                ? file.getOriginalFilename().toLowerCase() : "";

        if (filename.endsWith(".sql")) {
            return handleSqlUpload(file);
        } else if (filename.endsWith(".csv")) {
            return handleCsvUpload(file);
        } else {
            throw new IllegalArgumentException("Only .csv and .sql files are supported");
        }
    }

    /**
     * Executes an uploaded .sql script one statement at a time, because JdbcTemplate cannot run
     * a multi-statement string.
     *
     * <p>Returns a report rather than a bare success message: a dump is rarely 100% portable, and
     * silently swallowing what could not be run is how an import ends up looking like it worked
     * while producing an empty canvas.
     */
    private Map<String, Object> handleSqlUpload(MultipartFile file) throws Exception {
        String content = new String(file.getBytes(), StandardCharsets.UTF_8);

        List<String> statements = SqlScriptSplitter.split(content);
        List<String> warnings = new ArrayList<>();

        if (isSqlite()) {
            MySqlToSqliteTranslator.Result translated = MySqlToSqliteTranslator.translate(statements);
            statements = translated.statements();
            warnings.addAll(translated.notes());
        }

        int executed = 0;
        List<String> failures = new ArrayList<>();
        for (String statement : statements) {
            try {
                jdbc().execute(statement);
                executed++;
            } catch (Exception e) {
                String reason = rootCauseMessage(e);
                failures.add(summarizeStatement(statement) + " - " + reason);
                log.warn("Skipping statement ({}): {}", reason, summarizeStatement(statement));
            }
        }

        warnings.addAll(failures);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("message", failures.isEmpty()
                ? "SQL executed successfully"
                : "SQL imported with " + failures.size() + " statement(s) skipped");
        result.put("type", "sql");
        result.put("statementsExecuted", executed);
        result.put("statementsSkipped", failures.size());
        // Capped so a pathological dump cannot return a megabyte of warnings.
        result.put("warnings", warnings.size() > 25 ? warnings.subList(0, 25) : warnings);
        result.put("warningCount", warnings.size());
        return result;
    }

    private String summarizeStatement(String statement) {
        String oneLine = statement.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 80 ? oneLine : oneLine.substring(0, 80) + "...";
    }

    private String rootCauseMessage(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        String message = cause.getMessage();
        return message == null || message.isBlank() ? cause.getClass().getSimpleName() : message.trim();
    }

    private Map<String, Object> handleCsvUpload(MultipartFile file) throws Exception {
        String originalName = file.getOriginalFilename() != null ? file.getOriginalFilename() : "upload.csv";
        String tableName = originalName
                .replaceAll("(?i)\\.csv$", "")
                .replaceAll("[\\s\\-]", "_");

        List<String[]> records = parseCsv(file);
        if (records.isEmpty()) {
            throw new IllegalArgumentException("CSV is empty");
        }

        String[] rawHeaders = records.get(0);
        String[] headers = Arrays.stream(rawHeaders)
                .map(h -> h.trim()
                        .replaceAll("\\s+", "_")
                        .replaceAll("/", "_")
                        .replaceAll("\\.", ""))
                .toArray(String[]::new);

        List<String[]> dataRows = records.size() > 1 ? records.subList(1, records.size()) : List.of();

        String[] columnTypes = guessColumnTypes(headers, dataRows);
        String createSql = buildSmartCreateTableSql(tableName, headers, columnTypes);
        jdbc().execute(createSql);

        if (!dataRows.isEmpty()) {
            insertData(tableName, headers, dataRows);
        }

        return Map.of(
                "message", "CSV uploaded successfully",
                "tableName", tableName,
                "columns", headers,
                "type", "csv"
        );
    }

    private List<String[]> parseCsv(MultipartFile file) throws Exception {
        List<String[]> rows = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                // Basic CSV split (handles quoted fields with commas)
                rows.add(parseCsvLine(line));
            }
        }
        return rows;
    }

    private String[] parseCsvLine(String line) {
        List<String> fields = new ArrayList<>();
        boolean inQuotes = false;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == ',' && !inQuotes) {
                fields.add(sb.toString());
                sb.setLength(0);
            } else {
                sb.append(c);
            }
        }
        fields.add(sb.toString());
        return fields.toArray(new String[0]);
    }

    // ─── Query Execution ──────────────────────────────────────────────────────────

    /**
     * Executes raw SQL. Mirrors HandleQuery.
     */
    @Override
    public List<Map<String, Object>> executeQuery(String sql) {
        String trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("SHOW")) {
            return jdbc().queryForList(sql);
        } else {
            // DML / DDL: execute and return affected rows
            int affected = jdbc().update(sql);
            return List.of(Map.of("affected_rows", affected));
        }
    }

    // ─── DB Info ─────────────────────────────────────────────────────────────────

    /**
     * Gets all table schemas and relationships. Mirrors HandleGetDBInfo.
     */
    @Override
    public Map<String, Object> getDbInfo() {
        List<String> tableNames = getTableNames();
        List<TableInfo> tables = new ArrayList<>();
        List<Relationship> relationships = new ArrayList<>();

        for (String tbl : tableNames) {
            List<ColumnInfo> columns = getColumnsForTable(tbl);
            List<Relationship> fks = getForeignKeys(tbl);
            relationships.addAll(fks);

            List<Map<String, Object>> rows = safeQueryRows("SELECT * FROM \"" + tbl + "\" LIMIT 100");
            tables.add(TableInfo.builder().name(tbl).columns(columns).rows(rows).build());
        }

        return Map.of("tables", tables, "relationships", relationships);
    }

    private List<String> getTableNames() {
        if (isMysql()) {
            return jdbc().queryForList("SHOW TABLES", String.class);
        }
        return jdbc().queryForList(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
                String.class);
    }

    private List<ColumnInfo> getColumnsForTable(String tableName) {
        List<ColumnInfo> columns = new ArrayList<>();
        if (isMysql()) {
            jdbc().query("DESCRIBE " + tableName, rs -> {
                columns.add(ColumnInfo.builder()
                        .name(rs.getString("Field"))
                        .type(rs.getString("Type"))
                        .pk("PRI".equalsIgnoreCase(rs.getString("Key")))
                        .notNull("NO".equalsIgnoreCase(rs.getString("Null")))
                        .build());
            });
        } else {
            jdbc().query("PRAGMA table_info(\"" + tableName + "\")", rs -> {
                String type = rs.getString("type");
                if (type == null || type.isEmpty()) type = "TEXT";
                columns.add(ColumnInfo.builder()
                        .name(rs.getString("name"))
                        .type(type)
                        // PRAGMA table_info reports pk as a 1-based position, 0 meaning "not a key".
                        .pk(rs.getInt("pk") > 0)
                        .notNull(rs.getInt("notnull") == 1)
                        .build());
            });
        }
        return columns;
    }

    private List<Relationship> getForeignKeys(String tableName) {
        List<Relationship> rels = new ArrayList<>();
        if (isMysql()) {
            String sql = """
                    SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                    WHERE TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
                    """;
            jdbc().query(sql, rs -> {
                rels.add(Relationship.builder()
                        .sourceTable(tableName)
                        .sourceColumn(rs.getString("COLUMN_NAME"))
                        .targetTable(rs.getString("REFERENCED_TABLE_NAME"))
                        .targetColumn(rs.getString("REFERENCED_COLUMN_NAME"))
                        .build());
            }, tableName);
        } else {
            jdbc().query("PRAGMA foreign_key_list(\"" + tableName + "\")", rs -> {
                rels.add(Relationship.builder()
                        .sourceTable(tableName)
                        .sourceColumn(rs.getString("from"))
                        .targetTable(rs.getString("table"))
                        .targetColumn(rs.getString("to"))
                        .build());
            });
        }
        return rels;
    }

    // ─── Table Data ───────────────────────────────────────────────────────────────

    /**
     * Gets columns and rows for a specific table. Mirrors HandleGetTableData.
     */
    @Override
    public Map<String, Object> getTableData(String tableName) {
        List<ColumnInfo> columns = getColumnsForTable(tableName);
        List<Map<String, Object>> rows = safeQueryRows("SELECT * FROM \"" + tableName + "\" LIMIT 100");
        return Map.of("columns", columns, "rows", rows);
    }

    // ─── Add Column ───────────────────────────────────────────────────────────────

    /**
     * Adds a column to an existing table. Mirrors HandleAddColumn.
     */
    @Override
    public void addColumn(AddColumnRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        String colName = req.getColumnName().replace(" ", "_");
        String baseType = req.getColumnType().toUpperCase();

        String typeDef = resolveTypeDef(baseType, req.getLength(), req.isNotNull());
        String sql = String.format("ALTER TABLE \"%s\" ADD COLUMN \"%s\" %s", tableName, colName, typeDef);
        jdbc().execute(sql);
    }

    private String resolveTypeDef(String baseType, int length, boolean notNull) {
        String typeDef = renderType(baseType, length);
        if (notNull) {
            // An existing table can only take a NOT NULL column if the rows already there
            // have something to fall back on.
            typeDef += " NOT NULL" + defaultClauseFor(baseType);
        }
        return typeDef;
    }

    /** Renders a base type plus length into a concrete column type, e.g. VARCHAR + 128 -> VARCHAR(128). */
    private String renderType(String baseType, int length) {
        return switch (baseType) {
            case "VARCHAR" -> "VARCHAR(" + (length == 0 ? 128 : length) + ")";
            case "INT" -> isSqlite() ? "INTEGER" : "INT";
            default -> baseType;
        };
    }

    private String defaultClauseFor(String type) {
        String literal = defaultLiteralFor(type);
        return literal == null ? "" : " DEFAULT " + literal;
    }

    /** A type-appropriate default literal, or null when the type has no sensible one. */
    private String defaultLiteralFor(String type) {
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

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /**
     * Normalises and validates a client-supplied identifier. Table and column names cannot be
     * bound as JDBC parameters, so anything outside {@code [A-Za-z0-9_]} is rejected outright
     * rather than escaped.
     */
    private String safeIdentifier(String raw, String what) {
        if (isBlank(raw)) {
            throw new IllegalArgumentException("Missing " + what);
        }
        String cleaned = raw.trim().replaceAll("[\\s\\-]+", "_");
        if (!cleaned.matches("[A-Za-z0-9_]+")) {
            throw new IllegalArgumentException("Invalid " + what + ": \"" + raw + "\"");
        }
        return cleaned;
    }

    // ─── Update Column ────────────────────────────────────────────────────────────

    /**
     * Renames a column and/or changes its type or nullability.
     *
     * <p>A pure rename is a one-statement {@code ALTER TABLE ... RENAME COLUMN} on both engines.
     * Anything else is engine-specific: MySQL has {@code CHANGE COLUMN}, but SQLite cannot alter
     * a column's type at all, so the table is rebuilt from its own metadata (the workaround
     * SQLite itself documents) - see {@link #rebuildSqliteTable}.
     */
    @Override
    public void updateColumn(UpdateColumnRequest req) {
        String tableName = safeIdentifier(req.getTableName(), "table name");
        String columnName = safeIdentifier(req.getColumnName(), "column name");

        List<ColumnInfo> columns = getColumnsForTable(tableName);
        ColumnInfo existing = columns.stream()
                .filter(c -> c.getName().equalsIgnoreCase(columnName))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Column \"" + columnName + "\" does not exist in \"" + tableName + "\""));

        String newName = isBlank(req.getNewColumnName())
                ? existing.getName()
                : safeIdentifier(req.getNewColumnName(), "column name");
        boolean renaming = !newName.equals(existing.getName());

        if (renaming && columns.stream().anyMatch(c -> c.getName().equalsIgnoreCase(newName))) {
            throw new IllegalArgumentException(
                    "Column \"" + newName + "\" already exists in \"" + tableName + "\"");
        }

        String newType = isBlank(req.getColumnType())
                ? existing.getType()
                : renderType(req.getColumnType().toUpperCase(), req.getLength());
        boolean typeChanged = !newType.equalsIgnoreCase(existing.getType());

        boolean newNotNull = req.getNotNull() == null ? existing.isNotNull() : req.getNotNull();
        boolean nullabilityChanged = newNotNull != existing.isNotNull();

        if (!renaming && !typeChanged && !nullabilityChanged) {
            return; // Nothing to do.
        }

        // A primary key carries identity, auto-increment and implicit NOT NULL. Reshaping it
        // would silently break row addressing, so only a rename is allowed.
        if (existing.isPk() && (typeChanged || nullabilityChanged)) {
            throw new IllegalArgumentException(
                    "Column \"" + existing.getName() + "\" is the primary key of \"" + tableName
                            + "\"; it can be renamed but its type and nullability cannot be changed");
        }

        if (!typeChanged && !nullabilityChanged) {
            renameColumn(tableName, existing.getName(), newName);
            return;
        }

        if (isMysql()) {
            String typeDef = newType + (newNotNull ? " NOT NULL" + defaultClauseFor(newType) : "");
            jdbc().execute(String.format("ALTER TABLE `%s` CHANGE COLUMN `%s` `%s` %s",
                    tableName, existing.getName(), newName, typeDef));
            return;
        }

        rebuildSqliteTable(tableName, existing.getName(), newName, newType, newNotNull);
    }

    private void renameColumn(String tableName, String from, String to) {
        String q = isMysql() ? "`" : "\"";
        jdbc().execute(String.format("ALTER TABLE %s%s%s RENAME COLUMN %s%s%s TO %s%s%s",
                q, tableName, q, q, from, q, q, to, q));
    }

    /**
     * Rebuilds a SQLite table so one column can change type or nullability, preserving the
     * other columns, the primary key, defaults and foreign keys.
     *
     * <p>This is the sequence SQLite documents for unsupported ALTERs: create a replacement
     * table, copy the rows across, drop the original, rename the replacement into place.
     */
    private void rebuildSqliteTable(String tableName, String oldColumn, String newColumn,
                                    String newType, boolean newNotNull) {
        List<SqliteColumn> columns = readSqliteColumns(tableName);
        List<String> foreignKeys = readSqliteForeignKeys(tableName);
        boolean autoIncrement = hasAutoIncrement(tableName);
        long pkCount = columns.stream().filter(c -> c.pkPosition() > 0).count();

        List<String> definitions = new ArrayList<>();
        List<String> targetColumns = new ArrayList<>();
        List<String> sourceExpressions = new ArrayList<>();

        for (SqliteColumn col : columns) {
            boolean isTarget = col.name().equals(oldColumn);
            String name = isTarget ? newColumn : col.name();
            String type = isTarget ? newType : col.type();
            boolean notNull = isTarget ? newNotNull : col.notNull();
            String defaultValue = col.defaultValue();

            // A column that is becoming NOT NULL needs a default, both for the column
            // definition and to fill in rows that are currently null.
            if (notNull && defaultValue == null) {
                defaultValue = defaultLiteralFor(type);
            }

            StringBuilder def = new StringBuilder("\"" + name + "\" " + type);
            boolean soleKey = pkCount == 1 && col.pkPosition() > 0;
            if (soleKey) {
                def.append(" PRIMARY KEY");
                if (autoIncrement && "INTEGER".equalsIgnoreCase(type)) {
                    def.append(" AUTOINCREMENT");
                }
            } else {
                if (notNull) def.append(" NOT NULL");
                if (defaultValue != null) def.append(" DEFAULT ").append(defaultValue);
            }
            definitions.add(def.toString());

            targetColumns.add("\"" + name + "\"");
            sourceExpressions.add(notNull && defaultValue != null
                    ? "COALESCE(\"" + col.name() + "\", " + defaultValue + ")"
                    : "\"" + col.name() + "\"");
        }

        if (pkCount > 1) {
            String composite = columns.stream()
                    .filter(c -> c.pkPosition() > 0)
                    .sorted(Comparator.comparingInt(SqliteColumn::pkPosition))
                    .map(c -> "\"" + (c.name().equals(oldColumn) ? newColumn : c.name()) + "\"")
                    .collect(Collectors.joining(", "));
            definitions.add("PRIMARY KEY (" + composite + ")");
        }
        definitions.addAll(foreignKeys);

        String temp = tableName + "__rebuild";
        // Restore whatever the connection had rather than forcing ON: a workspace holds one
        // long-lived connection, so flipping this permanently would change how every later
        // insert behaves.
        boolean foreignKeysWereOn = sqliteForeignKeysEnabled();
        jdbc().execute("PRAGMA foreign_keys = OFF");
        try {
            jdbc().execute("DROP TABLE IF EXISTS \"" + temp + "\"");
            jdbc().execute("CREATE TABLE \"" + temp + "\" (" + String.join(", ", definitions) + ")");
            jdbc().execute(String.format("INSERT INTO \"%s\" (%s) SELECT %s FROM \"%s\"",
                    temp,
                    String.join(", ", targetColumns),
                    String.join(", ", sourceExpressions),
                    tableName));
            jdbc().execute("DROP TABLE \"" + tableName + "\"");
            jdbc().execute("ALTER TABLE \"" + temp + "\" RENAME TO \"" + tableName + "\"");
        } catch (RuntimeException e) {
            // Leave the original table untouched rather than half-migrated.
            try {
                jdbc().execute("DROP TABLE IF EXISTS \"" + temp + "\"");
            } catch (Exception ignored) {
                // The cleanup failing must not mask the real error.
            }
            throw e;
        } finally {
            jdbc().execute("PRAGMA foreign_keys = " + (foreignKeysWereOn ? "ON" : "OFF"));
        }
    }

    /** Reads the connection's current PRAGMA foreign_keys setting (SQLite defaults it to off). */
    private boolean sqliteForeignKeysEnabled() {
        try {
            Integer enabled = jdbc().queryForObject("PRAGMA foreign_keys", Integer.class);
            return enabled != null && enabled == 1;
        } catch (Exception e) {
            return false;
        }
    }

    private List<SqliteColumn> readSqliteColumns(String tableName) {
        List<SqliteColumn> columns = new ArrayList<>();
        jdbc().query("PRAGMA table_info(\"" + tableName + "\")", rs -> {
            String type = rs.getString("type");
            if (type == null || type.isEmpty()) type = "TEXT";
            columns.add(new SqliteColumn(
                    rs.getString("name"),
                    type,
                    rs.getInt("notnull") == 1,
                    rs.getString("dflt_value"),
                    rs.getInt("pk")));
        });
        return columns;
    }

    /** Rebuilds each foreign key as a table-level constraint clause, grouping composite keys by id. */
    private List<String> readSqliteForeignKeys(String tableName) {
        Map<Integer, List<String>> fromColumns = new LinkedHashMap<>();
        Map<Integer, List<String>> toColumns = new LinkedHashMap<>();
        Map<Integer, String> targetTables = new LinkedHashMap<>();
        Map<Integer, String> onDelete = new LinkedHashMap<>();

        jdbc().query("PRAGMA foreign_key_list(\"" + tableName + "\")", rs -> {
            int id = rs.getInt("id");
            fromColumns.computeIfAbsent(id, k -> new ArrayList<>()).add("\"" + rs.getString("from") + "\"");
            toColumns.computeIfAbsent(id, k -> new ArrayList<>()).add("\"" + rs.getString("to") + "\"");
            targetTables.putIfAbsent(id, rs.getString("table"));
            onDelete.putIfAbsent(id, rs.getString("on_delete"));
        });

        List<String> clauses = new ArrayList<>();
        for (Integer id : fromColumns.keySet()) {
            String action = onDelete.get(id);
            clauses.add(String.format("FOREIGN KEY (%s) REFERENCES \"%s\"(%s)%s",
                    String.join(", ", fromColumns.get(id)),
                    targetTables.get(id),
                    String.join(", ", toColumns.get(id)),
                    action == null || action.isBlank() || "NO ACTION".equalsIgnoreCase(action)
                            ? "" : " ON DELETE " + action));
        }
        return clauses;
    }

    private boolean hasAutoIncrement(String tableName) {
        String ddl = getCreateTableSql(tableName);
        return ddl != null && ddl.toUpperCase().contains("AUTOINCREMENT");
    }

    /** Column metadata as reported by {@code PRAGMA table_info}. */
    private record SqliteColumn(String name, String type, boolean notNull, String defaultValue, int pkPosition) {
    }

    // ─── Update Cell ─────────────────────────────────────────────────────────────

    /**
     * Updates a single cell by record ID. Mirrors HandleUpdateCell.
     */
    @Override
    public void updateCell(UpdateCellRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        String colName = req.getColumnName().replace(" ", "_");
        String sql = String.format("UPDATE \"%s\" SET \"%s\" = ? WHERE id = ?", tableName, colName);
        jdbc().update(sql, req.getNewValue(), req.getRecordId());
    }

    // ─── Insert Row ───────────────────────────────────────────────────────────────

    /**
     * Inserts a row (empty or with data). Mirrors HandleInsertRow.
     */
    @Override
    public Map<String, Object> insertRow(InsertRowRequest req) {
        String tableName = req.getTableName();
        Map<String, Object> data = req.getData() != null ? req.getData() : new HashMap<>();

        // Strip id and empty values
        Map<String, Object> cleanData = data.entrySet().stream()
                .filter(e -> !e.getKey().equalsIgnoreCase("id"))
                .filter(e -> e.getValue() != null)
                .filter(e -> !(e.getValue() instanceof String s && s.trim().isEmpty()))
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));

        String q = isMysql() ? "`" : "\"";

        if (cleanData.isEmpty()) {
            String sql = isMysql()
                    ? String.format("INSERT INTO %s%s%s () VALUES ()", q, tableName, q)
                    : String.format("INSERT INTO %s%s%s DEFAULT VALUES", q, tableName, q);
            jdbc().execute(sql);
            return Map.of("message", "Row created");
        }

        List<String> cols = new ArrayList<>(cleanData.keySet());
        List<Object> vals = cols.stream().map(cleanData::get).collect(Collectors.toList());
        String colsSql = cols.stream().map(c -> q + c + q).collect(Collectors.joining(", "));
        String placeholders = cols.stream().map(c -> "?").collect(Collectors.joining(", "));

        String sql = String.format("INSERT INTO %s%s%s (%s) VALUES (%s)",
                q, tableName, q, colsSql, placeholders);
        jdbc().update(sql, vals.toArray());
        return Map.of("message", "Row added successfully");
    }

    // ─── Delete Row ───────────────────────────────────────────────────────────────

    /**
     * Deletes a row by id. Mirrors HandleDeleteRow.
     */
    @Override
    public void deleteRow(DeleteRowRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        jdbc().update("DELETE FROM \"" + tableName + "\" WHERE id = ?", req.getRecordId());
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    /**
     * Drops all tables. Mirrors HandleClearDatabase.
     */
    @Override
    public void clearDatabase() {
        List<String> tables = getTableNames();
        if (isMysql()) {
            jdbc().execute("SET FOREIGN_KEY_CHECKS = 0");
            for (String t : tables) {
                jdbc().execute("DROP TABLE IF EXISTS " + t);
            }
            jdbc().execute("SET FOREIGN_KEY_CHECKS = 1");
        } else {
            boolean foreignKeysWereOn = sqliteForeignKeysEnabled();
            jdbc().execute("PRAGMA foreign_keys = OFF");
            try {
                for (String t : tables) {
                    jdbc().execute("DROP TABLE IF EXISTS \"" + t + "\"");
                }
            } finally {
                jdbc().execute("PRAGMA foreign_keys = " + (foreignKeysWereOn ? "ON" : "OFF"));
            }
        }
    }

    // ─── List Workspaces ──────────────────────────────────────────────────────────

    /**
     * Lists the workspaces that still have a database. Not workspace-scoped: it is a global
     * listing used by the UI to restore the set of open files after a browser refresh.
     */
    @Override
    public List<String> listWorkspaces() {
        return workspaceManager.existingWorkspaceIds();
    }

    // ─── Delete Workspace ─────────────────────────────────────────────────────────

    /**
     * Throws the current workspace's database away entirely. Called when a file is
     * closed in the UI so its tables cannot resurface in a later session.
     */
    @Override
    public void deleteWorkspace() {
        String workspaceId = WorkspaceContext.get();
        if (workspaceId == null || workspaceId.isBlank()) {
            // No workspace scope on this request: the caller means the default database.
            clearDatabase();
            return;
        }
        workspaceManager.dropWorkspace(workspaceId);
    }

    // ─── Create Table ─────────────────────────────────────────────────────────────

    /**
     * Creates a new table from a definition. Mirrors HandleCreateTable.
     */
    public void createTable(CreateTableRequest req) {
        String tableName = req.getTableName().replace(" ", "_");
        String q = isMysql() ? "`" : "\"";

        List<String> colDefs = new ArrayList<>();
        List<String> fkDefs = new ArrayList<>();

        for (var col : req.getColumns()) {
            String colName = col.getName().replace(" ", "_");
            String baseType = col.getType().toUpperCase();
            String typeDef = buildColTypeDef(baseType, col.getLength(), col.isPk(), col.isNotNull());

            colDefs.add(String.format("%s%s%s %s", q, colName, q, typeDef));

            if (col.getRefTable() != null && !col.getRefTable().isEmpty()
                    && col.getRefCol() != null && !col.getRefCol().isEmpty()) {
                fkDefs.add(String.format(
                        "FOREIGN KEY (%s%s%s) REFERENCES %s%s%s(%s%s%s) ON DELETE CASCADE",
                        q, colName, q,
                        q, col.getRefTable(), q,
                        q, col.getRefCol(), q));
            }
        }

        List<String> allDefs = new ArrayList<>(colDefs);
        allDefs.addAll(fkDefs);
        String sql = String.format("CREATE TABLE %s%s%s (%s)", q, tableName, q,
                String.join(", ", allDefs));
        jdbc().execute(sql);
    }

    private String buildColTypeDef(String baseType, int length, boolean isPk, boolean notNull) {
        String typeDef = baseType.equals("VARCHAR")
                ? "VARCHAR(" + (length == 0 ? 128 : length) + ")"
                : (baseType.equals("INT") && isSqlite() ? "INTEGER" : baseType);

        if (isPk) {
            typeDef += isSqlite() ? " PRIMARY KEY AUTOINCREMENT" : " AUTO_INCREMENT PRIMARY KEY";
        } else {
            if (notNull) typeDef += " NOT NULL";
            if (baseType.equals("INT") || baseType.equals("INTEGER")) typeDef += " DEFAULT 0";
            if (baseType.equals("BOOLEAN")) typeDef += " DEFAULT 0";
        }
        return typeDef;
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────

    /**
     * Gets all rows from a table for CSV export. Mirrors HandleExportCSV.
     */
    public List<Map<String, Object>> getTableRows(String tableName) {
        return jdbc().queryForList("SELECT * FROM \"" + tableName + "\"");
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    /**
     * Generates a full SQL dump. Mirrors HandleExportDatabaseSQL.
     */
    public String exportDatabaseSql() {
        StringBuilder sb = new StringBuilder();
        sb.append("-- SQL Dump generated by SQL Visualizer\n");

        List<String> tables = getTableNames();
        String q = isMysql() ? "`" : "\"";

        for (String table : tables) {
            String createSql = getCreateTableSql(table);
            if (createSql != null && !createSql.isEmpty()) {
                sb.append(String.format("\n-- Structure for table `%s`\n", table));
                sb.append(String.format("DROP TABLE IF EXISTS `%s`;\n", table));
                sb.append(createSql).append(";\n\n");
            }

            sb.append(String.format("-- Data for table `%s`\n", table));
            List<Map<String, Object>> rows = safeQueryRows("SELECT * FROM \"" + table + "\"");
            List<String> colNames = rows.isEmpty() ? List.of()
                    : new ArrayList<>(rows.get(0).keySet());

            for (Map<String, Object> row : rows) {
                List<String> vals = colNames.stream()
                        .map(c -> {
                            Object v = row.get(c);
                            if (v == null) return "NULL";
                            return "'" + v.toString().replace("'", "''") + "'";
                        }).collect(Collectors.toList());
                sb.append(String.format("INSERT INTO %s%s%s (%s) VALUES (%s);\n",
                        q, table, q,
                        String.join(", ", colNames),
                        String.join(", ", vals)));
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private String getCreateTableSql(String table) {
        try {
            if (isMysql()) {
                return jdbc().queryForObject("SHOW CREATE TABLE " + table,
                        (rs, n) -> rs.getString(2));
            } else {
                return jdbc().queryForObject(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?",
                        String.class, table);
            }
        } catch (Exception e) {
            return null;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

    private void insertData(String tableName, String[] headers, List<String[]> rows) {
        String q = isMysql() ? "`" : "\"";
        String quotedHeaders = Arrays.stream(headers)
                .map(h -> q + h + q)
                .collect(Collectors.joining(", "));
        String placeholders = Arrays.stream(headers).map(h -> "?").collect(Collectors.joining(", "));
        String sql = String.format("INSERT INTO %s%s%s (%s) VALUES (%s)",
                q, tableName, q, quotedHeaders, placeholders);

        for (String[] row : rows) {
            Object[] args = new Object[row.length];
            for (int i = 0; i < row.length; i++) args[i] = row[i];
            jdbc().update(sql, args);
        }
    }

    private String[] guessColumnTypes(String[] headers, List<String[]> rows) {
        String[] types = new String[headers.length];
        for (int i = 0; i < headers.length; i++) {
            List<String> colValues = new ArrayList<>();
            for (String[] row : rows) {
                if (i < row.length) colValues.add(row[i]);
            }
            types[i] = inferColumnType(colValues);
        }
        return types;
    }

    private String inferColumnType(List<String> values) {
        if (values.isEmpty()) return "VARCHAR";
        Pattern intPat = Pattern.compile("^-?\\d+$");
        Pattern floatPat = Pattern.compile("^-?\\d*\\.\\d+$");
        boolean isInt = true, isFloat = true, isBool = true, hasData = false;

        for (String v : values) {
            if (v == null || v.isEmpty()) continue;
            hasData = true;
            if (!intPat.matcher(v).matches()) isInt = false;
            if (!floatPat.matcher(v).matches() && !intPat.matcher(v).matches()) isFloat = false;
            String lv = v.toLowerCase();
            if (!List.of("true", "false", "0", "1", "yes", "no").contains(lv)) isBool = false;
        }

        if (!hasData) return "VARCHAR";
        if (isBool) return "BOOL";
        if (isInt) return "INT";
        if (isFloat) return "DECIMAL";
        return "VARCHAR";
    }

    private String buildSmartCreateTableSql(String tableName, String[] headers, String[] types) {
        String q = isMysql() ? "`" : "\"";
        List<String> cols = new ArrayList<>();

        boolean hasId = Arrays.stream(headers).anyMatch(h -> h.equalsIgnoreCase("id"));

        if (!hasId) {
            cols.add(isMysql()
                    ? q + "id" + q + " INT AUTO_INCREMENT PRIMARY KEY"
                    : q + "id" + q + " INTEGER PRIMARY KEY AUTOINCREMENT");
        }

        for (int i = 0; i < headers.length; i++) {
            String header = headers[i];
            String colType = types[i];

            if (header.equalsIgnoreCase("id")) {
                colType = isSqlite() ? "INTEGER PRIMARY KEY" : "INT AUTO_INCREMENT PRIMARY KEY";
            } else if (isMysql() && colType.equals("TEXT")) {
                colType = "VARCHAR(255)";
            }
            cols.add(String.format("%s%s%s %s", q, header, q, colType));
        }

        return String.format("CREATE TABLE IF NOT EXISTS %s%s%s (%s);",
                q, tableName, q, String.join(", ", cols));
    }

    private List<Map<String, Object>> safeQueryRows(String sql) {
        try {
            return jdbc().queryForList(sql);
        } catch (Exception e) {
            log.warn("Failed to query rows: {}", e.getMessage());
            return List.of();
        }
    }

    public boolean isSqlite() {
        String driver = databaseConfig.getCurrentDriver();
        return "sqlite".equalsIgnoreCase(driver) || "sqlite3".equalsIgnoreCase(driver);
    }

    public boolean isMysql() {
        return "mysql".equalsIgnoreCase(databaseConfig.getCurrentDriver());
    }
}
