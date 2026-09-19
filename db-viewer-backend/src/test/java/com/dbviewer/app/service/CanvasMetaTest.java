package com.dbviewer.app.service;

import com.dbviewer.app.dto.ColumnDefinition;
import com.dbviewer.app.dto.CreateTableRequest;
import com.dbviewer.app.dto.TableInfo;
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
 * Canvas annotations: the colour and tag a user puts on a table, and later the domain groups.
 *
 * <p>The interesting assertions are all about what the annotations table is <em>not</em> allowed to
 * do. It lives inside the workspace beside the user's own tables, so the thing that would actually
 * hurt is it leaking — onto the canvas, into an export, or outliving the table it describes.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class CanvasMetaTest {

    private static final String BLUE = "{\"colour\":\"brand\",\"tag\":\"Billing\"}";

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("canvasmeta" + UUID.randomUUID().toString().replace("-", ""));
        service.createTable(new CreateTableRequest("invoices", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("total", "INT", 0, false, false, null, null))));
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

    @Test
    void setThenGet_shouldReturnThePayloadVerbatim() {
        service.setCanvasMeta("table", "invoices", BLUE);

        assertThat(service.getCanvasMeta()).singleElement().satisfies(row -> {
            assertThat(row).containsEntry("kind", "table");
            assertThat(row).containsEntry("ref", "invoices");
            // Stored opaquely: the backend has no opinion on what a colour contains.
            assertThat(row).containsEntry("payload", BLUE);
        });
    }

    @Test
    void settingTwice_shouldReplaceRatherThanAccumulate() {
        service.setCanvasMeta("table", "invoices", BLUE);
        service.setCanvasMeta("table", "invoices", "{\"colour\":\"rose\"}");

        assertThat(service.getCanvasMeta()).singleElement()
                .extracting(row -> row.get("payload"))
                .isEqualTo("{\"colour\":\"rose\"}");
    }

    @Test
    void tableAndGroup_shouldCoexistUnderTheSameRef() {
        // One table, two kinds — the composite key is (kind, ref), not ref alone.
        service.setCanvasMeta("table", "invoices", BLUE);
        service.setCanvasMeta("group", "invoices", "{\"name\":\"Billing\"}");

        assertThat(service.getCanvasMeta()).hasSize(2);
    }

    @Test
    void annotations_shouldBeInvisibleToTheCanvasAndToExports() {
        service.setCanvasMeta("table", "invoices", BLUE);

        // The canvas would otherwise draw a node for the annotations table itself.
        assertThat(tables()).extracting(TableInfo::getName).containsExactly("invoices");
        // And an export would carry it into the user's real database.
        assertThat(service.exportDatabaseSql()).doesNotContain("__canvas_meta");
    }

    @Test
    void droppingATable_shouldTakeItsAnnotationWithIt() {
        service.setCanvasMeta("table", "invoices", BLUE);
        service.dropTable("invoices");

        // A colour for a table that no longer exists would come back as an orphan the moment
        // somebody created a new table with the same name.
        assertThat(service.getCanvasMeta()).isEmpty();
    }

    @Test
    void clearingTheDatabase_shouldRemoveTheAnnotationsTableToo() {
        service.setCanvasMeta("table", "invoices", BLUE);
        service.clearDatabase();

        assertThat(service.getCanvasMeta()).isEmpty();
        assertThat(tables()).isEmpty();
    }

    @Test
    void deleteCanvasMeta_shouldClearOneAnnotationAndLeaveTheRest() {
        service.setCanvasMeta("table", "invoices", BLUE);
        service.setCanvasMeta("group", "g1", "{\"name\":\"Billing\"}");

        service.deleteCanvasMeta("table", "invoices");

        assertThat(service.getCanvasMeta()).singleElement()
                .extracting(row -> row.get("kind")).isEqualTo("group");
    }

    @Test
    void deletingSomethingThatWasNeverThere_shouldNotThrow() {
        // The UI clears a colour by deleting it, without first checking whether one was set.
        service.deleteCanvasMeta("table", "invoices");
        assertThat(service.getCanvasMeta()).isEmpty();
    }

    @Test
    void badInput_shouldBeRefused() {
        assertThatThrownBy(() -> service.setCanvasMeta("nonsense", "invoices", BLUE))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Unknown annotation kind");

        // The ref reaches SQL, so it is validated like any other identifier.
        assertThatThrownBy(() -> service.setCanvasMeta("table", "inv\"; DROP TABLE invoices; --", BLUE))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> service.setCanvasMeta("table", "invoices", " "))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> service.setCanvasMeta("table", "invoices", "x".repeat(4001)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at most");
    }

    @Test
    void anUntouchedWorkspace_shouldReportNoAnnotations() {
        assertThat(service.getCanvasMeta()).isEmpty();
    }

    @Test
    void annotations_shouldNotLeakBetweenWorkspaces() {
        service.setCanvasMeta("table", "invoices", BLUE);
        String other = "canvasmeta" + UUID.randomUUID().toString().replace("-", "");

        String mine = WorkspaceContext.get();
        WorkspaceContext.set(other);
        try {
            assertThat(service.getCanvasMeta()).isEmpty();
        } finally {
            service.deleteWorkspace();
            WorkspaceContext.set(mine);
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void annotationsTable_shouldNotAppearInTableData() {
        service.setCanvasMeta("table", "invoices", BLUE);

        // getDbInfo is the canvas's view; this is belt-and-braces on the `__` filter.
        List<TableInfo> all = tables();
        assertThat(all).noneMatch(t -> t.getName().startsWith("__"));
        Map<String, Object> data = service.getTableData("invoices");
        assertThat(data).containsKey("columns");
    }
}
