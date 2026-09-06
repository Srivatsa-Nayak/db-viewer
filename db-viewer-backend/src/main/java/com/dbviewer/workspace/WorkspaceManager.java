package com.dbviewer.workspace;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

/**
 * Owns one isolated database per workspace (i.e. per SQL file open in the UI).
 *
 * <p>Without this, every file in the explorer shared the one datasource defined in
 * application.properties, so creating a {@code users} table in one file made it
 * appear in every other file - and creating it twice failed outright. Each
 * workspace now gets its own physical database:
 *
 * <ul>
 *   <li><b>SQLite (default)</b> - one file per workspace under
 *       {@code app.workspace.dir}, e.g. {@code ./data/workspaces/ws_1736512345.db}.</li>
 *   <li><b>SQLite in-memory</b> - one named shared-cache in-memory database per
 *       workspace, kept alive by a single retained connection.</li>
 *   <li><b>MySQL</b> - one schema per workspace ({@code ws_<id>}), created on demand.</li>
 * </ul>
 *
 * <p>Requests that carry no workspace id fall back to the default JdbcTemplate,
 * which preserves the original single-database behaviour for direct API/Swagger use.
 */
@Slf4j
@Component
public class WorkspaceManager {

    /** Workspace ids come from the browser, so they are whitelisted before touching a path or SQL identifier. */
    private static final int MAX_ID_LENGTH = 64;

    private final JdbcTemplate defaultJdbcTemplate;
    private final Map<String, Workspace> workspaces = new ConcurrentHashMap<>();

    private final String baseUrl;
    private final String driverClassName;
    private final String username;
    private final String password;
    private final String dbDriver;
    private final String workspaceDir;

    public WorkspaceManager(
            JdbcTemplate defaultJdbcTemplate,
            @Value("${spring.datasource.url}") String baseUrl,
            @Value("${spring.datasource.driver-class-name:}") String driverClassName,
            @Value("${spring.datasource.username:}") String username,
            @Value("${spring.datasource.password:}") String password,
            @Value("${app.db.driver:sqlite}") String dbDriver,
            @Value("${app.workspace.dir:./data/workspaces}") String workspaceDir) {
        this.defaultJdbcTemplate = defaultJdbcTemplate;
        this.baseUrl = baseUrl;
        this.driverClassName = driverClassName;
        this.username = username;
        this.password = password;
        this.dbDriver = dbDriver;
        this.workspaceDir = workspaceDir;
    }

    /** JdbcTemplate for the workspace bound to the current request, or the default one. */
    public JdbcTemplate current() {
        String id = WorkspaceContext.get();
        if (id == null || id.isBlank()) {
            return defaultJdbcTemplate;
        }
        return forWorkspace(id).jdbcTemplate();
    }

    /** True when the current request is scoped to a workspace rather than the default database. */
    public boolean hasWorkspace() {
        String id = WorkspaceContext.get();
        return id != null && !id.isBlank();
    }

    public Workspace forWorkspace(String workspaceId) {
        String safeId = sanitize(workspaceId);
        return workspaces.computeIfAbsent(safeId, this::createWorkspace);
    }

    /**
     * Drops a workspace entirely: closes its pool and deletes its database
     * (the SQLite file, or the MySQL schema). Used when a file is closed in the UI.
     */
    public void dropWorkspace(String workspaceId) {
        String safeId = sanitize(workspaceId);
        Workspace workspace = workspaces.remove(safeId);

        if (isMysql()) {
            try {
                defaultJdbcTemplate.execute("DROP DATABASE IF EXISTS `" + schemaName(safeId) + "`");
            } catch (Exception e) {
                log.warn("Failed to drop MySQL schema for workspace {}: {}", safeId, e.getMessage());
            }
            if (workspace != null) {
                close(workspace.dataSource());
            }
        } else {
            if (workspace != null) {
                close(workspace.dataSource());
            }
            // Also runs when the workspace was never opened in this process, so a
            // file left behind by an earlier run still gets cleaned up.
            deleteSqliteFile(safeId);
        }
        log.info("Dropped workspace {}", safeId);
    }

    public List<String> openWorkspaceIds() {
        return new ArrayList<>(workspaces.keySet());
    }

