package com.dbviewer.workspace;

import com.dbviewer.dto.ColumnDefinition;
import com.dbviewer.dto.CreateTableRequest;
import com.dbviewer.dto.TableInfo;
import com.dbviewer.service.impl.DatabaseServiceImpl;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies that each workspace (one per SQL file in the UI) owns an independent
 * database, so two files can define identically named tables.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class WorkspaceIsolationTest {

    private static final String FILE_A = "isotestfilea";
    private static final String FILE_B = "isotestfileb";

    @Autowired
    private DatabaseServiceImpl service;

    @Autowired
    private WorkspaceManager workspaceManager;

    @AfterEach
    void clearContext() {
        WorkspaceContext.clear();
    }

    private CreateTableRequest customersTable() {
        return new CreateTableRequest("customers", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("name", "VARCHAR", 128, false, false, null, null)));
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tablesIn(String workspaceId) {
        WorkspaceContext.set(workspaceId);
        Map<String, Object> info = service.getDbInfo();
        return (List<TableInfo>) info.get("tables");
    }

    @Test
    void sameTableName_inTwoWorkspaces_shouldNotCollide() {
        WorkspaceContext.set(FILE_A);
        service.createTable(customersTable());

        WorkspaceContext.set(FILE_B);
        // The whole point of the fix: this used to fail because both files shared one database.
        assertThatCode(() -> service.createTable(customersTable())).doesNotThrowAnyException();

        assertThat(tablesIn(FILE_A)).extracting(TableInfo::getName).contains("customers");
        assertThat(tablesIn(FILE_B)).extracting(TableInfo::getName).contains("customers");
    }

    @Test
    void rowsWrittenInOneWorkspace_shouldNotLeakIntoAnother() {
        WorkspaceContext.set(FILE_A);
        service.createTable(new CreateTableRequest("orders", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("item", "VARCHAR", 128, false, false, null, null))));
        service.executeQuery("INSERT INTO \"orders\" (\"item\") VALUES ('laptop')");

        WorkspaceContext.set(FILE_B);
        service.createTable(new CreateTableRequest("orders", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("item", "VARCHAR", 128, false, false, null, null))));

        WorkspaceContext.set(FILE_B);
        assertThat(service.getTableRows("orders")).isEmpty();

        WorkspaceContext.set(FILE_A);
        assertThat(service.getTableRows("orders")).hasSize(1);
    }

    @Test
    void workspaceTables_shouldNotAppearInDefaultDatabase() {
        WorkspaceContext.set("isotestscoped");
        service.createTable(new CreateTableRequest("scoped_only", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));

        WorkspaceContext.clear();
        @SuppressWarnings("unchecked")
        List<TableInfo> defaultTables = (List<TableInfo>) service.getDbInfo().get("tables");
        assertThat(defaultTables).extracting(TableInfo::getName).doesNotContain("scoped_only");
    }

    @Test
    void deleteWorkspace_shouldDiscardItsTables() {
        String workspaceId = "isotestdisposable";
        WorkspaceContext.set(workspaceId);
        service.createTable(new CreateTableRequest("temp_table", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));
        assertThat(tablesIn(workspaceId)).extracting(TableInfo::getName).contains("temp_table");

        WorkspaceContext.set(workspaceId);
        service.deleteWorkspace();

        assertThat(tablesIn(workspaceId)).extracting(TableInfo::getName).doesNotContain("temp_table");
    }

    @Test
    void sanitize_shouldRejectPathTraversalAndInjection() {
        assertThatThrownBy(() -> workspaceManager.forWorkspace("../../etc/passwd"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> workspaceManager.forWorkspace("a`b"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> workspaceManager.forWorkspace("  "))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void listWorkspaces_shouldReportOpenWorkspacesAndForgetDeletedOnes() {
        String workspaceId = "isotestlisted";
        WorkspaceContext.set(workspaceId);
        service.createTable(new CreateTableRequest("listed", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));

        // The UI restores a refreshed session from this listing, so a live workspace must appear...
        assertThat(service.listWorkspaces()).contains(workspaceId);

        WorkspaceContext.set(workspaceId);
        service.deleteWorkspace();

        // ...and a closed one must not, or the browser would resurrect an empty ghost of it.
        assertThat(service.listWorkspaces()).doesNotContain(workspaceId);
    }

    @Test
    void sanitize_shouldAcceptTheIdsTheUiGenerates() {
        // The UI uses Date.now().toString().
        assertThat(WorkspaceManager.sanitize("1736512345678")).isEqualTo("1736512345678");
        assertThat(WorkspaceManager.sanitize(" file-A_1 ")).isEqualTo("file-A_1");
    }

    @Test
    void replaceMysqlSchema_shouldKeepHostAndQueryString() {
        String url = "jdbc:mysql://localhost:3306/dbviewer?useSSL=false&serverTimezone=UTC";
        assertThat(WorkspaceManager.replaceMysqlSchema(url, "ws_42"))
                .isEqualTo("jdbc:mysql://localhost:3306/ws_42?useSSL=false&serverTimezone=UTC");
    }
}
