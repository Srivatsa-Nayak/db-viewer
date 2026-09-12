package com.dbviewer.app.service;

import com.dbviewer.app.exception.TableInUseException;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.service.TemplateService;
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
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Deleting tables, the example schema, and the per-table to-do notes.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class TableLifecycleTest {

    @Autowired
    private DatabaseServiceImpl service;

    @Autowired
    private TemplateService templateService;

    /** The example schema is now just the Online Store template. */
    private void loadExample() {
        templateService.apply("ecommerce");
    }

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("lifecycle" + UUID.randomUUID().toString().replace("-", ""));
    }

    @AfterEach
    void closeWorkspace() {
        service.deleteWorkspace();
        WorkspaceContext.clear();
    }

    @SuppressWarnings("unchecked")
    private List<TableInfo> tables() {
        return (List<TableInfo>) service.getDbInfo().get("tables");
    }

    // ─── Example schema ───────────────────────────────────────────────────────────

    @Test
    void exampleSchema_shouldGiveAFirstTimeVisitorSomethingToLookAt() {
        loadExample();

        assertThat(tables()).hasSize(8);
        assertThat(tables()).extracting(TableInfo::getName)
                .contains("customers", "orders", "order_items", "products");

        // Relationships are what make the canvas worth looking at, so the example must have them.
        assertThat((List<?>) service.getDbInfo().get("relationships")).hasSize(8);
        assertThat(service.getTableRows("products")).isNotEmpty();
    }

    @Test
    void exampleSchema_shouldRefuseToOverwriteAnExistingFile() {
        loadExample();

        assertThatThrownBy(this::loadExample)
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("already has tables");
    }

    // ─── Dropping tables ──────────────────────────────────────────────────────────

    @Test
    void dropTable_shouldRefuseWhenAnotherTableReferencesIt() {
        loadExample();

        // orders and reviews both hold a foreign key into customers. Dropping it would leave
        // them pointing at nothing - SQLite would allow that, so the service must not.
        assertThatThrownBy(() -> service.dropTable("customers"))
                .isInstanceOf(TableInUseException.class)
                .satisfies(e -> assertThat(((TableInUseException) e).getReferencedBy())
                        .contains("orders", "reviews"));

        assertThat(tables()).extracting(TableInfo::getName).contains("customers");
    }

    @Test
    void dropTable_shouldSucceedForALeafTable() {
        loadExample();

        // Nothing references reviews, so it can go.
        assertThatCode(() -> service.dropTable("reviews")).doesNotThrowAnyException();
        assertThat(tables()).extracting(TableInfo::getName).doesNotContain("reviews");

        // And now that reviews is gone, one of the blockers on customers is too.
        assertThatThrownBy(() -> service.dropTable("customers"))
                .isInstanceOf(TableInUseException.class)
                .satisfies(e -> assertThat(((TableInUseException) e).getReferencedBy())
                        .containsExactly("orders"));
    }

    @Test
    void dropTable_shouldRejectAnUnknownOrMalformedName() {
        assertThatThrownBy(() -> service.dropTable("no_such_table"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("does not exist");

        assertThatThrownBy(() -> service.dropTable("t\"; DROP TABLE customers; --"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ─── Table notes ──────────────────────────────────────────────────────────────

    @Test
    void notes_shouldSurviveAndTrackDoneState() {
        loadExample();

        service.addTableNote("orders", "Add a shipped_on column");
        service.addTableNote("orders", "Check the status values");

        List<Map<String, Object>> notes = service.getTableNotes("orders");
        assertThat(notes).hasSize(2);

        long id = ((Number) notes.get(0).get("id")).longValue();
        service.setTableNoteDone(id, true);

        assertThat(service.getTableNotes("orders"))
                .filteredOn(n -> ((Number) n.get("done")).intValue() == 1)
                .hasSize(1);

        service.deleteTableNote(id);
        assertThat(service.getTableNotes("orders")).hasSize(1);
    }

    @Test
    void notes_shouldNotAppearAsATableOnTheCanvasOrInAnExport() {
        loadExample();
        service.addTableNote("orders", "Something to do");

        // The notes live in a table inside the workspace, which must stay invisible.
        assertThat(tables()).extracting(TableInfo::getName)
                .doesNotContain("__table_notes")
                .hasSize(8);
        assertThat(service.exportDatabaseSql()).doesNotContain("__table_notes");
    }

    @Test
    void notes_shouldBeRemovedWithTheirTable() {
        loadExample();
        service.addTableNote("reviews", "Revisit the rating range");
        assertThat(service.getTableNotes("reviews")).hasSize(1);

        service.dropTable("reviews");

        assertThat(service.getTableNotes("reviews")).isEmpty();
    }

    @Test
    void emptyNote_shouldBeRejected() {
        loadExample();
        assertThatThrownBy(() -> service.addTableNote("orders", "   "))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
