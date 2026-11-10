package com.dbviewer.app.service.impl;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.config.DatabaseConfig;
import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.Relationship;
import com.dbviewer.app.workspace.WorkspaceManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Reads the current workspace's schema from the engine's own metadata: tables, views, columns,
 * uniqueness, foreign keys and indexes. Nothing here writes.
 *
 * <p>Split out of {@code DatabaseServiceImpl}, which builds {@code /db-info} and the assistant's
 * schema from it and uses it to validate every edit.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SchemaReader {

    private static final String INTERNAL_TABLE_PREFIX = Constants.Identifiers.INTERNAL_TABLE_PREFIX;

    private final WorkspaceManager workspaceManager;
    private final DatabaseConfig databaseConfig;

    private JdbcTemplate jdbc() {
        return workspaceManager.current();
    }

    private boolean isMysql() {
        return "mysql".equalsIgnoreCase(databaseConfig.getCurrentDriver());
    }

    /** The table's stored {@code CREATE TABLE}, or null when it cannot be read. */
    public String createTableSql(String table) {
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

    private boolean hasAutoIncrement(String tableName) {
        String ddl = createTableSql(tableName);
        return ddl != null && ddl.toUpperCase().contains("AUTOINCREMENT");
    }

    /**
     * A table's indexes as one line each, for a reader that cannot run {@code PRAGMA}.
     *
     * <p>Leaves out what the column lines already say: the primary key, and a UNIQUE on a single
     * column (rendered on the column itself). What remains is exactly what a question about
     * indexing needs and the column list does not show — every {@code CREATE INDEX}, and each
     * composite UNIQUE.
     */
    public List<String> describeIndexes(String tableName) {
        List<String> lines = new ArrayList<>();
        try {
            if (isMysql()) {
                Map<String, List<String>> columns = new LinkedHashMap<>();
                Map<String, Boolean> unique = new HashMap<>();
                jdbc().query(Constants.Introspection.MYSQL_INDEX_COLUMNS, rs -> {
                    String index = rs.getString("INDEX_NAME");
                    columns.computeIfAbsent(index, k -> new ArrayList<>()).add(rs.getString("COLUMN_NAME"));
                    unique.put(index, rs.getInt("NON_UNIQUE") == 0);
                }, tableName);
                columns.forEach((index, cols) -> {
                    if ("PRIMARY".equalsIgnoreCase(index)) return;
                    boolean isUnique = unique.getOrDefault(index, false);
                    if (isUnique && cols.size() == 1) return;
                    lines.add((isUnique ? "UNIQUE INDEX " : "INDEX ") + index
                            + " (" + String.join(", ", cols) + ")");
                });
                return lines;
            }

            record SqliteIndex(String name, boolean unique, String origin) { }
            List<SqliteIndex> found = new ArrayList<>();
            jdbc().query(String.format(Constants.Introspection.SQLITE_INDEX_LIST,
                    escapeQuoted(tableName)), rs -> {
                found.add(new SqliteIndex(rs.getString("name"), rs.getInt("unique") == 1,
                        rs.getString("origin")));
            });
            for (SqliteIndex index : found) {
                if ("pk".equalsIgnoreCase(index.origin())) continue;
                List<String> cols = new ArrayList<>();
                jdbc().query(String.format(Constants.Introspection.SQLITE_INDEX_INFO,
                        escapeQuoted(index.name())), rs -> { cols.add(rs.getString("name")); });
                if (cols.isEmpty()) continue;
                if ("u".equalsIgnoreCase(index.origin())) {
                    // A UNIQUE in the table definition. One column is already on the column line.
                    if (cols.size() > 1) lines.add("UNIQUE (" + String.join(", ", cols) + ")");
                    continue;
                }
                lines.add((index.unique() ? "UNIQUE INDEX " : "INDEX ") + index.name()
                        + " (" + String.join(", ", cols) + ")");
            }
        } catch (Exception e) {
            // The schema without its indexes is still the schema; refusing the read over it
            // would not be an improvement.
            log.debug("Could not describe indexes for {}: {}", tableName, e.getMessage());
        }
        return lines;
    }

    public String viewDefinition(String viewName) {
        try {
            List<String> sql = jdbc().queryForList(isMysql()
                    ? Constants.Introspection.MYSQL_VIEW_DDL
                    : Constants.Introspection.SQLITE_VIEW_DDL, String.class, viewName);
            return sql.isEmpty() ? null : sql.get(0);
        } catch (Exception e) {
            log.debug("Could not read the definition of view {}: {}", viewName, e.getMessage());
            return null;
        }
    }

    /** For a name going inside a double-quoted identifier in a PRAGMA: a quote is doubled. */
    private static String escapeQuoted(String name) {
        return name == null ? "" : name.replace("\"", "\"\"");
    }

    /**
     * User tables only. Internal bookkeeping (the `__` prefix) and the driver's own tables are
     * filtered out so they never reach the canvas, an export, or a table listing.
     */
    public List<String> tableNames() {
        List<String> names = isMysql()
                ? jdbc().queryForList(Constants.Introspection.MYSQL_SHOW_TABLES, String.class)
                : jdbc().queryForList(Constants.Introspection.SQLITE_SELECT_USER_TABLES, String.class);
        return names.stream().filter(name -> !name.startsWith(INTERNAL_TABLE_PREFIX)).toList();
    }

    /**
     * Views, which the canvas draws but nothing writes to.
     *
     * <p>Kept apart from {@link #tableNames()} rather than folded into it, because almost every
     * caller of that method goes on to do something only a table can take.
     */
    public List<String> viewNames() {
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

    public List<ColumnInfo> columns(String tableName) {
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
    public Set<String> uniqueColumns(String tableName) {
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

    public List<Relationship> foreignKeys(String tableName) {
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
}
