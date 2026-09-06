package com.dbviewer.sql;

import com.dbviewer.dto.ColumnInfo;
import com.dbviewer.dto.Relationship;
import com.dbviewer.dto.TableInfo;
import com.dbviewer.service.impl.DatabaseServiceImpl;
import com.dbviewer.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Import coverage for real-world MySQL dumps.
 *
 * <p>The original importer split the script on {@code ";"} and then skipped any chunk starting
 * with {@code "--"}. Because a phpMyAdmin dump prefixes every statement with a comment banner,
 * that skipped every CREATE TABLE and INSERT in the file and the canvas came up empty.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class SqlImportTest {

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("sqlimport" + UUID.randomUUID().toString().replace("-", ""));
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    private Map<String, Object> upload(String name, String sql) throws Exception {
        return service.handleFileUpload(new MockMultipartFile(
                "file", name, "application/sql", sql.getBytes(StandardCharsets.UTF_8)));
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) service.getDbInfo().get("tables");
    }

    @SuppressWarnings("unchecked")
    private List<Relationship> relationships() {
        return (List<Relationship>) service.getDbInfo().get("relationships");
    }

    // ─── The reported bug ─────────────────────────────────────────────────────────

    @Test
    void phpMyAdminDump_shouldImportEveryTableAndRow() throws Exception {
        String dump = new String(new ClassPathResource("test-files-for-upload/broadband.sql")
                .getInputStream().readAllBytes(), StandardCharsets.UTF_8);

        Map<String, Object> report = upload("broadband.sql", dump);

        assertThat(tables()).extracting(TableInfo::getName)
                .containsExactlyInAnyOrder("account", "admin", "bill", "customer", "feedback", "plan");

        assertThat((Integer) report.get("statementsExecuted")).isGreaterThanOrEqualTo(12);
        assertThat(service.getTableRows("customer")).hasSize(8);
        assertThat(service.getTableRows("plan")).hasSize(7);
        assertThat(service.getTableRows("account")).hasSize(3);
    }

    @Test
    void phpMyAdminDump_shouldFoldAlterTableKeysIntoTheSchema() throws Exception {
        String dump = new String(new ClassPathResource("test-files-for-upload/broadband.sql")
                .getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        upload("broadband.sql", dump);

        // Primary keys are declared by a later ALTER TABLE, which SQLite cannot execute -
        // they have to be folded into the CREATE TABLE instead.
        @SuppressWarnings("unchecked")
        List<ColumnInfo> accountColumns = (List<ColumnInfo>) service.getTableData("account").get("columns");
        assertThat(accountColumns)
                .filteredOn(ColumnInfo::isPk)
                .extracting(ColumnInfo::getName)
                .containsExactly("Acc_id");

        // Same for the foreign keys, which drive the diagram's edges.
        assertThat(relationships())
                .extracting(Relationship::getSourceTable, Relationship::getSourceColumn,
                        Relationship::getTargetTable, Relationship::getTargetColumn)
                .contains(
                        org.assertj.core.groups.Tuple.tuple("account", "Cust_id", "customer", "Cust_id"),
                        org.assertj.core.groups.Tuple.tuple("account", "Plan_no", "plan", "Plan_no"),
                        org.assertj.core.groups.Tuple.tuple("bill", "Admin_id", "admin", "Admin_id"),
                        org.assertj.core.groups.Tuple.tuple("feedback", "Cust_id", "customer", "Cust_id"));
    }

    @Test
    void phpMyAdminDump_shouldReportWhatItSkipped() throws Exception {
        String dump = new String(new ClassPathResource("test-files-for-upload/broadband.sql")
                .getInputStream().readAllBytes(), StandardCharsets.UTF_8);

        Map<String, Object> report = upload("broadband.sql", dump);

        @SuppressWarnings("unchecked")
        List<String> warnings = (List<String>) report.get("warnings");
        // The two MySQL triggers cannot be translated, and the user should be told so.
        assertThat(warnings).isNotEmpty();
        assertThat(String.join("\n", warnings)).contains("CREATE TRIGGER");
    }

    // ─── Splitter behaviour ───────────────────────────────────────────────────────

    @Test
    void commentPrefixedStatements_shouldStillRun() throws Exception {
        String sql = """
                --
                -- Table structure for table `notes`
                --
                CREATE TABLE `notes` (`id` int(11) NOT NULL, `body` text NOT NULL);
                --
                -- Dumping data
                --
                INSERT INTO `notes` (`id`, `body`) VALUES (1, 'hello');
                """;

        upload("notes.sql", sql);

        assertThat(tables()).extracting(TableInfo::getName).contains("notes");
        assertThat(service.getTableRows("notes")).hasSize(1);
    }

    @Test
    void semicolonInsideAStringLiteral_shouldNotSplitTheStatement() throws Exception {
        String sql = """
                CREATE TABLE `quotes` (`id` int NOT NULL, `text` text NOT NULL);
                INSERT INTO `quotes` (`id`, `text`) VALUES (1, 'a;b;c'), (2, 'it''s -- not a comment');
                """;

        upload("quotes.sql", sql);

        List<Map<String, Object>> rows = service.getTableRows("quotes");
        assertThat(rows).hasSize(2);
        assertThat(rows.get(0)).containsEntry("text", "a;b;c");
        assertThat(rows.get(1)).containsEntry("text", "it's -- not a comment");
    }

    @Test
    void delimiterBlocks_shouldNotLeakFragmentsIntoTheNextStatement() {
        String sql = """
                CREATE TABLE `t` (`id` int NOT NULL);
                DELIMITER $$
                CREATE TRIGGER `t_trg` BEFORE INSERT ON `t` FOR EACH ROW BEGIN
                  IF NEW.id < 0 THEN
                    SIGNAL SQLSTATE '45000';
                  END IF;
                END
                $$
                DELIMITER ;
                INSERT INTO `t` (`id`) VALUES (1);
                """;

        List<String> statements = SqlScriptSplitter.split(sql);

        // The trigger body must arrive as ONE statement (its internal semicolons do not end it),
        // and no stray "END $$ DELIMITER" fragment may follow - that fragment was the error the
        // original importer reported.
        assertThat(statements).hasSize(3);
        assertThat(statements.get(0)).startsWith("CREATE TABLE");
        assertThat(statements.get(1)).startsWith("CREATE TRIGGER");
        assertThat(statements.get(1)).contains("END IF;");
        assertThat(statements).noneMatch(s -> s.contains("$$"));
        assertThat(statements).noneMatch(s -> s.toUpperCase().startsWith("DELIMITER"));
        assertThat(statements.get(2)).startsWith("INSERT INTO");
    }

    @Test
    void blockCommentsAndHashComments_shouldBeStripped() {
        String sql = """
                /*!40101 SET NAMES utf8mb4 */;
                # a hash comment
                SELECT 1;
                """;

        List<String> statements = SqlScriptSplitter.split(sql);

        assertThat(statements).containsExactly("SELECT 1");
    }

    @Test
    void plainSqliteScript_shouldStillImport() throws Exception {
        String sql = "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, item TEXT, amount DECIMAL);\n"
                + "INSERT INTO orders (item, amount) VALUES ('Laptop', 999.99);\n";

        Map<String, Object> report = upload("schema.sql", sql);

        assertThat(report.get("message")).isEqualTo("SQL executed successfully");
        assertThat(report.get("statementsSkipped")).isEqualTo(0);
        assertThat(service.getTableRows("orders")).hasSize(1);
    }
}
