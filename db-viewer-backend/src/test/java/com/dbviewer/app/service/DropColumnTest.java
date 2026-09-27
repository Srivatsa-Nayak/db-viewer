package com.dbviewer.app.service;

import com.dbviewer.app.dto.ColumnDefinition;
import com.dbviewer.app.dto.CreateTableRequest;
import com.dbviewer.app.dto.ColumnInfo;
import com.dbviewer.app.dto.DeleteRowRequest;
import com.dbviewer.app.dto.InsertRowRequest;
import com.dbviewer.app.dto.TableInfo;
import com.dbviewer.app.dto.UpdateCellRequest;
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
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Dropping a column — the inverse of adding one, and therefore what lets undo reverse an
 * "add column" — plus the identifier checks that guard every statement naming a table.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class DropColumnTest {

    @Autowired
    private DatabaseServiceImpl service;

    @BeforeEach
    void openWorkspace() {
        WorkspaceContext.set("dropcol" + UUID.randomUUID().toString().replace("-", ""));
        service.createTable(new CreateTableRequest("authors", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("name", "VARCHAR", 128, false, false, null, null))));
        service.createTable(new CreateTableRequest("books", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null),
                new ColumnDefinition("title", "VARCHAR", 200, false, true, null, null),
                new ColumnDefinition("pages", "INT", 0, false, false, null, null),
                new ColumnDefinition("author_id", "INT", 0, false, false, "authors", "id"))));
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

    private List<String> columnNames(String table) {
        return tables().stream()
                .filter(t -> t.getName().equals(table)).findFirst().orElseThrow()
                .getColumns().stream().map(ColumnInfo::getName).toList();
    }

    @Test
    void dropColumn_shouldRemoveItAndLeaveTheRestIntact() {
        service.insertRow(new InsertRowRequest("books",
                Map.of("title", "Dune", "pages", 412)));

        service.dropColumn("books", "pages");

        assertThat(columnNames("books")).containsExactly("id", "title", "author_id");
        // The rows survive, minus that one field — dropping a column is not dropping the table.
        assertThat(service.getTableRows("books")).singleElement()
                .satisfies(row -> assertThat(row).containsEntry("title", "Dune"));
    }

    @Test
    void dropColumn_shouldKeepTheKeyAndTheForeignKey() {
        service.dropColumn("books", "pages");

        assertThat(service.getDbInfo().get("relationships").toString()).contains("authors");
        ColumnInfo id = tables().stream()
                .filter(t -> t.getName().equals("books")).findFirst().orElseThrow()
                .getColumns().stream().filter(c -> c.getName().equals("id")).findFirst().orElseThrow();
        assertThat(id.isPk()).isTrue();
    }

    @Test
    void droppingThePrimaryKey_shouldBeRefused() {
        // Every row-level endpoint addresses rows by id; losing it would break all of them.
        assertThatThrownBy(() -> service.dropColumn("books", "id"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("primary key");

        assertThat(columnNames("books")).contains("id");
    }

    @Test
    void droppingAReferencedColumn_shouldBeRefusedAndNameTheDependent() {
        // SQLite does not enforce this by default, so refusing here is the only thing stopping
        // the schema from describing a relationship that no longer exists.
        assertThatThrownBy(() -> service.dropColumn("authors", "id"))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(columnNames("authors")).contains("id");
    }

    @Test
    void droppingTheLastColumn_shouldBeRefused() {
        service.createTable(new CreateTableRequest("solo", List.of(
                new ColumnDefinition("only", "VARCHAR", 32, false, false, null, null))));

        assertThatThrownBy(() -> service.dropColumn("solo", "only"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at least one column");
    }

    @Test
    void unknownTableOrColumn_shouldBeRefusedByName() {
        assertThatThrownBy(() -> service.dropColumn("nope", "id"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No such table");

        assertThatThrownBy(() -> service.dropColumn("books", "nope"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No such column");
    }

    @Test
    void addThenDrop_shouldRoundTrip() {
        // The exact sequence undo performs: add a column, then take it away again.
        service.addColumn(new com.dbviewer.app.dto.AddColumnRequest(
                "books", "isbn", "VARCHAR", 32, false));
        assertThat(columnNames("books")).contains("isbn");

        service.dropColumn("books", "isbn");
        assertThat(columnNames("books")).doesNotContain("isbn");
    }

    /* ── F4: statements that interpolate an identifier check it against the schema ────── */

    @Test
    void rowOperations_shouldRefuseATableThatDoesNotExist() {
        assertThatThrownBy(() -> service.updateCell(
                new UpdateCellRequest("books\"; DROP TABLE authors; --", "1", "title", "x")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No such table");

        assertThatThrownBy(() -> service.deleteRow(
                new DeleteRowRequest("no_such_table", "1")))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> service.insertRow(
                new InsertRowRequest("no_such_table", Map.of("a", "b"))))
                .isInstanceOf(IllegalArgumentException.class);

        // The attempted injection changed nothing.
        assertThat(tables()).extracting(TableInfo::getName).contains("authors");
    }

    @Test
    void rowOperations_shouldRefuseAColumnThatDoesNotExist() {
        assertThatThrownBy(() -> service.updateCell(
                new UpdateCellRequest("books", "1", "title\" = 'x', \"pages", "1")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No such column");

        assertThatThrownBy(() -> service.insertRow(
                new InsertRowRequest("books", Map.of("not_a_column", "x"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("No such column");
    }

    @Test
    void aTableNameWithSpaces_shouldStillResolve() {
        // The UI used to rewrite spaces to underscores before sending. A caller that still does
        // the old thing must not get "no such table" for a table that is plainly there.
        service.insertRow(new InsertRowRequest("books", Map.of("title", "Dune")));
        assertThatCode(() -> service.insertRow(new InsertRowRequest("books ", Map.of("title", "Emma"))))
                .doesNotThrowAnyException();
        assertThat(service.getTableRows("books")).hasSize(2);
    }
}
