package com.dbviewer.app.service;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.dto.DeleteRowRequest;
import com.dbviewer.app.dto.UpdateCellRequest;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.workspace.ClientContext;
import com.dbviewer.app.workspace.WorkspaceContext;
import com.dbviewer.app.workspace.WorkspaceJanitor;
import com.dbviewer.app.workspace.WorkspaceManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Paging, key addressing, transactions and housekeeping.
 *
 * <p>On file-backed SQLite in a temporary directory rather than in memory: closing an idle
 * connection is deliberately skipped for in-memory databases (the connection is the database),
 * so eviction can only be observed against real files.
 */
@SpringBootTest
@DirtiesContext
class BackendRobustnessTest {

    @TempDir
    static Path dataDir;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + dataDir.resolve("app.db"));
        registry.add("spring.datasource.driver-class-name", () -> "org.sqlite.JDBC");
        registry.add("app.db.driver", () -> "sqlite");
        registry.add("app.workspace.dir", () -> dataDir.resolve("workspaces").toString());
        registry.add("app.import.max-statements", () -> "50");
    }

    @Autowired DatabaseServiceImpl service;
    @Autowired WorkspaceManager workspaceManager;
    @Autowired WorkspaceJanitor janitor;
    @Autowired JdbcTemplate appDb;

    private String workspace;

    @BeforeEach
    void open() {
        workspace = "rb" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        WorkspaceContext.set(workspace);
    }

    @AfterEach
    void close() {
        try {
            service.deleteWorkspace();
        } finally {
            WorkspaceContext.clear();
            ClientContext.clear();
        }
    }

    private MockMultipartFile sql(String name, String body) {
        return new MockMultipartFile("file", name, "application/sql", body.getBytes(StandardCharsets.UTF_8));
    }

    @Test
    @SuppressWarnings("unchecked")
    void tableDataPagesAndReportsTheRealTotal() {
        service.executeQuery("CREATE TABLE n (id INTEGER PRIMARY KEY, v TEXT)");
        for (int i = 0; i < 250; i++) {
            service.executeQuery("INSERT INTO n (v) VALUES ('" + i + "')");
        }

        Map<String, Object> first = service.getTableData("n", 100, 0);
        Map<String, Object> third = service.getTableData("n", 100, 200);

        assertThat((List<?>) first.get("rows")).hasSize(100);
        assertThat(first.get("total")).isEqualTo(250L);
        assertThat((List<?>) third.get("rows")).hasSize(50);
        assertThat(((List<Map<String, Object>>) third.get("rows")).get(0).get("v")).isEqualTo("200");
        // Silly page sizes are clamped rather than refused.
        assertThat((List<?>) service.getTableData("n", 5_000_000, -3).get("rows")).hasSize(250);
    }

    /** A table keyed by something other than `id` used to be uneditable row by row. */
    @Test
    void rowsAreAddressedByTheirPrimaryKeyWhenThereIsNoIdColumn() {
        service.executeQuery("CREATE TABLE country (code TEXT PRIMARY KEY, name TEXT)");
        service.executeQuery("INSERT INTO country VALUES ('FR', 'France'), ('DE', 'Germany')");

        assertThat(service.getTableData("country", 100, 0).get("keyColumn")).isEqualTo("code");

        UpdateCellRequest update = new UpdateCellRequest();
        update.setTableName("country");
        update.setColumnName("name");
        update.setNewValue("République française");
        update.setRecordId("FR");
        service.updateCell(update);

        DeleteRowRequest delete = new DeleteRowRequest();
        delete.setTableName("country");
        delete.setRecordId("DE");
        service.deleteRow(delete);

        assertThat(service.executeQuery("SELECT name FROM country"))
                .extracting(row -> row.get("name")).containsExactly("République française");
    }

    @Test
    @SuppressWarnings("unchecked")
    void aCompositeKeyTableIsEditedThroughItsRowId() {
        service.executeQuery("CREATE TABLE pair (a INT, b INT, note TEXT, PRIMARY KEY (a, b))");
        service.executeQuery("INSERT INTO pair VALUES (1, 1, 'keep'), (1, 2, 'change'), (2, 1, 'drop')");

        Map<String, Object> page = service.getTableData("pair", 10, 0);
        assertThat(page.get("keyColumn")).isEqualTo("__rowid");
        List<Map<String, Object>> rows = (List<Map<String, Object>>) page.get("rows");
        String changeId = String.valueOf(rows.stream().filter(r -> "change".equals(r.get("note")))
                .findFirst().orElseThrow().get("__rowid"));
        String dropId = String.valueOf(rows.stream().filter(r -> "drop".equals(r.get("note")))
                .findFirst().orElseThrow().get("__rowid"));

        UpdateCellRequest update = new UpdateCellRequest();
        update.setTableName("pair");
        update.setColumnName("note");
        update.setNewValue("changed");
        update.setRecordId(changeId);
        service.updateCell(update);
        DeleteRowRequest delete = new DeleteRowRequest();
        delete.setTableName("pair");
        delete.setRecordId(dropId);
        service.deleteRow(delete);

        assertThat(service.executeQuery("SELECT note FROM pair ORDER BY a, b"))
                .extracting(row -> row.get("note")).containsExactly("keep", "changed");
    }

    /** A WITHOUT ROWID table has no row id to fall back on, so it still cannot be edited by row. */
    @Test
    void aWithoutRowidTableWithACompositeKeySaysSo() {
        service.executeQuery("CREATE TABLE pairs (a INT, b INT, PRIMARY KEY (a, b)) WITHOUT ROWID");
        DeleteRowRequest delete = new DeleteRowRequest();
        delete.setTableName("pairs");
        delete.setRecordId("1");

        assertThat(service.getTableData("pairs", 10, 0)).doesNotContainKey("keyColumn");
        assertThatThrownBy(() -> service.deleteRow(delete))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("single-column primary key");
    }

    /** PRAGMA table_info does not report a collation, so the rebuild used to drop it. */
    @Test
    void aColumnKeepsItsCollationThroughARebuild() {
        service.executeQuery("CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT COLLATE NOCASE, age TEXT)");
        service.executeQuery("INSERT INTO people (email, age) VALUES ('Ada@Example.com', '36')");

        // Retyping another column forces SQLite's table rebuild.
        com.dbviewer.app.dto.UpdateColumnRequest retype = new com.dbviewer.app.dto.UpdateColumnRequest();
        retype.setTableName("people");
        retype.setColumnName("age");
        retype.setColumnType("INTEGER");
        service.updateColumn(retype);

        String ddl = String.valueOf(service.executeQuery(
                "SELECT sql FROM sqlite_master WHERE name = 'people'").get(0).get("sql"));
        assertThat(ddl).containsIgnoringCase("COLLATE NOCASE");
        // And it still behaves case-insensitively.
        assertThat(service.executeQuery("SELECT id FROM people WHERE email = 'ada@example.com'")).hasSize(1);
    }

    /** A dump's indexes, unique constraints and checks now survive the import. */
    @Test
    void anImportedDumpKeepsItsIndexesUniquesAndChecks() throws Exception {
        service.handleFileUpload(sql("shop.sql", """
                CREATE TABLE `customers` (
                  `id` int(11) NOT NULL,
                  `email` varchar(255) NOT NULL,
                  `region` varchar(20) DEFAULT NULL,
                  `age` int(11) DEFAULT NULL,
                  UNIQUE KEY `email` (`email`),
                  KEY `region` (`region`(10)),
                  CONSTRAINT `age_ok` CHECK (`age` >= 0)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                CREATE TABLE `orders` (
                  `id` int(11) NOT NULL,
                  `customer_id` int(11) NOT NULL,
                  `placed_on` date NOT NULL
                ) ENGINE=InnoDB;
                ALTER TABLE `orders`
                  ADD PRIMARY KEY (`id`),
                  ADD KEY `region` (`customer_id`, `placed_on`);
                """));

        List<String> indexes = service.executeQuery(
                        "SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").stream()
                .map(row -> String.valueOf(row.get("name"))).toList();
        // Both tables had an index called `region`; prefixed, neither is lost to the other.
        assertThat(indexes).contains("customers_region", "orders_region");

        assertThatThrownBy(() -> service.executeQuery(
                "INSERT INTO customers (id, email, age) VALUES (1, 'a@b.c', 1), (2, 'a@b.c', 2)"))
                .hasMessageContaining("UNIQUE");
        assertThatThrownBy(() -> service.executeQuery(
                "INSERT INTO customers (id, email, age) VALUES (3, 'x@y.z', -1)"))
                .hasMessageContaining("CHECK");
    }

    /** A script with its own transaction control is run as written, not nested inside ours. */
    @Test
    void anImportWithItsOwnTransactionStillRuns() throws Exception {
        service.handleFileUpload(sql("t.sql", """
                BEGIN TRANSACTION;
                CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);
                INSERT INTO a (x) VALUES ('one');
                COMMIT;
                """));

        assertThat(service.executeQuery("SELECT COUNT(*) c FROM a").get(0).get("c")).isEqualTo(1);
    }

    @Test
    void aSkippedStatementInsideTheImportTransactionDoesNotUndoTheRest() throws Exception {
        Map<String, Object> report = service.handleFileUpload(sql("t.sql", """
                CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);
                INSERT INTO a (x) VALUES ('kept');
                INSERT INTO no_such_table VALUES (1);
                INSERT INTO a (x) VALUES ('also kept');
                """));

        assertThat(report.get("statementsSkipped")).isEqualTo(1);
        assertThat(service.executeQuery("SELECT COUNT(*) c FROM a").get(0).get("c")).isEqualTo(2);
    }

    @Test
    void anOversizedImportIsRefusedBeforeAnythingRuns() {
        StringBuilder script = new StringBuilder("CREATE TABLE big (id INTEGER PRIMARY KEY);\n");
        for (int i = 0; i < 60; i++) {
            script.append("INSERT INTO big DEFAULT VALUES;\n");
        }

        assertThatThrownBy(() -> service.handleFileUpload(sql("big.sql", script.toString()), null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at most 50");
        assertThat(service.executeQuery(
                "SELECT COUNT(*) c FROM sqlite_master WHERE name = 'big'").get(0).get("c")).isEqualTo(0);
    }

    @Test
    void idleConnectionsAreClosedAndReopenTransparently() {
        service.executeQuery("CREATE TABLE kept (id INTEGER PRIMARY KEY)");
        int before = workspaceManager.openCount();

        int closed = workspaceManager.evictIdle(Duration.ZERO, 0);

        assertThat(closed).isPositive();
        assertThat(workspaceManager.openCount()).isLessThan(before);
        // Nothing was lost: the next request reopens the file.
        assertThat(service.executeQuery("SELECT name FROM sqlite_master WHERE name = 'kept'")).hasSize(1);
    }

    @Test
    void abandonedAnonymousWorkspacesAreSweptAndAccountsAreNot() throws Exception {
        String anonymous = "rbanon" + UUID.randomUUID().toString().substring(0, 8);
        String owned = "rbuser" + UUID.randomUUID().toString().substring(0, 8);
        String longAgo = Instant.now().minus(Duration.ofDays(400)).toString();
        for (String[] row : new String[][]{{anonymous, "anon:browser-1"}, {owned, "user:someone@example.com"}}) {
            WorkspaceContext.set(row[0]);
            service.executeQuery("CREATE TABLE t (id INTEGER PRIMARY KEY)");
            appDb.update(Constants.Ownership.INSERT_OWNER, row[0], row[1], "f.sql", longAgo);
        }
        WorkspaceContext.set(workspace);

        List<String> swept = janitor.sweepAbandoned();

        assertThat(swept).contains(anonymous).doesNotContain(owned);
        assertThat(Files.exists(dataDir.resolve("workspaces").resolve("ws_" + anonymous + ".db"))).isFalse();
        assertThat(Files.exists(dataDir.resolve("workspaces").resolve("ws_" + owned + ".db"))).isTrue();
        appDb.update(Constants.Ownership.DELETE_OWNER, owned);
    }
}
