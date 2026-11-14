package com.dbviewer.app.service.impl;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.service.DatabaseService;
import com.dbviewer.app.service.SnapshotService;
import com.dbviewer.app.sql.SqlDialect;
import com.dbviewer.app.sql.SqlScriptSplitter;
import com.dbviewer.app.service.helper.StatementText;
import com.dbviewer.app.workspace.WorkspaceContext;
import com.dbviewer.app.workspace.WorkspaceManager;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Snapshots as SQL scripts. See {@link SnapshotService}.
 *
 * <p>A script rather than a copy of the SQLite file, for three reasons: it is what the app can
 * already produce correctly for both engines ({@code exportDatabaseSql}), it can be restored
 * without closing and reopening the workspace's connection underneath other requests, and it is
 * readable. What it does not carry is what the export does not: views and secondary indexes.
 *
 * <p>Capped per file in count and size, because every byte lives in the one application
 * database on a free-tier instance. Snapshots go with their workspace: {@code release} on the
 * ownership service, which every delete path calls, removes them.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SnapshotServiceImpl implements SnapshotService {

    /** The application database (owners, accounts, snapshots), not the workspace's. */
    private final JdbcTemplate appDb;
    private final DatabaseService databaseService;
    private final WorkspaceManager workspaceManager;
    private final ObjectMapper objectMapper;
    private final com.dbviewer.app.config.DatabaseConfig databaseConfig;

    @Value("${app.snapshots.max-per-file:10}")
    private int maxPerFile = 10;

    @Value("${app.snapshots.max-bytes:5242880}")
    private int maxBytes = 5 * 1024 * 1024;

    private static final int MAX_NAME_LENGTH = 120;

    private String workspace() {
        String id = WorkspaceContext.get();
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Open a file to keep versions of it.");
        }
        return id;
    }

    private boolean isMysql() {
        return "mysql".equalsIgnoreCase(databaseConfig.getCurrentDriver());
    }

    /** The script dialect for the engine the file actually runs on. */
    private SqlDialect engineDialect() {
        return isMysql() ? SqlDialect.MYSQL : SqlDialect.SQLITE;
    }

    @Override
    public List<Map<String, Object>> list() {
        return appDb.query(Constants.Snapshots.LIST, (rs, n) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", rs.getLong("id"));
            row.put("name", rs.getString("name"));
            row.put("createdAt", rs.getString("created_at"));
            row.put("sizeBytes", rs.getLong("size_bytes"));
            row.put("tableCount", rs.getInt("table_count"));
            return row;
        }, workspace());
    }

    @Override
    public Map<String, Object> create(String rawName) {
        String workspaceId = workspace();
        Integer existing = appDb.queryForObject(Constants.Snapshots.COUNT, Integer.class, workspaceId);
        if (existing != null && existing >= maxPerFile) {
            throw new IllegalArgumentException("This file already has " + maxPerFile
                    + " versions. Delete an old one to save another.");
        }

        String name = rawName == null || rawName.isBlank()
                ? "Version " + ((existing == null ? 0 : existing) + 1)
                : rawName.trim();
        if (name.length() > MAX_NAME_LENGTH) {
            name = name.substring(0, MAX_NAME_LENGTH);
        }

        String script = databaseService.exportDatabaseSql(engineDialect());
        int size = script.getBytes(StandardCharsets.UTF_8).length;
        if (size > maxBytes) {
            throw new IllegalArgumentException("This file is " + (size / (1024 * 1024))
                    + " MB as a script; versions are kept for files up to "
                    + (maxBytes / (1024 * 1024)) + " MB. Export it instead.");
        }

        Map<String, Object> schema = databaseService.getSchemaInfo();
        String schemaJson;
        try {
            schemaJson = objectMapper.writeValueAsString(Map.of(
                    "tables", schema.getOrDefault("tables", List.of()),
                    "relationships", schema.getOrDefault("relationships", List.of())));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not record the schema", e);
        }
        int tableCount = ((List<?>) schema.getOrDefault("tables", List.of())).size();

        String createdAt = Instant.now().toString();
        appDb.update(Constants.Snapshots.INSERT, workspaceId, name, createdAt, size, tableCount,
                script, schemaJson);
        log.info("Saved version \"{}\" of workspace {} ({} bytes)", name, workspaceId, size);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", name);
        result.put("createdAt", createdAt);
        result.put("sizeBytes", size);
        result.put("tableCount", tableCount);
        return result;
    }

    private Map<String, Object> load(long id) {
        try {
            return appDb.queryForMap(Constants.Snapshots.SELECT_ONE, id, workspace());
        } catch (EmptyResultDataAccessException e) {
            // Another file's snapshot is "not found" too: the id alone opens nothing.
            throw new IllegalArgumentException("There is no such version of this file.");
        }
    }

    @Override
    public Map<String, Object> schema(long id) {
        Map<String, Object> row = load(id);
        try {
            Map<String, Object> schema = objectMapper.readValue(
                    String.valueOf(row.get("schema_json")), new TypeReference<>() { });
            schema.put("name", row.get("name"));
            schema.put("createdAt", row.get("created_at"));
            return schema;
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("That version's schema could not be read", e);
        }
    }

    @Override
    public Map<String, Object> restore(long id) {
        Map<String, Object> row = load(id);
        String script = String.valueOf(row.get("script"));

        // Kept in memory, so a snapshot that will not run cannot leave the file empty.
        String current = databaseService.exportDatabaseSql(engineDialect());
        databaseService.clearDatabase();
        try {
            runScript(script);
        } catch (RuntimeException e) {
            log.warn("Restoring version {} failed, putting the file back: {}", id, e.getMessage());
            databaseService.clearDatabase();
            runScript(current);
            throw new IllegalArgumentException("That version could not be restored, so the file "
                    + "was left as it was: " + StatementText.rootCauseMessage(e));
        }
        return Map.of("restored", row.get("name"));
    }

    /**
     * Runs an exported script. On SQLite in one transaction, as an import is; the export's own
     * {@code PRAGMA}/{@code SET} lines are session settings that are safe to run either way.
     */
    private void runScript(String script) {
        List<String> statements = SqlScriptSplitter.split(script);
        Runnable runAll = () -> statements.forEach(sql -> workspaceManager.current().execute(sql));
        if (isMysql()) {
            runAll.run();
        } else {
            workspaceManager.currentTransaction().executeWithoutResult(status -> runAll.run());
        }
    }

    @Override
    public void delete(long id) {
        if (appDb.update(Constants.Snapshots.DELETE_ONE, id, workspace()) == 0) {
            throw new IllegalArgumentException("There is no such version of this file.");
        }
    }

    @Override
    public void deleteAllFor(String workspaceId) {
        appDb.update(Constants.Snapshots.DELETE_ALL, workspaceId);
    }
}
