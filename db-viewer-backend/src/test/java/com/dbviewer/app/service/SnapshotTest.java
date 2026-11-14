package com.dbviewer.app.service;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.dto.ColumnDefinition;
import com.dbviewer.app.dto.CreateTableRequest;
import com.dbviewer.app.dto.InsertRowRequest;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Saving, comparing and restoring versions of a file, against a real SQLite workspace. */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite",
        "app.snapshots.max-per-file=3"
})
class SnapshotTest {

    @Autowired SnapshotService snapshots;
    @Autowired DatabaseService database;
    @Autowired WorkspaceOwnershipService ownership;
    @Autowired JdbcTemplate appDb;

    private String workspace;

    @BeforeEach
    void openWorkspace() {
        workspace = "snap" + UUID.randomUUID().toString().replace("-", "");
        WorkspaceContext.set(workspace);
        database.createTable(new CreateTableRequest("authors", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("name", "VARCHAR", 128, false, true, null, null))));
        database.insertRow(new InsertRowRequest("authors", Map.of("name", "Ursula")));
    }

    @AfterEach
    void closeWorkspace() {
        database.deleteWorkspace();
        WorkspaceContext.clear();
    }

    @SuppressWarnings("unchecked")
    private List<String> tableNames() {
        return ((List<TableInfo>) database.getDbInfo().get("tables")).stream().map(TableInfo::getName).toList();
    }

    private long latestId() {
        return (Long) snapshots.list().get(0).get("id");
    }

    @Test
    void aVersionCanBeRestoredAfterTheFileChanged() {
        snapshots.create("Before books");

        database.createTable(new CreateTableRequest("books", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));
        database.clearDatabase();
        database.createTable(new CreateTableRequest("books", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));
        assertThat(tableNames()).containsExactly("books");

        snapshots.restore(latestId());

        assertThat(tableNames()).containsExactly("authors");
        // The rows came back too, not just the table.
        assertThat(database.getTableRows("authors")).extracting(r -> r.get("name")).containsExactly("Ursula");
    }

    @Test
    void aVersionRecordsItsSchemaForComparing() {
        snapshots.create(null);
        Map<String, Object> schema = snapshots.schema(latestId());

        assertThat(schema.get("name")).isEqualTo("Version 1");
        assertThat((List<?>) schema.get("tables")).hasSize(1);
        assertThat(schema).containsKey("relationships");
    }

    @Test
    void aVersionThatWillNotRunLeavesTheFileAsItWas() {
        snapshots.create("Broken");
        appDb.update("UPDATE workspace_snapshots SET script = ? WHERE id = ?",
                "CREATE TABLE ok_table (id INTEGER); THIS IS NOT SQL;", latestId());

        assertThatThrownBy(() -> snapshots.restore(latestId()))
                .hasMessageContaining("left as it was");
        assertThat(tableNames()).containsExactly("authors");
        assertThat(database.getTableRows("authors")).hasSize(1);
    }

    @Test
    void theNumberOfVersionsIsCapped() {
        snapshots.create("1");
        snapshots.create("2");
        snapshots.create("3");
        assertThatThrownBy(() -> snapshots.create("4")).hasMessageContaining("already has 3");

        snapshots.delete(latestId());
        snapshots.create("4");
        assertThat(snapshots.list()).extracting(s -> s.get("name")).containsExactly("4", "2", "1");
    }

    @Test
    void anotherFilesVersionCannotBeReachedByItsId() {
        snapshots.create("Mine");
        long mine = latestId();

        String other = "snapother" + UUID.randomUUID().toString().replace("-", "");
        WorkspaceContext.set(other);
        try {
            assertThatThrownBy(() -> snapshots.restore(mine)).hasMessageContaining("no such version");
            assertThatThrownBy(() -> snapshots.schema(mine)).hasMessageContaining("no such version");
            assertThatThrownBy(() -> snapshots.delete(mine)).hasMessageContaining("no such version");
            assertThat(snapshots.list()).isEmpty();
        } finally {
            database.deleteWorkspace();
            WorkspaceContext.set(workspace);
        }
    }

    @Test
    void deletingTheFileDeletesItsVersions() {
        snapshots.create("Gone soon");
        ownership.release(workspace);

        Integer left = appDb.queryForObject(Constants.Snapshots.COUNT, Integer.class, workspace);
        assertThat(left).isZero();
    }
}
