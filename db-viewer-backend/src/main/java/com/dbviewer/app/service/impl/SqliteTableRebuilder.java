package com.dbviewer.app.service.impl;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.workspace.WorkspaceManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Rebuilds a SQLite table to a new shape: the workaround SQLite documents for the changes it has
 * no {@code ALTER} for — retyping a column, changing its nullability, adding or dropping a
 * foreign key.
 *
 * <p>Split out of {@code DatabaseServiceImpl}, which calls it for a column change and for both
 * foreign-key operations. SQLite only: on MySQL those are ordinary {@code ALTER}s. Works on the
 * workspace bound to the current request, like everything else in the service.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class SqliteTableRebuilder {

    private final WorkspaceManager workspaceManager;

    private JdbcTemplate jdbc() {
        return workspaceManager.current();
    }

    /** Runs {@code work} in one transaction on the current workspace's database. */
    private void inTransaction(Runnable work) {
        workspaceManager.currentTransaction().executeWithoutResult(status -> work.run());
    }

    /**
     * What a rebuild is being asked to change. Every field is optional: a rebuild that only adds
     * a foreign key leaves the columns exactly as they were.
     *
     * @param oldColumn      the column being renamed or retyped, or null for no column change
     * @param addForeignKeys table-level {@code FOREIGN KEY} clauses to append
     * @param dropForeignKeys constraint ids (from {@code PRAGMA foreign_key_list}) to leave out
     */
    public record RebuildSpec(String oldColumn, String newColumn, String newType,
                               boolean newNotNull, List<String> addForeignKeys,
                               Set<Integer> dropForeignKeys) {
        public static RebuildSpec columnChange(String oldColumn, String newColumn, String newType,
                                        boolean newNotNull) {
            return new RebuildSpec(oldColumn, newColumn, newType, newNotNull, List.of(), Set.of());
        }
        public static RebuildSpec foreignKeys(List<String> add, Set<Integer> drop) {
            return new RebuildSpec(null, null, null, false, add, drop);
        }
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
    public void rebuild(String tableName, RebuildSpec spec) {
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
        String createSql = createTableSql(tableName);
        List<String> checks = SqliteDdlText.extractCheckConstraints(createSql);
        // Collations are another thing PRAGMA table_info does not report, so a rebuild used to
        // drop them — and a column declared COLLATE NOCASE quietly became case-sensitive.
        Map<String, String> collations = SqliteDdlText.extractCollations(createSql);
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
                defaultValue = SqliteDdlText.defaultLiteralFor(type);
            }

            StringBuilder def = new StringBuilder("\"" + name + "\" " + type);
            String collation = collations.get(col.name());
            if (collation != null) {
                def.append(" COLLATE ").append(collation);
            }
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
        boolean foreignKeysWereOn = foreignKeysEnabled();
        jdbc().execute(Constants.Session.SQLITE_FOREIGN_KEYS_OFF);
        try {
            // One transaction for the whole rebuild. Without it, a crash or a failure between
            // DROP TABLE and RENAME left the data only in the temporary copy — the table the
            // user was editing simply gone. PRAGMA foreign_keys is set outside, as SQLite
            // ignores it inside a transaction.
            inTransaction(() -> {
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE_IF_EXISTS_QUOTED, temp));
            jdbc().execute(String.format(Constants.Tables.CREATE_TABLE,
                    "\"" + temp + "\"", String.join(", ", definitions)));
            jdbc().execute(String.format(Constants.Tables.COPY_ROWS,
                    temp,
                    String.join(", ", targetColumns),
                    String.join(", ", sourceExpressions),
                    tableName));
            jdbc().execute(String.format(Constants.Tables.DROP_TABLE, "\"" + tableName + "\""));
            jdbc().execute(String.format(Constants.Tables.RENAME_TABLE, temp, tableName));

            // Indexes belong to the table, so dropping it dropped them. They are recreated from
            // their own DDL, with the renamed column substituted where one was renamed.
            for (String indexSql : indexes) {
                String sql = oldColumn != null && newColumn != null
                        ? SqliteDdlText.renameColumnInSql(indexSql, oldColumn, newColumn)
                        : indexSql;
                try {
                    jdbc().execute(sql);
                } catch (RuntimeException indexError) {
                    // One index that will not rebuild must not roll back a successful migration
                    // of the data; the table is correct either way.
                    log.warn("Could not recreate index on {}: {}", tableName, indexError.getMessage());
                }
            }
            });
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
    public boolean foreignKeysEnabled() {
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
                        .map(c -> "\"" + c + "\"").collect(Collectors.joining(", ")) + ")");
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
        String ddl = createTableSql(tableName);
        return ddl != null && ddl.toUpperCase().contains("AUTOINCREMENT");
    }

    private String createTableSql(String table) {
        try {
            return jdbc().queryForObject(Constants.Introspection.SQLITE_SELECT_TABLE_SQL, String.class, table);
        } catch (Exception e) {
            return null;
        }
    }

    /** Column metadata as reported by {@code PRAGMA table_info}. */
    private record SqliteColumn(String name, String type, boolean notNull, String defaultValue, int pkPosition) {
    }
}
