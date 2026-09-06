package com.dbviewer.service;

import com.dbviewer.dto.ColumnDefinition;
import com.dbviewer.dto.ColumnInfo;
import com.dbviewer.dto.CreateTableRequest;
import com.dbviewer.dto.InsertRowRequest;
import com.dbviewer.dto.UpdateColumnRequest;
import com.dbviewer.service.impl.DatabaseServiceImpl;
import com.dbviewer.workspace.WorkspaceContext;
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
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Covers editing an existing column. On SQLite a type or nullability change cannot be done
 * in place, so the table is rebuilt - these tests pin down that the rebuild preserves the
 * primary key, auto-increment, foreign keys, other columns' constraints, and the data.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class ColumnEditTest {

    @Autowired
    private DatabaseServiceImpl service;

    private String workspace;

    @BeforeEach
    void openWorkspace() {
        // A fresh workspace per test keeps the in-memory databases independent.
        workspace = "coledit" + UUID.randomUUID().toString().replace("-", "");
        WorkspaceContext.set(workspace);

        service.createTable(new CreateTableRequest("authors", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("name", "VARCHAR", 128, false, false, null, null))));

        service.createTable(new CreateTableRequest("books", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("title", "VARCHAR", 128, false, true, null, null),
                new ColumnDefinition("pages", "VARCHAR", 64, false, false, null, null),
                new ColumnDefinition("author_id", "INT", 0, false, false, "authors", "id"))));

        service.insertRow(new InsertRowRequest("authors", Map.of("name", "Ursula")));
        service.insertRow(new InsertRowRequest("books",
                Map.of("title", "Earthsea", "pages", "250", "author_id", "1")));
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    private ColumnInfo column(String table, String name) {
        @SuppressWarnings("unchecked")
        List<ColumnInfo> columns = (List<ColumnInfo>) service.getTableData(table).get("columns");
        return columns.stream()
                .filter(c -> c.getName().equals(name))
                .findFirst()
                .orElse(null);
    }

    private String ddl(String table) {
        return String.valueOf(service.executeQuery(
                "SELECT sql FROM sqlite_master WHERE name='" + table + "'").get(0).get("sql"));
    }

    // ─── Rename ───────────────────────────────────────────────────────────────────

    @Test
    void renameColumn_shouldKeepTypeAndData() {
        service.updateColumn(new UpdateColumnRequest("books", "pages", "page_count", null, 0, null));

        assertThat(column("books", "pages")).isNull();
        assertThat(column("books", "page_count")).isNotNull();
        assertThat(column("books", "page_count").getType()).isEqualTo("VARCHAR(64)");
        assertThat(service.getTableRows("books").get(0)).containsEntry("page_count", "250");
    }

    @Test
    void renameColumn_toAnExistingName_shouldThrow() {
        assertThatThrownBy(() -> service.updateColumn(
                new UpdateColumnRequest("books", "pages", "title", null, 0, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("already exists");
    }

    @Test
    void updateColumn_onMissingColumn_shouldThrow() {
        assertThatThrownBy(() -> service.updateColumn(
                new UpdateColumnRequest("books", "nope", "x", null, 0, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not exist");
    }

    @Test
    void updateColumn_withInjectionInName_shouldThrow() {
        assertThatThrownBy(() -> service.updateColumn(new UpdateColumnRequest(
                "books", "pages", "x\"); DROP TABLE books; --", null, 0, null)))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(service.getTableRows("books")).hasSize(1);
    }

    // ─── Type change (SQLite table rebuild) ───────────────────────────────────────

    @Test
    void changeColumnType_shouldPreserveKeysConstraintsAndData() {
        service.updateColumn(new UpdateColumnRequest("books", "pages", null, "INT", 0, null));

        assertThat(column("books", "pages").getType()).isEqualTo("INTEGER");
        // 250 was stored as text under VARCHAR; INTEGER affinity converts it.
        assertThat(service.getTableRows("books").get(0)).containsEntry("pages", 250);

        String schema = ddl("books");
        assertThat(schema).contains("PRIMARY KEY AUTOINCREMENT");
        assertThat(schema).contains("FOREIGN KEY");
        assertThat(schema).contains("\"authors\"");
        assertThat(column("books", "title").isNotNull()).isTrue();
        assertThat(column("books", "id").isPk()).isTrue();
    }

    @Test
    void changeColumnTypeAndRename_together_shouldApplyBoth() {
        service.updateColumn(new UpdateColumnRequest("books", "pages", "page_count", "INT", 0, null));

        assertThat(column("books", "pages")).isNull();
        assertThat(column("books", "page_count").getType()).isEqualTo("INTEGER");
        assertThat(ddl("books")).contains("PRIMARY KEY AUTOINCREMENT");
    }

    // ─── Nullability ──────────────────────────────────────────────────────────────

    @Test
    void makeColumnRequired_shouldBackfillExistingNulls() {
        service.executeQuery("INSERT INTO \"books\" (\"title\") VALUES ('No pages')");
        assertThat(service.getTableRows("books")).hasSize(2);

        service.updateColumn(new UpdateColumnRequest("books", "pages", null, null, 0, true));

        assertThat(column("books", "pages").isNotNull()).isTrue();
        // The previously-null row must survive the rebuild, backfilled with the type default.
        assertThat(service.getTableRows("books")).hasSize(2);
        assertThat(service.getTableRows("books").get(1)).containsEntry("pages", "");
    }

    @Test
    void makeColumnOptional_shouldDropNotNull() {
        assertThat(column("books", "title").isNotNull()).isTrue();

        service.updateColumn(new UpdateColumnRequest("books", "title", null, null, 0, false));

        assertThat(column("books", "title").isNotNull()).isFalse();
        assertThat(service.getTableRows("books")).hasSize(1);
    }

    // ─── Primary key protection ───────────────────────────────────────────────────

    @Test
    void changingPrimaryKeyType_shouldThrow() {
        assertThatThrownBy(() -> service.updateColumn(
                new UpdateColumnRequest("books", "id", null, "VARCHAR", 128, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("primary key");
    }

    @Test
    void renamingPrimaryKey_shouldBeAllowed() {
        assertThatCode(() -> service.updateColumn(
                new UpdateColumnRequest("authors", "id", "author_id", null, 0, null)))
                .doesNotThrowAnyException();

        assertThat(column("authors", "author_id").isPk()).isTrue();
    }

    // ─── Connection state ─────────────────────────────────────────────────────────

    @Test
    void rebuild_shouldNotLeaveForeignKeyEnforcementFlipped() {
        // A workspace holds one long-lived connection. The rebuild has to turn foreign keys
        // off, and restoring them to ON rather than to their previous value made later inserts
        // fail against columns whose DEFAULT 0 does not match a parent row.
        Object before = service.executeQuery("PRAGMA foreign_keys").get(0).get("foreign_keys");

        service.updateColumn(new UpdateColumnRequest("books", "pages", null, "INT", 0, null));

        Object after = service.executeQuery("PRAGMA foreign_keys").get(0).get("foreign_keys");
        assertThat(after).isEqualTo(before);

        // And the insert that the flipped pragma used to reject still works.
        assertThatCode(() -> service.insertRow(new InsertRowRequest("books", Map.of("title", "Later"))))
                .doesNotThrowAnyException();
    }

    @Test
    void noChangeRequested_shouldBeANoOp() {
        String before = ddl("books");
        service.updateColumn(new UpdateColumnRequest("books", "pages", null, null, 0, null));
        assertThat(ddl("books")).isEqualTo(before);
    }
}
