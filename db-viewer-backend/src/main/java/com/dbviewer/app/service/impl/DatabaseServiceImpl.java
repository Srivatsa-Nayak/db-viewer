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
import com.dbviewer.app.service.impl.SqliteTableRebuilder.RebuildSpec;
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
    private final SqliteTableRebuilder tableRebuilder;
    private final ScratchpadRunner scratchpadRunner;
    private final FileImporter fileImporter;
    private final SchemaReader schemaReader;

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

    // ─── Import ───────────────────────────────────────────────────────────────────

    /** Handles CSV and SQL file uploads; see {@link FileImporter}. */
    @Override
    public Map<String, Object> handleFileUpload(MultipartFile file) throws Exception {
        return fileImporter.importFile(file, Map.of());
    }

    /**
     * Runs an import the user has already seen and approved.
     *
     * @param typeOverrides the types the user corrected in the pre-flight dialog, keyed by
     *                      column name for a CSV and by {@code table.column} for a script
     */
    @Override
    public Map<String, Object> handleFileUpload(MultipartFile file,
                                                Map<String, String> typeOverrides) throws Exception {
        return fileImporter.importFile(file, typeOverrides);
    }

    /** Reports what an upload would create, without creating any of it. */
    @Override
    public ImportPlan analyzeUpload(MultipartFile file) throws Exception {
        return fileImporter.analyze(file);
    }

    /** Runs {@code work} in one transaction on the current workspace's database. */
    private void inTransaction(Runnable work) {
        workspaceManager.currentTransaction().executeWithoutResult(status -> work.run());
    }

    // ─── Query Execution ──────────────────────────────────────────────────────────

    /**
     * Executes raw SQL. Mirrors HandleQuery.
     */
    @Override
    public List<Map<String, Object>> executeQuery(String sql) {
        if (sql == null || sql.isBlank()) {
            throw new IllegalArgumentException("Nothing to run.");
        }
        // The scratchpad's guard. The application's bookkeeping tables are not the caller's.
        ScratchpadRunner.refuseInternalTables(sql);
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

    @Override
    public Map<String, Object> getSchemaInfo() {
        List<TableInfo> tables = new ArrayList<>();
        List<Relationship> relationships = new ArrayList<>();
        Map<String, List<String>> indexes = new LinkedHashMap<>();
        Map<String, String> views = new LinkedHashMap<>();

        for (String tbl : getTableNames()) {
            tables.add(TableInfo.builder().name(tbl).columns(getColumnsForTable(tbl))
                    .rows(List.of()).build());
            relationships.addAll(getForeignKeys(tbl));
            List<String> described = schemaReader.describeIndexes(tbl);
            if (!described.isEmpty()) {
                indexes.put(tbl, described);
            }
        }
        for (String viewName : getViewNames()) {
            tables.add(TableInfo.builder().name(viewName).columns(getColumnsForTable(viewName))
                    .rows(List.of()).view(true).build());
            String definition = schemaReader.viewDefinition(viewName);
            if (definition != null && !definition.isBlank()) {
                views.put(viewName, definition.strip());
            }
        }
        return Map.of("tables", tables, "relationships", relationships,
                "indexes", indexes, "views", views);
    }

    /** User tables only; internal bookkeeping (the {@code __} prefix) is filtered out. */
    private List<String> getTableNames() {
        return schemaReader.tableNames();
    }

    private List<String> getViewNames() {
        return schemaReader.viewNames();
    }

    private List<ColumnInfo> getColumnsForTable(String tableName) {
        return schemaReader.columns(tableName);
    }

    private List<Relationship> getForeignKeys(String tableName) {
        return schemaReader.foreignKeys(tableName);
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

    // ─── Table Data ───────────────────────────────────────────────────────────────

    /**
     * Gets columns and rows for a specific table. Mirrors HandleGetTableData.
     */
    @Override
    public Map<String, Object> getTableData(String tableName) {
        return getTableData(tableName, 100, 0);
    }

    /** The largest page a caller may ask for. The data editor is a grid, not an export. */
    private static final int MAX_PAGE_SIZE = 1_000;

    @Override
    public Map<String, Object> getTableData(String tableName, int limit, int offset) {
        // The name comes straight from the URL and is formatted into SQL below. Checking it
        // against what the database reports is what keeps a quote in it from being an injection.
        String table = requireExistingTableOrView(tableName);
        int pageSize = Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
        int skip = Math.max(0, offset);

        List<ColumnInfo> columns = getColumnsForTable(table);
        String key = keyColumnOf(columns);
        List<Map<String, Object>> rows = null;
        // No id and no single-column key: on SQLite every ordinary table still has a row id, so
        // rows are read with it and addressed by it. It used to leave such a table — a join
        // table with a composite key, a log with no key at all — uneditable row by row.
        if (key == null && usesRowid(table)) {
            try {
                rows = jdbc().queryForList(
                        String.format(Constants.Rows.SELECT_PAGE_WITH_ROWID, table), pageSize, skip);
                key = Constants.Rows.ROWID_ALIAS;
            } catch (Exception e) {
                log.debug("Could not read {} with its row id: {}", table, e.getMessage());
            }
        }
        if (rows == null) {
            try {
                rows = jdbc().queryForList(String.format(Constants.Rows.SELECT_PAGE, table), pageSize, skip);
            } catch (Exception e) {
                log.debug("Could not read a page of {}: {}", table, e.getMessage());
                rows = List.of();
            }
        }
        long total;
        try {
            Long count = jdbc().queryForObject(String.format(Constants.Rows.COUNT_ROWS, table), Long.class);
            total = count == null ? rows.size() : count;
        } catch (Exception e) {
            total = rows.size();
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("columns", columns);
        result.put("rows", rows);
        // The real row count, so the editor can say "100 of 2,431" instead of implying the
        // first page is the whole table.
        result.put("total", total);
        result.put("limit", pageSize);
        result.put("offset", skip);
        if (key != null) {
            result.put("keyColumn", key);
        }
        return result;
    }

    /**
     * The column that identifies a row for an edit or a delete.
     *
     * <p>An {@code id} column if there is one, which keeps every existing table addressed as
     * before. Otherwise the table's primary key, when it is a single column — the case that used
     * to make a table uneditable just because its key was called {@code customer_code}. A
     * composite or missing key still leaves rows unaddressable, and the UI says so.
     */
    private static String keyColumnOf(List<ColumnInfo> columns) {
        for (ColumnInfo column : columns) {
            if ("id".equalsIgnoreCase(column.getName())) {
                return column.getName();
            }
        }
        List<ColumnInfo> keys = columns.stream().filter(ColumnInfo::isPk).toList();
        return keys.size() == 1 ? keys.get(0).getName() : null;
    }

    /**
     * The column rows of this table are addressed by, or {@link Constants.Rows#ROWID_ALIAS} when
     * it has no id or single-column key and SQLite's row id stands in.
     */
    private String requireKeyColumn(String tableName) {
        String key = keyColumnOf(getColumnsForTable(tableName));
        if (key != null) {
            return key;
        }
        if (usesRowid(tableName)) {
            return Constants.Rows.ROWID_ALIAS;
        }
        throw new IllegalArgumentException("\"" + tableName + "\" has no id column or "
                + "single-column primary key, so its rows cannot be addressed one at a time.");
    }

    /**
     * True for an ordinary SQLite table, which always has a row id. False on MySQL, for a view,
     * and for a table declared WITHOUT ROWID.
     */
    private boolean usesRowid(String tableName) {
        if (isMysql() || getViewNames().contains(tableName)) {
            return false;
        }
        try {
            jdbc().queryForList(String.format(Constants.Rows.PROBE_ROWID, tableName));
            return true;
        } catch (Exception e) {
            return false;
        }
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

    /**
     * As {@link #requireExistingTable}, but a view is accepted too: reading a view's rows is
     * fine, it is only writing to one that is refused. For the read paths whose name comes from
     * the URL.
     */
    private String requireExistingTableOrView(String tableName) {
        if (isBlank(tableName)) {
            throw new IllegalArgumentException("Missing table name");
        }
        String trimmed = tableName.trim();
        if (getViewNames().contains(trimmed)) {
            return trimmed;
        }
        return requireExistingTable(trimmed);
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
        String literal = SqliteDdlText.defaultLiteralFor(type);
        return literal == null ? "" : " DEFAULT " + literal;
    }


    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String safeIdentifier(String raw, String what) {
        return SqlIdentifiers.safe(raw, what);
    }

    // ─── Update Column ────────────────────────────────────────────────────────────

    /**
     * Renames a column and/or changes its type or nullability.
     *
     * <p>A pure rename is a one-statement {@code ALTER TABLE ... RENAME COLUMN} on both engines.
     * Anything else is engine-specific: MySQL has {@code CHANGE COLUMN}, but SQLite cannot alter
     * a column's type at all, so the table is rebuilt from its own metadata (the workaround
     * SQLite itself documents) - see {@link SqliteTableRebuilder}.
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

    private void rebuildSqliteTable(String tableName, String oldColumn, String newColumn,
                                    String newType, boolean newNotNull) {
        tableRebuilder.rebuild(tableName,
                RebuildSpec.columnChange(oldColumn, newColumn, newType, newNotNull));
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
        String key = requireKeyColumn(tableName);
        String sql = Constants.Rows.ROWID_ALIAS.equals(key)
                ? String.format(Constants.Rows.UPDATE_CELL_BY_ROWID, tableName, colName)
                : String.format(Constants.Rows.UPDATE_CELL_BY_KEY, tableName, colName, key);
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
        String key = requireKeyColumn(tableName);
        jdbc().update(Constants.Rows.ROWID_ALIAS.equals(key)
                        ? String.format(Constants.Rows.DELETE_BY_ROWID, tableName)
                        : String.format(Constants.Rows.DELETE_BY_KEY, tableName, key),
                req.getRecordId());
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
            boolean foreignKeysWereOn = tableRebuilder.foreignKeysEnabled();
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
        List<String> toRun = statements;
        Runnable runAll = () -> toRun.forEach(statement -> jdbc().execute(statement));
        // One transaction on SQLite, as an import is. Each statement used to commit on its own,
        // and a commit waits for the disk: a template's few dozen INSERTs took ~3s on the free
        // plan's network-backed storage. It also means a template that fails halfway leaves
        // the file empty rather than with half a schema.
        if (isSqlite() && !FileImporter.managesItsOwnTransactions(toRun)) {
            inTransaction(runAll);
        } else {
            runAll.run();
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

    /** Runs a user's SQL statement by statement and reports each one; see {@link ScratchpadRunner}. */
    @Override
    public Map<String, Object> runScratchpad(String script) {
        return scratchpadRunner.run(script);
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
        tableRebuilder.rebuild(table, RebuildSpec.foreignKeys(List.of(clause), Set.of()));
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

        tableRebuilder.rebuild(table, RebuildSpec.foreignKeys(List.of(), Set.of(id)));
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
        // As getTableData: the name is from the URL, so it must be one the database reports.
        String name = requireExistingTableOrView(tableName);
        return jdbc().queryForList(String.format(Constants.Rows.SELECT_ALL, name));
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
        return schemaReader.createTableSql(table);
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
