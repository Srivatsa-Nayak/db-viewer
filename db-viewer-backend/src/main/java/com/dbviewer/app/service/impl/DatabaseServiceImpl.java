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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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

        // Views come back as nodes too. `PRAGMA table_info` works on a view, so the columns are
        // free; `PRAGMA foreign_key_list` returns nothing, so a view node simply has no edges.
        for (String viewName : getViewNames()) {
            List<Map<String, Object>> rows =
                    safeQueryRows(String.format(Constants.Rows.SELECT_ALL_LIMITED, viewName));
            tables.add(TableInfo.builder()
                    .name(viewName)
                    .columns(getColumnsForTable(viewName))
                    .rows(rows)
                    .view(true)
                    .build());
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

    /**
     * Views, which the canvas draws but nothing writes to.
     *
     * <p>Kept apart from {@link #getTableNames()} rather than folded into it, because almost every
     * caller of that method goes on to do something only a table can take.
     */
    private List<String> getViewNames() {
        try {
            List<String> names = isMysql()
                    ? jdbc().queryForList(Constants.Introspection.MYSQL_SHOW_VIEWS, String.class)
                    : jdbc().queryForList(Constants.Introspection.SQLITE_SELECT_VIEWS, String.class);
            return names.stream().filter(name -> !name.startsWith(INTERNAL_TABLE_PREFIX)).toList();
        } catch (Exception e) {
            log.debug("Could not list views: {}", e.getMessage());
            return List.of();
        }
    }

    private static final String INTERNAL_TABLE_PREFIX = Constants.Identifiers.INTERNAL_TABLE_PREFIX;
    private static final String NOTES_TABLE = Constants.Identifiers.NOTES_TABLE;
    private static final String CANVAS_META_TABLE = Constants.Identifiers.CANVAS_META_TABLE;

    /** Created lazily so an untouched workspace stays completely empty. */
    private void ensureNotesTable() {
        jdbc().execute(String.format(Constants.Ddl.CREATE_NOTES_TABLE, NOTES_TABLE,
                isMysql() ? Constants.Ddl.MYSQL_AUTO_INCREMENT_PK
                          : Constants.Ddl.SQLITE_AUTO_INCREMENT_PK));
    }

    /** Likewise: a file nobody has annotated carries no annotations table. */
    private void ensureCanvasMetaTable() {
        jdbc().execute(String.format(Constants.Ddl.CREATE_CANVAS_META_TABLE, CANVAS_META_TABLE));
    }

    private List<ColumnInfo> getColumnsForTable(String tableName) {
        List<ColumnInfo> columns = new ArrayList<>();
        Set<String> unique = uniqueColumns(tableName);
        if (isMysql()) {
            jdbc().query(String.format(Constants.Introspection.MYSQL_DESCRIBE_TABLE, tableName), rs -> {
                String name = rs.getString("Field");
                boolean pk = "PRI".equalsIgnoreCase(rs.getString("Key"));
                columns.add(ColumnInfo.builder()
                        .name(name)
                        .type(rs.getString("Type"))
                        .pk(pk)
                        .notNull("NO".equalsIgnoreCase(rs.getString("Null")))
                        .unique(pk || unique.contains(name) || "UNI".equalsIgnoreCase(rs.getString("Key")))
                        .defaultValue(rs.getString("Default"))
                        .autoIncrement(rs.getString("Extra") != null
                                && rs.getString("Extra").toLowerCase().contains("auto_increment"))
                        .build());
            });
        } else {
            boolean tableAutoIncrements = hasAutoIncrement(tableName);
            jdbc().query(String.format(Constants.Introspection.SQLITE_TABLE_INFO, tableName), rs -> {
                String type = rs.getString("type");
                if (type == null || type.isEmpty()) type = "TEXT";
                String name = rs.getString("name");
                // PRAGMA table_info reports pk as a 1-based position, 0 meaning "not a key".
                int pkPosition = rs.getInt("pk");
                columns.add(ColumnInfo.builder()
                        .name(name)
                        .type(type)
                        .pk(pkPosition > 0)
                        .notNull(rs.getInt("notnull") == 1)
                        // A *sole* primary key is unique; one column of a composite key is not,
                        // and treating it as though it were would turn a one-to-many into a
                        // one-to-one on the diagram.
                        .unique(unique.contains(name))
                        .defaultValue(rs.getString("dflt_value"))
                        .autoIncrement(tableAutoIncrements && pkPosition > 0)
                        .build());
            });
        }
        return columns;
    }

    /**
     * Columns that can hold at most one row's worth of a value: a sole primary key, or a column
     * covered by a single-column UNIQUE index.
     *
     * <p>Composite keys and multi-column unique indexes are deliberately excluded. Neither makes
     * any one of its columns unique, and the caller uses this to decide whether a relationship is
     * one-to-one — a question only a single-column constraint can answer.
     */
    private Set<String> uniqueColumns(String tableName) {
        Set<String> unique = new HashSet<>();
        try {
            if (isMysql()) {
                unique.addAll(jdbc().queryForList(
                        Constants.Introspection.MYSQL_UNIQUE_COLUMNS, String.class, tableName));
                return unique;
            }

            List<String> pk = new ArrayList<>();
            jdbc().query(String.format(Constants.Introspection.SQLITE_TABLE_INFO, tableName), rs -> {
                if (rs.getInt("pk") > 0) pk.add(rs.getString("name"));
            });
            if (pk.size() == 1) unique.add(pk.get(0));

            List<String> uniqueIndexes = new ArrayList<>();
            jdbc().query(String.format(Constants.Introspection.SQLITE_INDEX_LIST, tableName), rs -> {
                if (rs.getInt("unique") == 1) uniqueIndexes.add(rs.getString("name"));
            });
            for (String index : uniqueIndexes) {
                List<String> cols = new ArrayList<>();
                // Braces matter: `List.add` returns boolean, which makes the lambda match both
                // `query(String, ResultSetExtractor)` and `query(String, RowCallbackHandler)`.
                jdbc().query(String.format(Constants.Introspection.SQLITE_INDEX_INFO, index),
                        rs -> { cols.add(rs.getString("name")); });
                if (cols.size() == 1) unique.add(cols.get(0));
            }
        } catch (Exception e) {
            // A diagram drawn without uniqueness is still a correct diagram, just a less precise
            // one. Failing the whole schema read over it would not be.
            log.debug("Could not read unique columns for {}: {}", tableName, e.getMessage());
        }
        return unique;
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
                String onDelete = rs.getString("on_delete");
                rels.add(Relationship.builder()
                        .sourceTable(tableName)
                        .sourceColumn(rs.getString("from"))
                        .targetTable(rs.getString("table"))
                        .targetColumn(rs.getString("to"))
                        // Both were read and discarded before. The id is what groups the columns
                        // of a composite key into one relationship.
                        .constraintId(rs.getInt("id"))
                        .onDelete(onDelete == null || onDelete.isBlank()
                                || "NO ACTION".equalsIgnoreCase(onDelete) ? null : onDelete)
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
        // The table already exists, so it is checked against the real schema rather than run
        // through `safeIdentifier` — see `requireExistingTable` for why rewriting would be wrong.
        // The column is new, so the rewrite-and-validate rules do apply to it.
        String tableName = requireExistingTable(req.getTableName());
        String colName = safeIdentifier(req.getColumnName(), "column name");
        String baseType = req.getColumnType().toUpperCase();

        String typeDef = resolveTypeDef(baseType, req.getLength(), req.isNotNull());
        String sql = String.format(Constants.Tables.ADD_COLUMN, tableName, colName, typeDef);
        jdbc().execute(sql);
    }

    /**
     * Removes a column. The inverse of {@link #addColumn}, and the reason undo can reverse one.
     *
     * <p>Refuses a primary key and a column another table's foreign key points at, for the same
     * reason {@link #dropTable} refuses a referenced table: SQLite does not enforce either by
     * default, so it would quietly leave the schema describing something that is no longer true.
     */
    @Override
    public void dropColumn(String tableNameRaw, String columnNameRaw) {
        String tableName = requireExistingTable(tableNameRaw);
        String columnName = requireExistingColumn(tableName, columnNameRaw);

        ColumnInfo column = getColumnsForTable(tableName).stream()
                .filter(c -> c.getName().equals(columnName)).findFirst().orElseThrow();
        if (column.isPk()) {
            throw new IllegalArgumentException(
                    "\"" + columnName + "\" is the primary key. Every row is addressed by it, so it "
                            + "cannot be dropped.");
        }
        if (getColumnsForTable(tableName).size() == 1) {
            throw new IllegalArgumentException(
                    "A table must keep at least one column. Delete the table instead.");
        }

        List<String> dependents = new ArrayList<>();
        for (String other : getTableNames()) {
            if (other.equals(tableName)) continue;
            for (Relationship rel : getForeignKeys(other)) {
                if (tableName.equals(rel.getTargetTable()) && columnName.equals(rel.getTargetColumn())) {
                    dependents.add(other + "." + rel.getSourceColumn());
                }
            }
        }
        if (!dependents.isEmpty()) {
            throw new IllegalArgumentException(
                    "\"" + columnName + "\" is referenced by " + String.join(", ", dependents)
                            + ". Remove those foreign keys first.");
        }

        jdbc().execute(String.format(Constants.Tables.DROP_COLUMN, tableName, columnName));
    }

    /**
     * Confirms a table name against the schema, and returns it unchanged.
     *
     * <p>Deliberately *not* {@link #safeIdentifier}, which rewrites as well as validates: it turns
     * spaces and hyphens into underscores, so a table called {@code my-table} — perfectly possible
     * in an imported dump, which is executed as written — would become {@code my_table} and the
     * statement would address a table that does not exist. An allowlist of names the database
     * actually reports is both safer than a character check and incapable of that mistake.
     */
    private String requireExistingTable(String tableName) {
        if (isBlank(tableName)) {
            throw new IllegalArgumentException("Missing table name");
        }
        String trimmed = tableName.trim();
        if (getTableNames().contains(trimmed)) {
            return trimmed;
        }
        // Tolerate the rewrite the UI used to apply, so a caller that still sends "my table"
        // finds "my_table" rather than a confusing "no such table".
        String rewritten = trimmed.replace(" ", "_");
        if (getTableNames().contains(rewritten)) {
            return rewritten;
        }
        // A view reaches here whenever something tries to write to it. Saying so is far more
        // use than the "no such table" the name check would otherwise produce.
        if (getViewNames().contains(trimmed)) {
            throw new IllegalArgumentException(
                    "\"" + trimmed + "\" is a view. It has no rows of its own to change — edit the "
                            + "tables it reads from instead.");
        }
        throw new IllegalArgumentException("No such table: \"" + tableName + "\"");
    }

    /** As {@link #requireExistingTable}, for a column of a table already confirmed. */
    private String requireExistingColumn(String tableName, String columnName) {
        if (isBlank(columnName)) {
            throw new IllegalArgumentException("Missing column name");
        }
        String trimmed = columnName.trim();
        boolean exists = getColumnsForTable(tableName).stream()
                .anyMatch(c -> c.getName().equals(trimmed));
        if (!exists) {
            throw new IllegalArgumentException(
                    "No such column: \"" + columnName + "\" on \"" + tableName + "\"");
        }
        return trimmed;
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
    /**
     * What a rebuild is being asked to change. Every field is optional: a rebuild that only adds
     * a foreign key leaves the columns exactly as they were.
     *
     * @param oldColumn      the column being renamed or retyped, or null for no column change
     * @param addForeignKeys table-level {@code FOREIGN KEY} clauses to append
     * @param dropForeignKeys constraint ids (from {@code PRAGMA foreign_key_list}) to leave out
     */
    private record RebuildSpec(String oldColumn, String newColumn, String newType,
                               boolean newNotNull, List<String> addForeignKeys,
                               Set<Integer> dropForeignKeys) {
        static RebuildSpec columnChange(String oldColumn, String newColumn, String newType,
                                        boolean newNotNull) {
            return new RebuildSpec(oldColumn, newColumn, newType, newNotNull, List.of(), Set.of());
        }
        static RebuildSpec foreignKeys(List<String> add, Set<Integer> drop) {
            return new RebuildSpec(null, null, null, false, add, drop);
        }
    }

    private void rebuildSqliteTable(String tableName, String oldColumn, String newColumn,
                                    String newType, boolean newNotNull) {
        rebuildSqliteTable(tableName,
                RebuildSpec.columnChange(oldColumn, newColumn, newType, newNotNull));
    }

    /**
     * Rebuilds a SQLite table to a new shape, preserving everything the old one carried.
     *
     * <p>SQLite cannot change a column's type, and cannot add or drop a constraint at all, so the
     * documented workaround is to build a replacement, copy the rows across, and rename it into
     * place. The risk in that is everything the replacement silently fails to carry over: this
     * reconstructs the primary key, {@code AUTOINCREMENT}, defaults, {@code NOT NULL}, foreign
     * keys, <strong>unique constraints, {@code CHECK} constraints and every index</strong>. The
     * last three used to be lost on any column retype — quietly, and only noticeable later.
     */
    private void rebuildSqliteTable(String tableName, RebuildSpec spec) {
        String oldColumn = spec.oldColumn();
        String newColumn = spec.newColumn();
        String newType = spec.newType();
        boolean newNotNull = spec.newNotNull();

        List<SqliteColumn> columns = readSqliteColumns(tableName);
        Map<Integer, String> foreignKeyClauses = readSqliteForeignKeyClauses(tableName);
        List<String> foreignKeys = new ArrayList<>();
        foreignKeyClauses.forEach((id, clause) -> {
            if (!spec.dropForeignKeys().contains(id)) foreignKeys.add(clause);
        });
        foreignKeys.addAll(spec.addForeignKeys());

        // Everything below this line is the F3 fix: constraints and indexes that no PRAGMA
        // reports as part of the table definition, and that a naive rebuild therefore drops.
        Set<String> singleColumnUnique = new HashSet<>();
        List<String> compositeUnique = new ArrayList<>();
        readUniqueConstraints(tableName, singleColumnUnique, compositeUnique);
        List<String> checks = extractCheckConstraints(getCreateTableSql(tableName));
        List<String> indexes = readCreatedIndexes(tableName);

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
                // A single-column UNIQUE is an auto-index, invisible to `PRAGMA table_info`, so it
                // has to be put back by hand or the column quietly stops being unique — and
                // uniqueness is what the diagram reads to tell a 1:1 from a 1:N.
                if (singleColumnUnique.contains(col.name())) def.append(" UNIQUE");
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
        definitions.addAll(compositeUnique);
        definitions.addAll(checks);
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

            // Indexes belong to the table, so dropping it dropped them. They are recreated from
            // their own DDL, with the renamed column substituted where one was renamed.
            for (String indexSql : indexes) {
                String sql = oldColumn != null && newColumn != null
                        ? renameColumnInSql(indexSql, oldColumn, newColumn)
                        : indexSql;
                try {
                    jdbc().execute(sql);
                } catch (RuntimeException indexError) {
                    // One index that will not rebuild must not roll back a successful migration
                    // of the data; the table is correct either way.
                    log.warn("Could not recreate index on {}: {}", tableName, indexError.getMessage());
                }
            }
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
    /**
     * Unique constraints on a table, split by whether they cover one column or several.
     *
     * <p>{@code PRAGMA table_info} does not report uniqueness at all, so the only trace is an
     * auto-index with {@code origin = 'u'}. A single-column one is re-emitted on the column; a
     * multi-column one has to become a table-level clause, because putting {@code UNIQUE} on
     * either column separately would be a stronger constraint than the schema actually had.
     */
    private void readUniqueConstraints(String tableName, Set<String> singleColumn,
                                       List<String> composite) {
        List<String> uniqueIndexes = new ArrayList<>();
        try {
            jdbc().query(String.format(Constants.Introspection.SQLITE_INDEX_LIST, tableName), rs -> {
                // 'u' is a UNIQUE constraint in the table definition; 'c' is a CREATE INDEX,
                // recreated separately, and 'pk' is the primary key, already handled above.
                if (rs.getInt("unique") == 1 && "u".equalsIgnoreCase(rs.getString("origin"))) {
                    uniqueIndexes.add(rs.getString("name"));
                }
            });
        } catch (Exception e) {
            log.debug("Could not read unique constraints for {}: {}", tableName, e.getMessage());
            return;
        }

        for (String index : uniqueIndexes) {
            List<String> cols = new ArrayList<>();
            jdbc().query(String.format(Constants.Introspection.SQLITE_INDEX_INFO, index),
                    rs -> { cols.add(rs.getString("name")); });
            if (cols.size() == 1) {
                singleColumn.add(cols.get(0));
            } else if (cols.size() > 1) {
                composite.add("UNIQUE (" + cols.stream()
                        .map(c -> QUOTE + c + QUOTE).collect(Collectors.joining(", ")) + ")");
            }
        }
    }

    /**
     * Indexes created with {@code CREATE INDEX}, as their own DDL.
     *
     * <p>Only those: an auto-index backing a {@code UNIQUE} or a primary key has a null
     * {@code sql} and is reconstructed from the column definitions instead. Recreating one of
     * those by hand would fail anyway, because SQLite reserves the {@code sqlite_} name prefix.
     */
    private List<String> readCreatedIndexes(String tableName) {
        List<String> statements = new ArrayList<>();
        try {
            jdbc().query(Constants.Introspection.SQLITE_TABLE_INDEX_DDL,
                    rs -> { statements.add(rs.getString("sql")); }, tableName);
        } catch (Exception e) {
            log.debug("Could not read indexes for {}: {}", tableName, e.getMessage());
        }
        return statements;
    }

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
    private List<String> extractCheckConstraints(String createSql) {
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
    private static int matchingParen(String text, int open) {
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
    private static String renameColumnInSql(String sql, String oldName, String newName) {
        String quotedOld = Pattern.quote(QUOTE + oldName + QUOTE);
        String quotedNew = Matcher.quoteReplacement(QUOTE + newName + QUOTE);
        return sql
                .replaceAll(quotedOld, quotedNew)
                .replaceAll("\\b" + Pattern.quote(oldName) + "\\b",
                        Matcher.quoteReplacement(newName));
    }

    private List<String> readSqliteForeignKeys(String tableName) {
        return new ArrayList<>(readSqliteForeignKeyClauses(tableName).values());
    }

    /**
     * The same clauses, keyed by the constraint id SQLite assigns them.
     *
     * <p>Dropping a foreign key means rebuilding the table without one of these, and the id is
     * the only thing that identifies which — a composite key is several {@code PRAGMA} rows
     * sharing one id, and two constraints can name the same column.
     */
    private Map<Integer, String> readSqliteForeignKeyClauses(String tableName) {
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

        Map<Integer, String> clauses = new LinkedHashMap<>();
        for (Integer id : fromColumns.keySet()) {
            String action = onDelete.get(id);
            clauses.put(id, String.format(Constants.Tables.FOREIGN_KEY_CLAUSE,
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
        // Both names go straight into the statement, so both are checked against the schema.
        String tableName = requireExistingTable(req.getTableName());
        String colName = requireExistingColumn(tableName, req.getColumnName());
        String sql = String.format(Constants.Rows.UPDATE_CELL_BY_ID, tableName, colName);
        jdbc().update(sql, req.getNewValue(), req.getRecordId());
    }

    // ─── Insert Row ───────────────────────────────────────────────────────────────

    /**
     * Inserts a row (empty or with data). Mirrors HandleInsertRow.
     */
    @Override
    public Map<String, Object> insertRow(InsertRowRequest req) {
        String tableName = requireExistingTable(req.getTableName());
        Map<String, Object> data = req.getData() != null ? req.getData() : new HashMap<>();

        // Strip id and empty values. The column names arrive from the client and are interpolated
        // into the statement, so each one is confirmed against the table before it gets there.
        Map<String, Object> cleanData = data.entrySet().stream()
                .filter(e -> !e.getKey().equalsIgnoreCase("id"))
                .filter(e -> e.getValue() != null)
                .filter(e -> !(e.getValue() instanceof String s && s.trim().isEmpty()))
                .collect(Collectors.toMap(
                        e -> requireExistingColumn(tableName, e.getKey()), Map.Entry::getValue));

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
        String tableName = requireExistingTable(req.getTableName());
        jdbc().update(String.format(Constants.Rows.DELETE_BY_ID, tableName), req.getRecordId());
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    /**
     * Drops all tables. Mirrors HandleClearDatabase.
     */
    @Override
    public void clearDatabase() {
        List<String> tables = getTableNames();
        // Views first: they depend on the tables and are not dropped by DROP TABLE.
        for (String viewName : getViewNames()) {
            try {
                jdbc().execute(String.format(Constants.Tables.DROP_VIEW_IF_EXISTS, viewName));
            } catch (Exception e) {
                log.warn("Could not drop view {}: {}", viewName, e.getMessage());
            }
        }

        // Notes and annotations both describe tables that are about to stop existing.
        try {
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, NOTES_TABLE));
        } catch (Exception e) {
            log.warn("Could not clear table notes: {}", e.getMessage());
        }
        try {
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, CANVAS_META_TABLE));
        } catch (Exception e) {
            log.warn("Could not clear canvas annotations: {}", e.getMessage());
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

        // The notes and the colour were about a table that no longer exists.
        try {
            ensureNotesTable();
            jdbc().update(String.format(Constants.Notes.DELETE_FOR_TABLE, NOTES_TABLE), table);
        } catch (Exception e) {
            log.warn("Could not clean up notes for dropped table {}: {}", table, e.getMessage());
        }
        try {
            ensureCanvasMetaTable();
            jdbc().update(String.format(Constants.CanvasMeta.DELETE_FOR_TABLE, CANVAS_META_TABLE), table);
        } catch (Exception e) {
            log.warn("Could not clean up annotations for dropped table {}: {}", table, e.getMessage());
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

    // ─── Raw SQL, run from the scratchpad ─────────────────────────────────────────

    /** Enough statements for a real migration, few enough that a paste cannot run away. */
    private static final int MAX_STATEMENTS = 50;
    /** Rows returned to the UI per statement. The panel is not a data grid. */
    private static final int MAX_RESULT_ROWS = 500;
    /** A statement that has not finished in this long is not going to. */
    private static final int STATEMENT_TIMEOUT_SECONDS = 15;

    /**
     * Runs a user's SQL, statement by statement, and reports what each one did.
     *
     * <p>Deliberately not {@link #executeQuery}, which runs a single statement and answers with
     * either rows or a count. A scratchpad is used to run several at once, and the question that
     * matters when something goes wrong is <em>which</em> one — a shape the old response could not
     * express at all.
     *
     * <p>Execution stops at the first failure. A script is usually a sequence where the later
     * statements assume the earlier ones worked, so carrying on past an error produces a cascade
     * of confusing secondary failures and leaves the schema somewhere nobody intended.
     */
    @Override
    public Map<String, Object> runScratchpad(String script) {
        if (script == null || script.isBlank()) {
            throw new IllegalArgumentException("Nothing to run.");
        }

        List<String> statements = SqlScriptSplitter.split(script);
        if (statements.isEmpty()) {
            throw new IllegalArgumentException("Nothing to run.");
        }
        if (statements.size() > MAX_STATEMENTS) {
            throw new IllegalArgumentException(
                    "That is " + statements.size() + " statements. Run at most " + MAX_STATEMENTS
                            + " at a time — use Import for a whole file.");
        }
        for (String statement : statements) {
            refuseInternalTables(statement);
        }

        List<Map<String, Object>> report = new ArrayList<>();
        boolean schemaChanged = false;
        boolean stopped = false;

        for (String statement : statements) {
            if (stopped) {
                report.add(statementReport(statement, "skipped", null, null, null,
                        "Not run: an earlier statement failed.", false));
                continue;
            }
            String kind = statementKind(statement);
            try {
                if (returnsRows(statement)) {
                    List<Map<String, Object>> rows = queryWithLimit(statement);
                    boolean truncated = rows.size() > MAX_RESULT_ROWS;
                    if (truncated) rows = rows.subList(0, MAX_RESULT_ROWS);
                    report.add(statementReport(statement, kind,
                            rows.isEmpty() ? List.of() : new ArrayList<>(rows.get(0).keySet()),
                            rows, rows.size(), null, truncated));
                } else {
                    int affected = updateWithTimeout(statement);
                    report.add(statementReport(statement, kind, null, null, affected, null, false));
                    if (!"SELECT".equals(kind)) schemaChanged = true;
                }
            } catch (Exception e) {
                report.add(statementReport(statement, kind, null, null, null,
                        rootCauseMessage(e), false));
                stopped = true;
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("statements", report);
        // Tells the UI whether the canvas needs re-reading. A SELECT changes nothing, and
        // refreshing the whole schema after every one of those would be wasteful and jumpy.
        result.put("schemaChanged", schemaChanged);
        result.put("failed", stopped);
        return result;
    }

    private Map<String, Object> statementReport(String sql, String kind, List<String> columns,
                                                List<Map<String, Object>> rows, Integer count,
                                                String error, boolean truncated) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("sql", summarizeStatement(sql));
        entry.put("kind", kind);
        if (columns != null) entry.put("columns", columns);
        if (rows != null) entry.put("rows", rows);
        if (count != null) entry.put("rowCount", count);
        if (error != null) entry.put("error", error);
        entry.put("truncated", truncated);
        return entry;
    }

    /**
     * Whether a statement produces a result set.
     *
     * <p>{@code PRAGMA} is the awkward one: the read form returns rows and the assignment form
     * does not, and sending the latter to a query call fails with "query does not return
     * ResultSet" — which is exactly what {@link #executeQuery} still does.
     */
    private boolean returnsRows(String statement) {
        String head = statement.stripLeading().toUpperCase();
        if (head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("EXPLAIN")
                || head.startsWith("SHOW") || head.startsWith("VALUES")) {
            return true;
        }
        // A read pragma is a bare name; `PRAGMA foreign_keys = ON` is an assignment.
        return head.startsWith("PRAGMA") && !head.contains("=");
    }

    private String statementKind(String statement) {
        String head = statement.stripLeading().toUpperCase();
        for (String word : List.of("SELECT", "INSERT", "UPDATE", "DELETE", "CREATE VIEW",
                "CREATE TABLE", "CREATE INDEX", "ALTER", "DROP", "PRAGMA", "WITH", "EXPLAIN")) {
            if (head.startsWith(word)) return word;
        }
        int space = head.indexOf(' ');
        return space > 0 ? head.substring(0, space) : head;
    }

    private List<Map<String, Object>> queryWithLimit(String sql) {
        return jdbc().execute((org.springframework.jdbc.core.StatementCallback<List<Map<String, Object>>>) stmt -> {
            stmt.setQueryTimeout(STATEMENT_TIMEOUT_SECONDS);
            // One more than the cap, so the caller can tell "exactly 500" from "at least 500".
            stmt.setMaxRows(MAX_RESULT_ROWS + 1);
            try (java.sql.ResultSet rs = stmt.executeQuery(sql)) {
                return readRows(rs);
            }
        });
    }

    private List<Map<String, Object>> readRows(java.sql.ResultSet rs) throws java.sql.SQLException {
        java.sql.ResultSetMetaData meta = rs.getMetaData();
        int columns = meta.getColumnCount();
        List<Map<String, Object>> rows = new ArrayList<>();
        while (rs.next()) {
            Map<String, Object> row = new LinkedHashMap<>();
            for (int i = 1; i <= columns; i++) {
                row.put(meta.getColumnLabel(i), rs.getObject(i));
            }
            rows.add(row);
        }
        return rows;
    }

    private int updateWithTimeout(String sql) {
        Integer affected = jdbc().execute((org.springframework.jdbc.core.StatementCallback<Integer>) stmt -> {
            stmt.setQueryTimeout(STATEMENT_TIMEOUT_SECONDS);
            stmt.execute(sql);
            int count = stmt.getUpdateCount();
            return count < 0 ? 0 : count;
        });
        return affected == null ? 0 : affected;
    }

    /**
     * Refuses a statement that names one of the application's own tables.
     *
     * <p>They are filtered out of every listing, so nobody can see them to mean them; a statement
     * naming one is either a mistake or an attempt to reach behind the UI, and neither should be
     * allowed to corrupt the notes or the canvas annotations.
     */
    private void refuseInternalTables(String statement) {
        java.util.regex.Matcher matcher =
                java.util.regex.Pattern.compile("(?<![A-Za-z0-9_])__[A-Za-z0-9_]+")
                        .matcher(statement);
        if (matcher.find()) {
            throw new IllegalArgumentException(
                    "\"" + matcher.group() + "\" belongs to the application. Tables whose names "
                            + "start with __ are not yours to change.");
        }
    }

    // ─── Foreign keys on an existing table ────────────────────────────────────────

    /**
     * Adds a foreign key to a table that already exists.
     *
     * <p>Everything is checked before anything is written, because the SQLite path is a table
     * rebuild and a rebuild that fails halfway is far more expensive to reason about than a
     * request that was refused. The checks are not pedantry:
     *
     * <ul>
     *   <li>A key pointing at a non-unique column is accepted by SQLite and then <em>silently not
     *       enforced</em>, which is worse than a refusal because the diagram would claim a
     *       guarantee the database is not making.</li>
     *   <li>Rows that already violate the key would make the copy step fail with a constraint
     *       error naming nothing useful; counting them first lets us say how many and where.</li>
     * </ul>
     */
    @Override
    public void addForeignKey(String tableRaw, String columnRaw, String refTableRaw,
                              String refColumnRaw, String onDelete) {
        String table = requireExistingTable(tableRaw);
        String column = requireExistingColumn(table, columnRaw);
        String refTable = requireExistingTable(refTableRaw);
        String refColumn = requireExistingColumn(refTable, refColumnRaw);

        if (table.equals(refTable) && column.equals(refColumn)) {
            throw new IllegalArgumentException("A column cannot reference itself.");
        }

        ColumnInfo child = columnOf(table, column);
        ColumnInfo parent = columnOf(refTable, refColumn);

        // SQLite requires the parent side to be unique for the key to mean anything at all.
        if (!parent.isPk() && !parent.isUnique()) {
            throw new IllegalArgumentException(
                    "\"" + refTable + "." + refColumn + "\" is not unique. A foreign key must point at "
                            + "a primary key or a column with a unique index, or the database will not "
                            + "enforce it.");
        }

        if (!typesCompatible(child.getType(), parent.getType())) {
            throw new IllegalArgumentException(
                    "\"" + table + "." + column + "\" is " + child.getType() + " but \""
                            + refTable + "." + refColumn + "\" is " + parent.getType()
                            + ". A foreign key needs matching types.");
        }

        boolean exists = getForeignKeys(table).stream().anyMatch(rel ->
                column.equals(rel.getSourceColumn())
                        && refTable.equals(rel.getTargetTable())
                        && refColumn.equals(rel.getTargetColumn()));
        if (exists) {
            throw new IllegalArgumentException(
                    "That relationship already exists between " + table + " and " + refTable + ".");
        }

        long orphans = countOrphans(table, column, refTable, refColumn);
        if (orphans > 0) {
            boolean one = orphans == 1;
            throw new IllegalArgumentException(
                    orphans + (one ? " row in \"" : " rows in \"") + table
                            + (one ? "\" holds a \"" : "\" hold a \"") + column
                            + "\" that does not exist in \"" + refTable + "\". Fix or clear "
                            + (one ? "that row first." : "those rows first."));
        }

        String action = normaliseOnDelete(onDelete);
        if (isMysql()) {
            // MySQL can do this properly, so it does — no rebuild, no data copy.
            jdbc().execute(String.format(Constants.Tables.MYSQL_ADD_FOREIGN_KEY,
                    table, column, refTable, refColumn, action));
            return;
        }

        String clause = String.format(Constants.Tables.FOREIGN_KEY_CLAUSE,
                "\"" + column + "\"", refTable, "\"" + refColumn + "\"", action);
        rebuildSqliteTable(table, RebuildSpec.foreignKeys(List.of(clause), Set.of()));
    }

    /**
     * Removes a foreign key — the inverse of {@link #addForeignKey}, and what undo runs.
     *
     * <p>Identified by the pair of columns rather than by the engine's constraint id, because the
     * id is an index into a PRAGMA listing and shifts as other keys come and go; the caller holds
     * a relationship, not a number.
     */
    @Override
    public void dropForeignKey(String tableRaw, String columnRaw, String refTableRaw,
                               String refColumnRaw) {
        String table = requireExistingTable(tableRaw);
        String column = requireExistingColumn(table, columnRaw);
        String refTable = refTableRaw == null ? null : refTableRaw.trim();
        String refColumn = refColumnRaw == null ? null : refColumnRaw.trim();

        if (isMysql()) {
            String constraint = mysqlConstraintName(table, column, refTable, refColumn);
            if (constraint == null) {
                throw new IllegalArgumentException("No such relationship on \"" + table + "\".");
            }
            jdbc().execute(String.format(Constants.Tables.MYSQL_DROP_FOREIGN_KEY, table, constraint));
            return;
        }

        Integer id = null;
        Map<Integer, List<String>> byId = new LinkedHashMap<>();
        jdbc().query(String.format(Constants.Introspection.SQLITE_FOREIGN_KEY_LIST, table), rs -> {
            int fkId = rs.getInt("id");
            byId.computeIfAbsent(fkId, k -> new ArrayList<>())
                    .add(rs.getString("from") + "\u0000" + rs.getString("table")
                            + "\u0000" + rs.getString("to"));
        });
        String wanted = column + "\u0000" + refTable + "\u0000" + refColumn;
        for (Map.Entry<Integer, List<String>> entry : byId.entrySet()) {
            if (entry.getValue().contains(wanted)) {
                id = entry.getKey();
                break;
            }
        }
        if (id == null) {
            throw new IllegalArgumentException(
                    "No relationship from \"" + table + "." + column + "\" to \"" + refTable + "\".");
        }

        rebuildSqliteTable(table, RebuildSpec.foreignKeys(List.of(), Set.of(id)));
    }

    private ColumnInfo columnOf(String table, String column) {
        return getColumnsForTable(table).stream()
                .filter(c -> c.getName().equals(column)).findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "No such column: \"" + column + "\" on \"" + table + "\""));
    }

    /**
     * Whether two declared types can sit either side of a foreign key.
     *
     * <p>Compared by SQLite's type *affinity* rather than by spelling: {@code INT},
     * {@code INTEGER} and {@code BIGINT} are the same storage class, and refusing a key because
     * one side says one and the other says another would reject perfectly ordinary schemas.
     */
    private boolean typesCompatible(String childType, String parentType) {
        return affinityOf(childType).equals(affinityOf(parentType));
    }

    private String affinityOf(String declaredType) {
        String type = declaredType == null ? "" : declaredType.toUpperCase();
        if (type.contains("INT")) return "INTEGER";
        if (type.contains("CHAR") || type.contains("CLOB") || type.contains("TEXT")) return "TEXT";
        if (type.contains("BLOB") || type.isEmpty()) return "BLOB";
        if (type.contains("REAL") || type.contains("FLOA") || type.contains("DOUB")) return "REAL";
        return "NUMERIC";
    }

    /** Rows whose foreign key names a parent that is not there. Nulls are allowed and not counted. */
    private long countOrphans(String table, String column, String refTable, String refColumn) {
        String sql = String.format(Constants.Tables.COUNT_ORPHANS,
                quote(table), quote(column), quote(column), quote(refColumn), quote(refTable));
        Long count = jdbc().queryForObject(sql, Long.class);
        return count == null ? 0 : count;
    }

    private String normaliseOnDelete(String onDelete) {
        if (onDelete == null || onDelete.isBlank()) return "";
        String action = onDelete.trim().toUpperCase();
        return switch (action) {
            case "CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION" -> " ON DELETE " + action;
            default -> throw new IllegalArgumentException("Unknown ON DELETE action: " + onDelete);
        };
    }

    private String mysqlConstraintName(String table, String column, String refTable, String refColumn) {
        List<String> names = jdbc().queryForList(Constants.Introspection.MYSQL_CONSTRAINT_NAME,
                String.class, table, column, refTable, refColumn);
        return names.isEmpty() ? null : names.get(0);
    }

    // ─── Canvas annotations ───────────────────────────────────────────────────────

    /** Largest annotation we will store, so a malformed client cannot fill the file. */
    private static final int MAX_PAYLOAD_LENGTH = 4000;

    @Override
    public List<Map<String, Object>> getCanvasMeta() {
        ensureCanvasMetaTable();
        return jdbc().queryForList(String.format(Constants.CanvasMeta.SELECT_ALL, CANVAS_META_TABLE));
    }

    /**
     * Stores one annotation, replacing any previous one for the same kind and ref.
     *
     * <p>{@code payload} is passed through as opaque JSON. The backend has no opinion on what a
     * colour or a group contains — encoding that here would mean a migration every time the canvas
     * learned a new adjective — but it does bound the size, and it does validate the {@code ref},
     * because that is an identifier the rest of the system will hand back to SQL.
     */
    @Override
    public void setCanvasMeta(String kind, String ref, String payload) {
        ensureCanvasMetaTable();
        String checkedKind = requireKind(kind);
        String checkedRef = safeIdentifier(ref, "annotation reference");
        if (payload == null || payload.isBlank()) {
            throw new IllegalArgumentException("An annotation cannot be empty.");
        }
        if (payload.length() > MAX_PAYLOAD_LENGTH) {
            throw new IllegalArgumentException(
                    "An annotation can be at most " + MAX_PAYLOAD_LENGTH + " characters.");
        }
        jdbc().update(String.format(Constants.CanvasMeta.UPSERT, CANVAS_META_TABLE),
                checkedKind, checkedRef, payload, java.time.Instant.now().toString());
    }

    @Override
    public void deleteCanvasMeta(String kind, String ref) {
        ensureCanvasMetaTable();
        jdbc().update(String.format(Constants.CanvasMeta.DELETE_ONE, CANVAS_META_TABLE),
                requireKind(kind), safeIdentifier(ref, "annotation reference"));
    }

    private String requireKind(String kind) {
        if (Constants.CanvasMeta.KIND_TABLE.equals(kind) || Constants.CanvasMeta.KIND_GROUP.equals(kind)) {
            return kind;
        }
        throw new IllegalArgumentException("Unknown annotation kind: \"" + kind + "\"");
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
