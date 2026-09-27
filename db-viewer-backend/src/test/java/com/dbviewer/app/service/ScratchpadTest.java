package com.dbviewer.app.service;

import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.sql.SqlDialect;
import com.dbviewer.app.sql.SqlDialectTranslator;
import com.dbviewer.app.dto.InsertRowRequest;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The SQL scratchpad, and views as first-class things on the canvas.
 *
 * <p>The scratchpad's job is not to run SQL — {@code executeQuery} already did that. It is to run
 * <em>several</em> statements and be able to say which one failed, which the old single-statement
 * response could not express at all.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class ScratchpadTest {

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("scratch" + UUID.randomUUID().toString().replace("-", ""));
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> statements(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.get("statements");
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) service.getDbInfo().get("tables");
    }

    @Test
    @SuppressWarnings("unchecked")
    void severalStatements_shouldAllRunAndBeReported() {
        Map<String, Object> result = service.runScratchpad("""
                CREATE TABLE a (id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO a (id, name) VALUES (1, 'one');
                INSERT INTO a (id, name) VALUES (2, 'two');
                SELECT * FROM a;
                """);

        assertThat(statements(result)).hasSize(4);
        assertThat(result).containsEntry("failed", false);
        assertThat(result).containsEntry("schemaChanged", true);

        Map<String, Object> select = statements(result).get(3);
        assertThat(select).containsEntry("kind", "SELECT");
        assertThat((List<?>) select.get("rows")).hasSize(2);
        assertThat((List<String>) select.get("columns")).containsExactly("id", "name");
    }

    @Test
    void aFailure_shouldNameTheStatementAndStopTheRest() {
        // The whole reason this endpoint exists rather than reusing executeQuery.
        Map<String, Object> result = service.runScratchpad("""
                CREATE TABLE a (id INTEGER PRIMARY KEY);
                INSERT INTO nope (id) VALUES (1);
                INSERT INTO a (id) VALUES (2);
                """);

        List<Map<String, Object>> report = statements(result);
        assertThat(result).containsEntry("failed", true);
        assertThat(report.get(0)).doesNotContainKey("error");
        assertThat(report.get(1).get("error").toString()).contains("nope");
        // The third never ran: later statements assume the earlier ones worked.
        assertThat(report.get(2)).containsEntry("kind", "skipped");
        assertThat(service.getTableRows("a")).isEmpty();
    }

    @Test
    void aSelectAlone_shouldNotClaimTheSchemaChanged() {
        service.runScratchpad("CREATE TABLE a (id INTEGER PRIMARY KEY)");
        Map<String, Object> result = service.runScratchpad("SELECT * FROM a");

        // The UI re-reads the whole schema when this is true; doing that after every SELECT
        // would make the canvas jump for no reason.
        assertThat(result).containsEntry("schemaChanged", false);
    }

    @Test
    void manyRows_shouldBeCappedAndSaidSo() {
        service.runScratchpad("CREATE TABLE big (id INTEGER PRIMARY KEY)");
        StringBuilder insert = new StringBuilder("INSERT INTO big (id) VALUES ");
        for (int i = 1; i <= 600; i++) {
            insert.append(i == 1 ? "" : ",").append("(").append(i).append(")");
        }
        service.runScratchpad(insert.toString());

        Map<String, Object> result = service.runScratchpad("SELECT * FROM big");
        Map<String, Object> select = statements(result).get(0);
        assertThat((List<?>) select.get("rows")).hasSize(500);
        assertThat(select).containsEntry("truncated", true);
    }

    @Test
    void anAssignmentPragma_shouldNotBeSentToAQuery() {
        // `PRAGMA foreign_keys = ON` returns no result set. executeQuery sends anything starting
        // with PRAGMA to queryForList and fails on exactly this.
        Map<String, Object> result = service.runScratchpad("PRAGMA foreign_keys = ON");
        assertThat(statements(result).get(0)).doesNotContainKey("error");

        // The read form still comes back as rows.
        Map<String, Object> read = service.runScratchpad("PRAGMA foreign_keys");
        assertThat((List<?>) statements(read).get(0).get("rows")).isNotEmpty();
    }

    @Test
    void theApplicationsOwnTables_shouldBeOffLimits() {
        service.addTableNote("x", "note");
        assertThatThrownBy(() -> service.runScratchpad("SELECT * FROM __table_notes"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("__table_notes");

        assertThatThrownBy(() -> service.runScratchpad("DROP TABLE __canvas_meta"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void tooManyStatements_shouldBeRefusedBeforeAnyRun() {
        String script = "SELECT 1;".repeat(60);
        assertThatThrownBy(() -> service.runScratchpad(script))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at most");
    }

    @Test
    void anEmptyScript_shouldBeRefused() {
        assertThatThrownBy(() -> service.runScratchpad("   "))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.runScratchpad("-- just a comment"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void semicolonsInsideLiterals_shouldNotSplitAStatement() {
        Map<String, Object> result = service.runScratchpad("""
                CREATE TABLE q (id INTEGER PRIMARY KEY, text TEXT);
                INSERT INTO q (id, text) VALUES (1, 'a;b;c');
                """);

        assertThat(result).containsEntry("failed", false);
        assertThat(service.getTableRows("q")).singleElement()
                .satisfies(row -> assertThat(row).containsEntry("text", "a;b;c"));
    }

    /* ── Views ───────────────────────────────────────────────────────────────── */

    @Test
    void createView_shouldAppearOnTheCanvasAsAView() {
        service.runScratchpad("""
                CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER);
                INSERT INTO orders (id, total) VALUES (1, 50);
                CREATE VIEW big_orders AS SELECT id, total FROM orders WHERE total > 10;
                """);

        TableInfo view = tables().stream()
                .filter(t -> t.getName().equals("big_orders")).findFirst().orElseThrow();
        assertThat(view.isView()).isTrue();
        // PRAGMA table_info works on a view, so the columns come for free.
        assertThat(view.getColumns()).extracting("name").containsExactly("id", "total");
        assertThat(view.getRows()).hasSize(1);

        // A table is still reported as a table.
        assertThat(tables()).filteredOn(t -> t.getName().equals("orders"))
                .singleElement().extracting(TableInfo::isView).isEqualTo(false);
    }

    @Test
    void writingToAView_shouldBeRefusedWithAReasonRatherThanASqlError() {
        service.runScratchpad("""
                CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER);
                CREATE VIEW all_orders AS SELECT * FROM orders;
                """);

        assertThatThrownBy(() ->
                service.insertRow(new InsertRowRequest("all_orders", Map.of("total", 5))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("is a view");
    }

    @Test
    void aView_shouldNotBreakTheExport() {
        service.runScratchpad("""
                CREATE TABLE orders (id INTEGER PRIMARY KEY, total INTEGER);
                CREATE VIEW all_orders AS SELECT * FROM orders;
                """);

        String sql = service.exportDatabaseSql();
        assertThat(sql).contains("orders");
        // The view is derived, so exporting it as a CREATE TABLE would be a lie about the schema.
        assertThat(sql).doesNotContain("CREATE TABLE \"all_orders\"");
    }

    @Test
    void clearingTheDatabase_shouldRemoveViewsToo() {
        service.runScratchpad("""
                CREATE TABLE orders (id INTEGER PRIMARY KEY);
                CREATE VIEW all_orders AS SELECT * FROM orders;
                """);
        assertThat(tables()).hasSize(2);

        service.clearDatabase();

        // DROP TABLE does not remove a view; without an explicit drop it would outlive its table
        // and then fail every schema read that touched it.
        assertThat(tables()).isEmpty();
    }

    @Test
    void importingADumpWithAView_shouldNoLongerDiscardIt() {
        // The translator used to list CREATE VIEW as unsupported and drop it, silently losing
        // part of the schema someone was importing. Asserted against the translator rather than
        // the scratchpad, because translation happens on import and `CREATE OR REPLACE VIEW` is
        // MySQL syntax that SQLite would reject if it were run verbatim.
        SqlDialectTranslator.Result translated = SqlDialectTranslator.translate(
                List.of("CREATE TABLE staff (id INT PRIMARY KEY, active INT)",
                        "CREATE OR REPLACE VIEW active_staff AS SELECT id FROM staff WHERE active = 1"),
                SqlDialect.MYSQL, Map.of());

        assertThat(translated.statements())
                .anySatisfy(sql -> assertThat(sql).containsIgnoringCase("VIEW active_staff"));
    }

    @Test
    void aMaterializedView_shouldStillBeSkippedOnImport() {
        // SQLite has no equivalent, so letting this through would only produce a failure later.
        SqlDialectTranslator.Result translated = SqlDialectTranslator.translate(
                List.of("CREATE MATERIALIZED VIEW m AS SELECT 1"),
                SqlDialect.POSTGRES, Map.of());

        assertThat(translated.statements()).noneSatisfy(sql ->
                assertThat(sql).containsIgnoringCase("MATERIALIZED"));
    }

    @Test
    void aViewCreatedInTheScratchpad_shouldSurviveAReRead() {
        service.runScratchpad("""
                CREATE TABLE staff (id INTEGER PRIMARY KEY, active INTEGER);
                CREATE VIEW active_staff AS SELECT id FROM staff WHERE active = 1;
                """);

        assertThat(tables()).extracting(TableInfo::getName).contains("active_staff");
    }
}
