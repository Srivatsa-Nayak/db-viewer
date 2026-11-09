package com.dbviewer.app.workspace;

import com.dbviewer.app.common.Constants;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Comparator;
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
 * <p>Requests that carry no workspace id fall back to a shared <b>sandbox</b> workspace
 * ({@link #SANDBOX_ID}), which keeps direct API and Swagger use working. They do <em>not</em>
 * reach the application's own database. That one holds {@code app_users} (password hashes,
 * encrypted API keys), {@code workspace_owners} and {@code shared_links}. It used to be the
 * fallback, which let an anonymous caller with no header read password hashes through
 * {@code /query} or {@code /table-data/app_users}, reassign ownership of any workspace, or drop
 * every account with {@code DELETE /workspace}. The sandbox is an ordinary workspace database;
 * clients cannot address it by id, because {@link #sanitize} rejects the reserved prefix.
 */
@Slf4j
@Component
public class WorkspaceManager {

    /** Workspace ids come from the browser, so they are whitelisted before touching a path or SQL identifier. */
    private static final int MAX_ID_LENGTH = 64;

    /**
     * Ids starting with this are the server's own and are refused from clients. Without that, a
     * caller could claim the sandbox through {@code X-Workspace-Id} and then own the database
     * every header-less request lands in.
     */
    static final String RESERVED_PREFIX = "__";

    /** The workspace a request with no {@code X-Workspace-Id} is served from. */
    public static final String SANDBOX_ID = RESERVED_PREFIX + "sandbox";

    private final JdbcTemplate defaultJdbcTemplate;
    private final Map<String, Workspace> workspaces = new ConcurrentHashMap<>();

    /** When each open workspace was last used, for {@link #evictIdle}. */
    private final Map<String, Long> lastUsed = new ConcurrentHashMap<>();

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

    /**
     * JdbcTemplate for the workspace bound to the current request, or the shared sandbox.
     *
     * <p>Never the application's own database: that is reached only through the injected
     * {@code JdbcTemplate} bean, by services that own its tables.
     */
    public JdbcTemplate current() {
        String id = WorkspaceContext.get();
        return currentWorkspace().jdbcTemplate();
    }

    /**
     * A transaction on the current workspace's database, for a change made of several
     * statements that must land together — a table rebuild, a whole import. Runs on the same
     * connection {@link #current()} uses, so statements issued through it take part.
     */
    public TransactionTemplate currentTransaction() {
        return currentWorkspace().transactions();
    }

    private Workspace currentWorkspace() {
        String id = WorkspaceContext.get();
        if (id == null || id.isBlank()) {
            lastUsed.put(SANDBOX_ID, System.currentTimeMillis());
            return workspaces.computeIfAbsent(SANDBOX_ID, this::createWorkspace);
        }
        return forWorkspace(id);
    }

    /** True when the current request is scoped to a workspace rather than the default database. */
    public boolean hasWorkspace() {
        String id = WorkspaceContext.get();
        return id != null && !id.isBlank();
    }

    public Workspace forWorkspace(String workspaceId) {
        String safeId = sanitize(workspaceId);
        lastUsed.put(safeId, System.currentTimeMillis());
        return workspaces.computeIfAbsent(safeId, this::createWorkspace);
    }

    /**
     * Closes the connections of workspaces nobody has used for {@code idle}, and then the least
     * recently used ones beyond {@code maxOpen}.
     *
     * <p>The cache used to only ever grow. Every id a browser invents opens a connection (a
     * pool of five on MySQL), so a long-running instance — or a caller inventing ids on
     * purpose — accumulated them without limit. Closing one loses nothing: the data is in its
     * file or schema, and the next request for it reopens it. In-memory SQLite is the exception,
     * where the connection <em>is</em> the database, so it is never evicted.
     *
     * @return how many were closed
     */
    public int evictIdle(Duration idle, int maxOpen) {
        if (isInMemory()) {
            return 0;
        }
        long now = System.currentTimeMillis();
        int closed = 0;
        for (String id : List.copyOf(workspaces.keySet())) {
            long used = lastUsed.getOrDefault(id, 0L);
            if (now - used >= idle.toMillis() && closeOne(id)) {
                closed++;
            }
        }
        if (maxOpen > 0 && workspaces.size() > maxOpen) {
            List<String> oldestFirst = workspaces.keySet().stream()
                    .sorted(Comparator.comparingLong(id -> lastUsed.getOrDefault(id, 0L)))
                    .toList();
            for (String id : oldestFirst.subList(0, workspaces.size() - maxOpen)) {
                if (closeOne(id)) {
                    closed++;
                }
            }
        }
        if (closed > 0) {
            log.info("Closed {} idle workspace connection(s); {} open", closed, workspaces.size());
        }
        return closed;
    }

    private boolean closeOne(String id) {
        Workspace workspace = workspaces.remove(id);
        lastUsed.remove(id);
        if (workspace == null) {
            return false;
        }
        close(workspace.dataSource());
        return true;
    }

    /** How many workspaces have an open connection right now. */
    public int openCount() {
        return workspaces.size();
    }

    /**
     * Drops a workspace entirely: closes its pool and deletes its database
     * (the SQLite file, or the MySQL schema). Used when a file is closed in the UI.
     */
    public void dropWorkspace(String workspaceId) {
        String safeId = sanitize(workspaceId);
        Workspace workspace = workspaces.remove(safeId);
        lastUsed.remove(safeId);

        if (isMysql()) {
            try {
                defaultJdbcTemplate.execute(
                        String.format(Constants.Workspaces.MYSQL_DROP_SCHEMA, schemaName(safeId)));
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
        return workspaces.keySet().stream().filter(id -> !isReserved(id)).toList();
    }

    private static boolean isReserved(String id) {
        return id.startsWith(RESERVED_PREFIX);
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
                                Constants.Workspaces.MYSQL_LIST_WORKSPACE_SCHEMAS, String.class)
                        .stream()
                        .map(schema -> schema.substring("ws_".length()))
                        .filter(id -> !isReserved(id))
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
                    .filter(id -> !isReserved(id))
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
        return new Workspace(dataSource, new JdbcTemplate(dataSource),
                new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
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
        defaultJdbcTemplate.execute(String.format(Constants.Workspaces.MYSQL_CREATE_SCHEMA, schema));

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
        if (isReserved(trimmed)) {
            throw new IllegalArgumentException(
                    "Workspace ids starting with " + RESERVED_PREFIX + " are reserved");
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

    /** A workspace's datasource, the JdbcTemplate bound to it, and transactions on it. */
    public record Workspace(DataSource dataSource, JdbcTemplate jdbcTemplate,
                            TransactionTemplate transactions) {
    }
}