    /**
     * Every workspace that still has a database, whether or not this process has opened it yet.
     *
     * <p>The browser remembers which files were open across a refresh, but only their names and
     * ids - the schema itself is re-read from here. This listing lets the UI drop entries whose
     * database is gone (a wiped data directory, a different machine) instead of silently
     * recreating an empty one on first access.
     */
    public List<String> existingWorkspaceIds() {
        if (isMysql()) {
            try {
                return defaultJdbcTemplate.queryForList(
                                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA "
                                        + "WHERE SCHEMA_NAME LIKE 'ws\\_%'", String.class)
                        .stream()
                        .map(schema -> schema.substring("ws_".length()))
                        .sorted()
                        .toList();
            } catch (Exception e) {
                log.warn("Could not list MySQL workspaces: {}", e.getMessage());
                return openWorkspaceIds();
            }
        }

        // An in-memory database only exists while its connection is held, so "on disk" has no
        // meaning - the ones currently open are the only ones there are.
        if (isInMemory()) {
            return openWorkspaceIds();
        }

        Path dir = Paths.get(workspaceDir);
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> files = Files.list(dir)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.startsWith("ws_") && name.endsWith(".db"))
                    .map(name -> name.substring("ws_".length(), name.length() - ".db".length()))
                    .sorted()
                    .toList();
        } catch (IOException e) {
            log.warn("Could not list workspace files in {}: {}", dir, e.getMessage());
            return List.of();
        }
    }

    // --- Creation -------------------------------------------------------------

    private Workspace createWorkspace(String safeId) {
        DataSource dataSource = isMysql() ? createMysqlDataSource(safeId) : createSqliteDataSource(safeId);
        log.info("Opened workspace {} ({})", safeId, isMysql() ? "mysql" : "sqlite");
        return new Workspace(dataSource, new JdbcTemplate(dataSource));
    }

    private DataSource createSqliteDataSource(String safeId) {
        String url = isInMemory()
                // A named shared-cache database lives only while a connection stays open,
                // which SingleConnectionDataSource guarantees.
                ? "jdbc:sqlite:file:ws_" + safeId + "?mode=memory&cache=shared"
                : "jdbc:sqlite:" + sqlitePath(safeId);

        SingleConnectionDataSource dataSource = new SingleConnectionDataSource(url, true);
        if (!driverClassName.isBlank()) {
            dataSource.setDriverClassName(driverClassName);
        }
        dataSource.setAutoCommit(true);
        return dataSource;
    }

    private DataSource createMysqlDataSource(String safeId) {
        String schema = schemaName(safeId);
        defaultJdbcTemplate.execute("CREATE DATABASE IF NOT EXISTS `" + schema + "`");

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(replaceMysqlSchema(baseUrl, schema));
        config.setUsername(username);
        config.setPassword(password);
        if (!driverClassName.isBlank()) {
            config.setDriverClassName(driverClassName);
        }
        config.setMaximumPoolSize(5);
        config.setMinimumIdle(1);
        config.setPoolName("ws-" + safeId);
        return new HikariDataSource(config);
    }

    // --- Helpers --------------------------------------------------------------

    /**
     * Reduces a client-supplied id to letters, digits, underscore and hyphen so it can
     * safely become a filename or a MySQL schema name. Anything else is rejected
     * rather than escaped.
     */
    static String sanitize(String workspaceId) {
        if (workspaceId == null) {
            throw new IllegalArgumentException("Workspace id is required");
        }
        String trimmed = workspaceId.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_ID_LENGTH) {
            throw new IllegalArgumentException("Workspace id must be 1-" + MAX_ID_LENGTH + " characters");
        }
        if (!trimmed.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException(
                    "Workspace id may only contain letters, digits, underscores and hyphens");
        }
        return trimmed;
    }

    private Path sqlitePath(String safeId) {
        Path dir = Paths.get(workspaceDir);
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create workspace directory " + dir.toAbsolutePath(), e);
        }
        return dir.resolve("ws_" + safeId + ".db").toAbsolutePath();
    }

    private void deleteSqliteFile(String safeId) {
        if (isInMemory()) {
            return;
        }
        try {
            Files.deleteIfExists(sqlitePath(safeId));
        } catch (IOException e) {
            log.warn("Failed to delete database file for workspace {}: {}", safeId, e.getMessage());
        }
    }

    private String schemaName(String safeId) {
        return "ws_" + safeId;
    }

    /** Swaps the database name in a MySQL JDBC URL, preserving host, port and query string. */
    static String replaceMysqlSchema(String url, String schema) {
        int schemeEnd = url.indexOf("://");
        if (schemeEnd < 0) {
            return url;
        }
        int pathStart = url.indexOf('/', schemeEnd + 3);
        if (pathStart < 0) {
            return url + "/" + schema;
        }
        int queryStart = url.indexOf('?', pathStart);
        String query = queryStart < 0 ? "" : url.substring(queryStart);
        return url.substring(0, pathStart + 1) + schema + query;
    }

    private boolean isMysql() {
        return "mysql".equalsIgnoreCase(dbDriver);
    }

    private boolean isInMemory() {
        return baseUrl != null && baseUrl.contains(":memory:");
    }

    private void close(DataSource dataSource) {
        try {
            if (dataSource instanceof HikariDataSource hikari) {
                hikari.close();
            } else if (dataSource instanceof SingleConnectionDataSource single) {
                single.destroy();
            }
        } catch (Exception e) {
            log.warn("Failed to close workspace datasource: {}", e.getMessage());
        }
    }

    @PreDestroy
    void shutdown() {
        workspaces.values().forEach(w -> close(w.dataSource()));
        workspaces.clear();
    }

    /** A workspace's datasource plus the JdbcTemplate bound to it. */
    public record Workspace(DataSource dataSource, JdbcTemplate jdbcTemplate) {
    }
}
