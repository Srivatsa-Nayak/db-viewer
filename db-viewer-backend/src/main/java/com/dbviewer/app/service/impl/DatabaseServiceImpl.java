package com.dbviewer.app.service.impl;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.config.DatabaseConfig;
import com.dbviewer.app.dto.*;
import com.dbviewer.app.importing.ColumnTypeInference;
import com.dbviewer.app.importing.CsvReader;
import com.dbviewer.app.importing.ImportAnalyzer;
import com.dbviewer.app.service.DatabaseService;
import com.dbviewer.app.exception.TableInUseException;
import com.dbviewer.app.sql.MySqlToSqliteTranslator;
import com.dbviewer.app.sql.SqlDialect;
import com.dbviewer.app.sql.SqlDialectDetector;
import com.dbviewer.app.sql.SqlDialectTranslator;
import com.dbviewer.app.sql.SqlExportWriter;
import com.dbviewer.app.sql.SqlScriptSplitter;
import com.dbviewer.app.sql.SqlTypeMapper;
import com.dbviewer.app.workspace.WorkspaceContext;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import com.dbviewer.app.workspace.WorkspaceManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class DatabaseServiceImpl implements DatabaseService {

    private final WorkspaceManager workspaceManager;
    private final DatabaseConfig databaseConfig;
    private final WorkspaceOwnershipService ownershipService;

    /**
     * Every statement below runs against the workspace bound to the current request,
     * so two SQL files open side by side can each own a table of the same name.
     * Requests without a workspace id fall back to the default datasource.
     */
    private JdbcTemplate jdbc() {
        return workspaceManager.current();
    }

    /**
     * Wraps an identifier in the quoting character the active engine uses.
     *
     * <p>Callers must have validated the name first - see {@link #safeIdentifier}. Quoting is
     * about letting reserved words and mixed case through, not about making untrusted input safe.
     */
    private String quote(String identifier) {
        String q = isMysql() ? Constants.Identifiers.MYSQL_QUOTE : Constants.Identifiers.STANDARD_QUOTE;
        return q + identifier + q;
    }

    /**
     * Handles CSV and SQL file uploads. Mirrors HandleFileUpload in Go.
     */
    @Override
    public Map<String, Object> handleFileUpload(MultipartFile file) throws Exception {
        return handleFileUpload(file, Map.of());
    }

    /**
     * Runs an import the user has already seen and approved.
     *
     * @param typeOverrides the types the user corrected in the pre-flight dialog, keyed by
     *                      column name for a CSV and by {@code table.column} for a script. An
     *                      empty map means "use what was inferred", which is what the plain
     *                      upload path passes.
     */
    @Override
    public Map<String, Object> handleFileUpload(MultipartFile file,
                                                Map<String, String> typeOverrides) throws Exception {
        String filename = file.getOriginalFilename() != null
                ? file.getOriginalFilename().toLowerCase() : "";
        Map<String, String> overrides = typeOverrides == null ? Map.of() : typeOverrides;

        if (filename.endsWith(".sql")) {
            return handleSqlUpload(file, overrides);
        } else if (filename.endsWith(".csv")) {
            return handleCsvUpload(file, overrides);
        } else {
            throw new IllegalArgumentException("Only .csv and .sql files are supported");
        }
    }

    /**
     * Reports what an upload would create, without creating any of it.
     *
     * <p>Deliberately free of side effects — it never touches the workspace database — so the
     * dialog it feeds can be cancelled with nothing to undo.
     */
    @Override
    public ImportPlan analyzeUpload(MultipartFile file) throws Exception {
        String filename = file.getOriginalFilename() == null ? "" : file.getOriginalFilename();
        String lower = filename.toLowerCase();
        if (!lower.endsWith(".sql") && !lower.endsWith(".csv")) {
            throw new IllegalArgumentException("Only .csv and .sql files are supported");
        }
        return ImportAnalyzer.analyze(filename, new String(file.getBytes(), StandardCharsets.UTF_8));
    }

    /**
     * Executes an uploaded .sql script one statement at a time, because JdbcTemplate cannot run
     * a multi-statement string.
     *
     * <p>Returns a report rather than a bare success message: a dump is rarely 100% portable, and
     * silently swallowing what could not be run is how an import ends up looking like it worked
     * while producing an empty canvas.
     */
    private Map<String, Object> handleSqlUpload(MultipartFile file,
                                                Map<String, String> typeOverrides) throws Exception {
        String content = new String(file.getBytes(), StandardCharsets.UTF_8);

        List<String> statements = SqlScriptSplitter.split(content);
        List<String> warnings = new ArrayList<>();
        SqlDialect dialect = SqlDialectDetector.detect(content);

        if (isSqlite()) {
            SqlDialectTranslator.Result translated =
                    SqlDialectTranslator.translate(statements, dialect, typeOverrides);
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
        // The engine the file was written for. Worth reporting even on a clean import: it is the
        // difference between "nothing was skipped" and "nothing was skipped, and it read this as
        // a PostgreSQL dump", which is what tells the user the translation was the right one.
        result.put("dialect", dialect.id());
        result.put("dialectLabel", dialect.label());
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

    /**
     * Creates a table from a CSV file and loads its rows.
     *
     * <p>Column types come from {@link ColumnTypeInference} unless the user corrected them in the
     * pre-flight dialog, in which case their choice wins outright — the whole point of showing
     * the plan is that the person looking at the data knows things the heuristic cannot.
     */
    private Map<String, Object> handleCsvUpload(MultipartFile file,
                                                Map<String, String> typeOverrides) throws Exception {
        String originalName = file.getOriginalFilename() != null
                ? file.getOriginalFilename() : "upload.csv";
        String tableName = safeIdentifier(CsvReader.tableNameFor(originalName), "table name");

        CsvReader.CsvTable csv = CsvReader.read(
                new String(file.getBytes(), StandardCharsets.UTF_8));
        if (csv.isEmpty()) {
            throw new IllegalArgumentException("CSV is empty");
        }

        List<String> headers = csv.headers();
        List<ColumnTypeInference.Proposal> proposals = ColumnTypeInference.propose(csv);

        List<String> resolvedTypes = new ArrayList<>();
        for (int i = 0; i < headers.size(); i++) {
            String header = headers.get(i);
            String chosen = firstNonBlank(
                    typeOverrides.get(header),
                    typeOverrides.get(tableName + "." + header),
                    proposals.get(i).inferredType());
            resolvedTypes.add(storageType(chosen));
        }

        jdbc().execute(buildCsvCreateTableSql(tableName, headers, resolvedTypes));

        int inserted = csv.rows().isEmpty() ? 0 : insertCsvRows(tableName, csv);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("message", "CSV uploaded successfully");
        result.put("tableName", tableName);
        result.put("columns", headers);
        result.put("type", "csv");
        result.put("rowsInserted", inserted);
        result.put("statementsExecuted", inserted + 1);
        result.put("statementsSkipped", csv.rows().size() - inserted);
        result.put("warnings", List.of());
        result.put("warningCount", 0);
        return result;
    }

    private static String firstNonBlank(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "VARCHAR(255)";
    }

    /**
     * Validates a requested column type and renders it for the engine actually in use.
     *
     * <p>A type cannot be a bind parameter, so anything that is not a plain type name with an
     * optional precision is rejected rather than escaped.
     */
    private String storageType(String requested) {
        if (!requested.matches("(?i)[A-Za-z][A-Za-z0-9 ]*(\\(\\s*\\d+\\s*(,\\s*\\d+\\s*)?\\))?")) {
            throw new IllegalArgumentException("Invalid column type: \"" + requested + "\"");
        }
        String sqliteForm = SqlTypeMapper.toSqlite(requested, SqlDialect.GENERIC);
        return isMysql() ? SqlTypeMapper.fromSqlite(sqliteForm, SqlDialect.MYSQL) : sqliteForm;
    }

    private String buildCsvCreateTableSql(String tableName, List<String> headers, List<String> types) {
        List<String> definitions = new ArrayList<>();
        boolean hasId = headers.stream().anyMatch(h -> h.equalsIgnoreCase("id"));

        // Row editing and deletion address a row by its id, so a CSV without one gets a key of
        // its own rather than being read-only once it is imported.
        if (!hasId) {
            definitions.add(quote("id") + " " + (isMysql()
                    ? Constants.Ddl.MYSQL_AUTO_INCREMENT_PK
                    : Constants.Ddl.SQLITE_AUTO_INCREMENT_PK));
        }

        for (int i = 0; i < headers.size(); i++) {
            String header = headers.get(i);
            String type = header.equalsIgnoreCase("id")
                    ? (isMysql() ? "INT AUTO_INCREMENT PRIMARY KEY" : "INTEGER PRIMARY KEY")
                    : types.get(i);
            definitions.add(quote(header) + " " + type);
        }

        return String.format(Constants.Tables.CREATE_TABLE_IF_NOT_EXISTS,
                quote(tableName), String.join(", ", definitions));
    }

    /**
     * Loads the rows in one batch.
     *
     * <p>An empty cell is written as NULL rather than as an empty string: on a column the user
     * has just declared to be a number or a date, {@code ''} is neither missing nor valid.
     */
    private int insertCsvRows(String tableName, CsvReader.CsvTable csv) {
        List<String> headers = csv.headers();
        String columnList = headers.stream().map(this::quote).collect(Collectors.joining(", "));
        String placeholders = headers.stream().map(h -> "?").collect(Collectors.joining(", "));
        String sql = String.format(Constants.Rows.INSERT, quote(tableName), columnList, placeholders);

        List<Object[]> batch = new ArrayList<>(csv.rows().size());
        for (List<String> row : csv.rows()) {
            Object[] args = new Object[headers.size()];
            for (int i = 0; i < headers.size(); i++) {
                String value = csv.valueAt(row, i);
                args[i] = value == null || value.isEmpty() ? null : value;
            }
            batch.add(args);
        }

        int[] results = jdbc().batchUpdate(sql, batch);
        return results.length;
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

            List<Map<String, Object>> rows = safeQueryRows(String.format(Constants.Rows.SELECT_ALL_LIMITED, tbl));
            tables.add(TableInfo.builder().name(tbl).columns(columns).rows(rows).build());
        }

        return Map.of("tables", tables, "relationships", relationships);
    }

    /**
     * User tables only. Internal bookkeeping (the `__` prefix) and the driver's own tables are
     * filtered out so they never reach the canvas, an export, or a table listing.
     */
    private List<String> getTableNames() {
        List<String> names = isMysql()
                ? jdbc().queryForList(Constants.Introspection.MYSQL_SHOW_TABLES, String.class)
                : jdbc().queryForList(Constants.Introspection.SQLITE_SELECT_USER_TABLES, String.class);
        return names.stream().filter(name -> !name.startsWith(INTERNAL_TABLE_PREFIX)).toList();
    }

    private static final String INTERNAL_TABLE_PREFIX = Constants.Identifiers.INTERNAL_TABLE_PREFIX;
    private static final String NOTES_TABLE = Constants.Identifiers.NOTES_TABLE;

    /** Created lazily so an untouched workspace stays completely empty. */
    private void ensureNotesTable() {
        jdbc().execute(String.format(Constants.Ddl.CREATE_NOTES_TABLE, NOTES_TABLE,
                isMysql() ? Constants.Ddl.MYSQL_AUTO_INCREMENT_PK
                          : Constants.Ddl.SQLITE_AUTO_INCREMENT_PK));
    }

    private List<ColumnInfo> getColumnsForTable(String tableName) {
        List<ColumnInfo> columns = new ArrayList<>();
        if (isMysql()) {
            jdbc().query(String.format(Constants.Introspection.MYSQL_DESCRIBE_TABLE, tableName), rs -> {
                columns.add(ColumnInfo.builder()
                        .name(rs.getString("Field"))
                        .type(rs.getString("Type"))
                        .pk("PRI".equalsIgnoreCase(rs.getString("Key")))
                        .notNull("NO".equalsIgnoreCase(rs.getString("Null")))
                        .build());
            });
        } else {
            jdbc().query(String.format(Constants.Introspection.SQLITE_TABLE_INFO, tableName), rs -> {
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
            jdbc().query(Constants.Introspection.MYSQL_FOREIGN_KEYS, rs -> {
                rels.add(Relationship.builder()
                        .sourceTable(tableName)
                        .sourceColumn(rs.getString("COLUMN_NAME"))
                        .targetTable(rs.getString("REFERENCED_TABLE_NAME"))
                        .targetColumn(rs.getString("REFERENCED_COLUMN_NAME"))
                        .build());
            }, tableName);
        } else {
            jdbc().query(String.format(Constants.Introspection.SQLITE_FOREIGN_KEY_LIST, tableName), rs -> {
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
        List<Map<String, Object>> rows = safeQueryRows(String.format(Constants.Rows.SELECT_ALL_LIMITED, tableName));
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
        String sql = String.format(Constants.Tables.ADD_COLUMN, tableName, colName, typeDef);
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
            jdbc().execute(String.format(Constants.Tables.MYSQL_CHANGE_COLUMN,
                    tableName, existing.getName(), newName, typeDef));
            return;
        }

        rebuildSqliteTable(tableName, existing.getName(), newName, newType, newNotNull);
    }

    private void renameColumn(String tableName, String from, String to) {
        jdbc().execute(String.format(Constants.Tables.RENAME_COLUMN,
                quote(tableName), quote(from), quote(to)));
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

        String temp = tableName + Constants.Identifiers.REBUILD_TABLE_SUFFIX;
        // Restore whatever the connection had rather than forcing ON: a workspace holds one
        // long-lived connection, so flipping this permanently would change how every later
        // insert behaves.
        boolean foreignKeysWereOn = sqliteForeignKeysEnabled();
        jdbc().execute(Constants.Session.SQLITE_FOREIGN_KEYS_OFF);
        try {
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, temp));
            jdbc().execute(String.format(Constants.Tables.CREATE_TABLE,
                    quote(temp), String.join(", ", definitions)));
            jdbc().execute(String.format(Constants.Tables.COPY_ROWS,
                    temp,
                    String.join(", ", targetColumns),
                    String.join(", ", sourceExpressions),
                    tableName));
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE, quote(tableName)));
            jdbc().execute(String.format(Constants.Tables.RENAME_TABLE, temp, tableName));
        } catch (RuntimeException e) {
            // Leave the original table untouched rather than half-migrated.
            try {
                jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, temp));
            } catch (Exception ignored) {
                // The cleanup failing must not mask the real error.
            }
            throw e;
        } finally {
            jdbc().execute(String.format(Constants.Session.SQLITE_SET_FOREIGN_KEYS,
                    foreignKeysWereOn ? "ON" : "OFF"));
        }
    }

    /** Reads the connection's current PRAGMA foreign_keys setting (SQLite defaults it to off). */
    private boolean sqliteForeignKeysEnabled() {
        try {
            Integer enabled = jdbc().queryForObject(
                    Constants.Session.SQLITE_READ_FOREIGN_KEYS, Integer.class);
            return enabled != null && enabled == 1;
        } catch (Exception e) {
            return false;
        }
    }

    private List<SqliteColumn> readSqliteColumns(String tableName) {
        List<SqliteColumn> columns = new ArrayList<>();
        jdbc().query(String.format(Constants.Introspection.SQLITE_TABLE_INFO, tableName), rs -> {
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

        jdbc().query(String.format(Constants.Introspection.SQLITE_FOREIGN_KEY_LIST, tableName), rs -> {
            int id = rs.getInt("id");
            fromColumns.computeIfAbsent(id, k -> new ArrayList<>()).add("\"" + rs.getString("from") + "\"");
            toColumns.computeIfAbsent(id, k -> new ArrayList<>()).add("\"" + rs.getString("to") + "\"");
            targetTables.putIfAbsent(id, rs.getString("table"));
            onDelete.putIfAbsent(id, rs.getString("on_delete"));
        });

        List<String> clauses = new ArrayList<>();
        for (Integer id : fromColumns.keySet()) {
            String action = onDelete.get(id);
            clauses.add(String.format(Constants.Tables.FOREIGN_KEY_CLAUSE,
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
        String sql = String.format(Constants.Rows.UPDATE_CELL_BY_ID, tableName, colName);
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

        if (cleanData.isEmpty()) {
            String sql = isMysql()
                    ? String.format(Constants.Rows.MYSQL_INSERT_EMPTY, quote(tableName))
                    : String.format(Constants.Rows.SQLITE_INSERT_DEFAULTS, quote(tableName));
            jdbc().execute(sql);
            return Map.of("message", "Row created");
        }

        List<String> cols = new ArrayList<>(cleanData.keySet());
        List<Object> vals = cols.stream().map(cleanData::get).collect(Collectors.toList());
        String colsSql = cols.stream().map(this::quote).collect(Collectors.joining(", "));
        String placeholders = cols.stream().map(c -> "?").collect(Collectors.joining(", "));

        String sql = String.format(Constants.Rows.INSERT, quote(tableName), colsSql, placeholders);
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
        jdbc().update(String.format(Constants.Rows.DELETE_BY_ID, tableName), req.getRecordId());
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    /**
     * Drops all tables. Mirrors HandleClearDatabase.
     */
    @Override
    public void clearDatabase() {
        List<String> tables = getTableNames();
        // Notes describe tables that are about to stop existing.
        try {
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, NOTES_TABLE));
        } catch (Exception e) {
            log.warn("Could not clear table notes: {}", e.getMessage());
        }
        if (isMysql()) {
            jdbc().execute(Constants.Session.MYSQL_FOREIGN_KEY_CHECKS_OFF);
            for (String t : tables) {
                jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS, t));
            }
            jdbc().execute(Constants.Session.MYSQL_FOREIGN_KEY_CHECKS_ON);
        } else {
            boolean foreignKeysWereOn = sqliteForeignKeysEnabled();
            jdbc().execute(Constants.Session.SQLITE_FOREIGN_KEYS_OFF);
            try {
                for (String t : tables) {
                    jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, t));
                }
            } finally {
                jdbc().execute(String.format(Constants.Session.SQLITE_SET_FOREIGN_KEYS,
                        foreignKeysWereOn ? "ON" : "OFF"));
            }
        }
    }

    // ─── List Workspaces ──────────────────────────────────────────────────────────

    /**
     * Lists the workspaces that still have a database. Not workspace-scoped: it is a global
     * listing used by the UI to restore the set of open files after a browser refresh.
     */
    @Override
    public List<WorkspaceOwnershipService.OwnedWorkspace> listWorkspaces() {
        // Narrowed to the caller. This is what the UI restores a session from, so returning
        // every workspace on the machine would put other people's files in your explorer.
        return ownershipService.listOwned(workspaceManager.existingWorkspaceIds());
    }

    /**
     * Records the file name against the workspace on the current request.
     *
     * <p>The ownership filter has already established that this workspace is the caller's, so
     * there is nothing further to check here.
     */
    @Override
    public void setWorkspaceName(String fileName) {
        String workspaceId = WorkspaceContext.get();
        if (workspaceId == null || workspaceId.isBlank()) {
            return;
        }
        if (fileName == null || fileName.isBlank()) {
            throw new IllegalArgumentException("A file name cannot be empty.");
        }
        if (fileName.length() > 255) {
            throw new IllegalArgumentException("A file name can be at most 255 characters.");
        }
        ownershipService.rename(workspaceId, fileName.trim());
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
        ownershipService.release(workspaceId);
    }

    // ─── Example Schema ───────────────────────────────────────────────────────────

    /**
     * Runs a starter script into the current workspace.
     *
     * <p>Refuses when the workspace already has tables: a template is meant to be a starting
     * point, and merging one into an existing schema would collide on table names rather than
     * produce anything useful.
     *
     * <p>Goes through the same splitter and translator as an uploaded .sql file, so a template
     * behaves exactly like a file the user imported themselves. Unlike an upload, a failing
     * statement is fatal - these scripts ship with the app, so a failure is our bug, not the
     * user's malformed input, and half-applying it would be worse than reporting it.
     */
    @Override
    public Map<String, Object> runScript(String script) {
        if (!getTableNames().isEmpty()) {
            throw new IllegalArgumentException(
                    "This file already has tables. Create a new file to start from a template.");
        }

        List<String> statements = SqlScriptSplitter.split(script);
        if (isMysql()) {
            statements = MySqlToSqliteTranslator.translate(statements).statements();
        }
        for (String statement : statements) {
            jdbc().execute(statement);
        }

        return Map.of("message", "Schema loaded", "tables", getTableNames());
    }

    // ─── Drop Table ───────────────────────────────────────────────────────────────

    /**
     * Drops a table, unless another table's foreign key points at it.
     *
     * <p>Refusing is the point. SQLite would happily drop a parent table and leave the children
     * with dangling references (foreign key enforcement is off by default), so the check is done
     * here rather than left to the database.
     */
    @Override
    public void dropTable(String tableName) {
        String table = safeIdentifier(tableName, "table name");

        if (!getTableNames().contains(table)) {
            throw new IllegalArgumentException("Table \"" + table + "\" does not exist.");
        }

        List<String> dependents = tablesReferencing(table);
        if (!dependents.isEmpty()) {
            throw new TableInUseException(table, dependents);
        }

        jdbc().execute(String.format(Constants.Tables.DROP_TABLE, quote(table)));

        // The notes were about a table that no longer exists.
        try {
            ensureNotesTable();
            jdbc().update(String.format(Constants.Notes.DELETE_FOR_TABLE, NOTES_TABLE), table);
        } catch (Exception e) {
            log.warn("Could not clean up notes for dropped table {}: {}", table, e.getMessage());
        }
    }

    /** Names of other tables holding a foreign key that references the given table. */
    private List<String> tablesReferencing(String tableName) {
        List<String> dependents = new ArrayList<>();
        for (String other : getTableNames()) {
            if (other.equalsIgnoreCase(tableName)) {
                continue;
            }
            boolean references = getForeignKeys(other).stream()
                    .anyMatch(fk -> tableName.equalsIgnoreCase(fk.getTargetTable()));
            if (references) {
                dependents.add(other);
            }
        }
        return dependents;
    }

    // ─── Table Notes ──────────────────────────────────────────────────────────────

    /**
     * Notes attached to a table - a to-do list the user can come back to.
     *
     * <p>Stored inside the workspace database so they travel with the file, and prefixed with
     * `__` so the table never shows up on the canvas or in an export.
     */
    @Override
    public List<Map<String, Object>> getTableNotes(String tableName) {
        ensureNotesTable();
        String table = safeIdentifier(tableName, "table name");
        return jdbc().queryForList(
                String.format(Constants.Notes.SELECT_FOR_TABLE, NOTES_TABLE), table);
    }

    /** Every note in the workspace, so the UI can badge which tables have open items. */
    @Override
    public List<Map<String, Object>> getAllTableNotes() {
        ensureNotesTable();
        return jdbc().queryForList(String.format(Constants.Notes.SELECT_ALL, NOTES_TABLE));
    }

    @Override
    public Map<String, Object> addTableNote(String tableName, String note) {
        ensureNotesTable();
        String table = safeIdentifier(tableName, "table name");
        if (note == null || note.isBlank()) {
            throw new IllegalArgumentException("A note cannot be empty.");
        }
        if (note.length() > 2000) {
            throw new IllegalArgumentException("A note can be at most 2000 characters.");
        }
        jdbc().update(String.format(Constants.Notes.INSERT, NOTES_TABLE),
                table, note.trim(), java.time.Instant.now().toString());
        return Map.of("message", "Note added");
    }

    @Override
    public void setTableNoteDone(long noteId, boolean done) {
        ensureNotesTable();
        int updated = jdbc().update(
                String.format(Constants.Notes.SET_DONE, NOTES_TABLE), done ? 1 : 0, noteId);
        if (updated == 0) {
            throw new IllegalArgumentException("No such note.");
        }
    }

    @Override
    public void deleteTableNote(long noteId) {
        ensureNotesTable();
        int removed = jdbc().update(
                String.format(Constants.Notes.DELETE_BY_ID, NOTES_TABLE), noteId);
        if (removed == 0) {
            throw new IllegalArgumentException("No such note.");
        }
    }

    // ─── Create Table ─────────────────────────────────────────────────────────────

    /**
     * Creates a new table from a definition. Mirrors HandleCreateTable.
     */
    public void createTable(CreateTableRequest req) {
        String tableName = req.getTableName().replace(" ", "_");

        List<String> colDefs = new ArrayList<>();
        List<String> fkDefs = new ArrayList<>();

        for (var col : req.getColumns()) {
            String colName = col.getName().replace(" ", "_");
            String baseType = col.getType().toUpperCase();
            String typeDef = buildColTypeDef(baseType, col.getLength(), col.isPk(), col.isNotNull());

            colDefs.add(quote(colName) + " " + typeDef);

            if (col.getRefTable() != null && !col.getRefTable().isEmpty()
                    && col.getRefCol() != null && !col.getRefCol().isEmpty()) {
                fkDefs.add(String.format(Constants.Tables.FOREIGN_KEY_CASCADE_CLAUSE,
                        quote(colName), quote(col.getRefTable()), quote(col.getRefCol())));
            }
        }

        List<String> allDefs = new ArrayList<>(colDefs);
        allDefs.addAll(fkDefs);
        String sql = String.format(Constants.Tables.CREATE_TABLE, quote(tableName),
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
        return jdbc().queryForList(String.format(Constants.Rows.SELECT_ALL, tableName));
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    /**
     * Generates a full SQL dump in the workspace's own dialect. Mirrors HandleExportDatabaseSQL.
     */
    @Override
    public String exportDatabaseSql() {
        return exportDatabaseSql(isMysql() ? SqlDialect.MYSQL : SqlDialect.SQLITE);
    }

    /**
     * Generates a full SQL dump written for a particular engine.
     *
     * <p>The schema is rebuilt in the target's vocabulary rather than copied out of SQLite - see
     * {@link SqlExportWriter}, which is where the difference between {@code AUTOINCREMENT},
     * {@code SERIAL} and {@code IDENTITY(1,1)} is decided.
     */
    @Override
    public String exportDatabaseSql(SqlDialect target) {
        List<SqlExportWriter.Table> tables = new ArrayList<>();

        for (String name : getTableNames()) {
            List<ColumnInfo> columns = getColumnsForTable(name);
            tables.add(new SqlExportWriter.Table(
                    name,
                    columns,
                    getForeignKeys(name),
                    safeQueryRows(String.format(Constants.Rows.SELECT_ALL, name)),
                    autoIncrementColumns(name, columns)));
        }

        return SqlExportWriter.write(tables, target);
    }

    /**
     * Columns that generate their own values.
     *
     * <p>On SQLite an {@code INTEGER PRIMARY KEY} is an alias for the rowid and fills itself in
     * whether or not {@code AUTOINCREMENT} was written, so both spellings count: exporting such a
     * column as a plain {@code INT NOT NULL} would produce a schema whose inserts all have to
     * supply an id the original never did.
     */
    private Set<String> autoIncrementColumns(String tableName, List<ColumnInfo> columns) {
        if (isMysql()) {
            // MySQL says so directly in the DDL.
            String ddl = getCreateTableSql(tableName);
            String upper = ddl == null ? "" : ddl.toUpperCase();
            return columns.stream()
                    .filter(c -> upper.contains("`" + c.getName().toUpperCase() + "` INT")
                            && upper.contains("AUTO_INCREMENT"))
                    .map(ColumnInfo::getName)
                    .collect(Collectors.toCollection(LinkedHashSet::new));
        }

        Set<String> keys = new LinkedHashSet<>();
        List<ColumnInfo> primaryKeys = columns.stream().filter(ColumnInfo::isPk).toList();
        if (primaryKeys.size() == 1) {
            ColumnInfo key = primaryKeys.get(0);
            String type = key.getType() == null ? "" : key.getType().trim().toUpperCase();
            if (type.equals("INTEGER") || type.equals("INT")) {
                keys.add(key.getName());
            }
        }
        return keys;
    }

    private String getCreateTableSql(String table) {
        try {
            if (isMysql()) {
                return jdbc().queryForObject(
                        String.format(Constants.Introspection.MYSQL_SHOW_CREATE_TABLE, table),
                        (rs, n) -> rs.getString(2));
            } else {
                return jdbc().queryForObject(
                        Constants.Introspection.SQLITE_SELECT_TABLE_SQL, String.class, table);
            }
        } catch (Exception e) {
            return null;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────────

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
