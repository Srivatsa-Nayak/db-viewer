package com.dbviewer.app.workspace;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.dto.ColumnDefinition;
import com.dbviewer.app.dto.CreateTableRequest;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
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

    @Autowired
    private WorkspaceOwnershipService ownershipService;

    @AfterEach
    void clearContext() {
        WorkspaceContext.clear();
        ClientContext.clear();
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
        // The listing is scoped to whoever is asking, and in a real request WorkspaceOwnershipFilter
        // is what claims the workspace. Calling the service directly, the test has to do both.
        ClientContext.set("isotestclient");
        WorkspaceContext.set(workspaceId);
        ownershipService.claimOrVerify(workspaceId);
        service.createTable(new CreateTableRequest("listed", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));
        service.setWorkspaceName("orders.sql");

        // The UI restores a refreshed session from this listing, so a live workspace must appear...
        assertThat(listedIds()).contains(workspaceId);

        // ...and it must carry the name, because after signing out the browser has no copy of it.
        assertThat(service.listWorkspaces())
                .filteredOn(w -> w.id().equals(workspaceId))
                .singleElement()
                .extracting(WorkspaceOwnershipService.OwnedWorkspace::name)
                .isEqualTo("orders.sql");

        WorkspaceContext.set(workspaceId);
        service.deleteWorkspace();

        // ...and a closed one must not, or the browser would resurrect an empty ghost of it.
        assertThat(listedIds()).doesNotContain(workspaceId);
    }

    /**
     * The bug this guards: sign in, make files, sign out, sign back in — and they are gone.
     *
     * <p>Two things caused it and both are asserted here. The file name lived only in the
     * browser's localStorage, which signing out clears, so nothing could name a file again; and
     * the listing is keyed by owner, so it has to keep answering for the account across the
     * sign-out. The databases were never the problem — they were on disk the whole time.
     */
    @Test
    void namedFiles_shouldStillBeListedAfterSigningOutAndBackIn() {
        String workspaceId = "isotestsignout";
        String email = "owner@example.com";

        // Signed in, creating a file.
        ClientContext.set("isotestbrowser");
        AuthContext.set(email);
        WorkspaceContext.set(workspaceId);
        ownershipService.claimOrVerify(workspaceId);
        service.createTable(new CreateTableRequest("kept", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));
        service.setWorkspaceName("payroll.sql");

        // Signed out: the browser is anonymous again, and the account's files are not its own.
        AuthContext.clear();
        assertThat(listedIds()).doesNotContain(workspaceId);

        // Signed back in — same account, and in a real sign-in the browser has just cleared its
        // localStorage, so the backend is the only thing that can still name this file.
        AuthContext.set(email);
        assertThat(service.listWorkspaces())
                .filteredOn(w -> w.id().equals(workspaceId))
                .singleElement()
                .extracting(WorkspaceOwnershipService.OwnedWorkspace::name)
                .isEqualTo("payroll.sql");

        // And the tables are genuinely still there, not just an entry in a list.
        WorkspaceContext.set(workspaceId);
        assertThat(service.getDbInfo().get("tables")).isInstanceOf(List.class);
        assertThat(((List<?>) service.getDbInfo().get("tables"))).hasSize(1);

        WorkspaceContext.set(workspaceId);
        service.deleteWorkspace();
        AuthContext.clear();
    }

    /** The listing carries names now; most assertions here only care about which files exist. */
    private List<String> listedIds() {
        return service.listWorkspaces().stream()
                .map(WorkspaceOwnershipService.OwnedWorkspace::id)
                .toList();
    }

    @Test
    void sanitize_shouldAcceptTheIdsTheUiGenerates() {
        // services/workspaceId.ts mints "<epoch millis>-<8 random chars>". The bare timestamp is
        // the older shape and still has to be accepted: sessions stored before that change are
        // restored by id.
        assertThat(WorkspaceManager.sanitize("1736512345678-a1b2c3d4")).isEqualTo("1736512345678-a1b2c3d4");
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
