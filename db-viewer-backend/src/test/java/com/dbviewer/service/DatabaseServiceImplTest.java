package com.dbviewer.service;

import com.dbviewer.dto.*;
import com.dbviewer.service.impl.DatabaseServiceImpl;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;

/**
 * Integration tests for DatabaseService using an in-memory SQLite database.
 */
@SpringBootTest
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class DatabaseServiceImplTest {

    @Autowired
    private DatabaseServiceImpl databaseServiceImpl;

    // ─── CSV Upload ───────────────────────────────────────────────────────────────

    @Test
    @Order(1)
    void uploadCsv_shouldCreateTableAndInsertRows() throws Exception {
        String csv = "id,name,price\n1,Apple,1.99\n2,Banana,0.99\n";
        MockMultipartFile file = new MockMultipartFile(
                "file", "products.csv", "text/csv",
                csv.getBytes(StandardCharsets.UTF_8));

        Map<String, Object> result = databaseServiceImpl.handleFileUpload(file);

        assertThat(result.get("message")).isEqualTo("CSV uploaded successfully");
        assertThat(result.get("tableName")).isEqualTo("products");
        assertThat(result.get("type")).isEqualTo("csv");
    }

    @Test
    @Order(2)
    void uploadCsv_withUnsupportedType_shouldThrow() {
        MockMultipartFile file = new MockMultipartFile(
                "file", "data.txt", "text/plain",
                "hello".getBytes());

        assertThatThrownBy(() -> databaseServiceImpl.handleFileUpload(file))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Only .csv and .sql files are supported");
    }

    // ─── SQL Upload ───────────────────────────────────────────────────────────────

    @Test
    @Order(3)
    void uploadSql_shouldExecuteStatements() throws Exception {
        String sql = "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, item TEXT, amount DECIMAL);\n"
                + "INSERT INTO orders (item, amount) VALUES ('Laptop', 999.99);\n";
        MockMultipartFile file = new MockMultipartFile(
                "file", "schema.sql", "application/sql",
                sql.getBytes(StandardCharsets.UTF_8));

        Map<String, Object> result = databaseServiceImpl.handleFileUpload(file);

        assertThat(result.get("type")).isEqualTo("sql");
        assertThat(result.get("message")).isEqualTo("SQL executed successfully");
    }

    // ─── Query Execution ──────────────────────────────────────────────────────────

    @Test
    @Order(4)
    void executeQuery_shouldReturnRows() {
        List<Map<String, Object>> rows = databaseServiceImpl.executeQuery("SELECT * FROM products");
        assertThat(rows).isNotEmpty();
        assertThat(rows.get(0)).containsKey("name");
    }

    @Test
    @Order(5)
    void executeQuery_withInvalidSql_shouldThrow() {
        assertThatThrownBy(() -> databaseServiceImpl.executeQuery("SELECT * FROM nonexistent_table_xyz"))
                .isInstanceOf(Exception.class);
    }

    // ─── DB Info ─────────────────────────────────────────────────────────────────

    @Test
    @Order(6)
    void getDbInfo_shouldReturnTablesAndRelationships() {
        Map<String, Object> info = databaseServiceImpl.getDbInfo();

        assertThat(info).containsKeys("tables", "relationships");
        @SuppressWarnings("unchecked")
        List<TableInfo> tables = (List<TableInfo>) info.get("tables");
        assertThat(tables).isNotEmpty();

        // products table from step 1 should be present
        boolean hasProducts = tables.stream().anyMatch(t -> "products".equals(t.getName()));
        assertThat(hasProducts).isTrue();
    }

    // ─── Table Data ───────────────────────────────────────────────────────────────

    @Test
    @Order(7)
    void getTableData_shouldReturnColumnsAndRows() {
        Map<String, Object> data = databaseServiceImpl.getTableData("products");

        assertThat(data).containsKeys("columns", "rows");
        @SuppressWarnings("unchecked")
        List<ColumnInfo> columns = (List<ColumnInfo>) data.get("columns");
        assertThat(columns).isNotEmpty();
        assertThat(columns.stream().anyMatch(c -> "name".equals(c.getName()))).isTrue();
    }

    // ─── Add Column ───────────────────────────────────────────────────────────────

    @Test
    @Order(8)
    void addColumn_shouldSucceed() {
        AddColumnRequest req = new AddColumnRequest("products", "category", "VARCHAR", 100, false);
        assertThatCode(() -> databaseServiceImpl.addColumn(req)).doesNotThrowAnyException();

        // Verify column was actually added
        Map<String, Object> data = databaseServiceImpl.getTableData("products");
        @SuppressWarnings("unchecked")
        List<ColumnInfo> cols = (List<ColumnInfo>) data.get("columns");
        assertThat(cols.stream().anyMatch(c -> "category".equals(c.getName()))).isTrue();
    }

    // ─── Insert Row ───────────────────────────────────────────────────────────────

    @Test
    @Order(9)
    void insertRow_withData_shouldSucceed() {
        InsertRowRequest req = new InsertRowRequest("products",
                Map.of("name", "Cherry", "price", "2.49"));
        Map<String, Object> result = databaseServiceImpl.insertRow(req);
        assertThat(result.get("message")).isEqualTo("Row added successfully");
    }

    @Test
    @Order(10)
    void insertRow_empty_shouldCreateDefaultRow() {
        InsertRowRequest req = new InsertRowRequest("products", Map.of());
        assertThatCode(() -> databaseServiceImpl.insertRow(req)).doesNotThrowAnyException();
    }

    // ─── Update Cell ─────────────────────────────────────────────────────────────

    @Test
    @Order(11)
    void updateCell_shouldModifyValue() {
        // Get a real id from the products table
        List<Map<String, Object>> rows = databaseServiceImpl.executeQuery("SELECT id FROM products LIMIT 1");
        assertThat(rows).isNotEmpty();
        String id = String.valueOf(rows.get(0).get("id"));

        UpdateCellRequest req = new UpdateCellRequest("products", id, "name", "UpdatedFruit");
        assertThatCode(() -> databaseServiceImpl.updateCell(req)).doesNotThrowAnyException();

        // Verify update
        List<Map<String, Object>> updated = databaseServiceImpl.executeQuery(
                "SELECT name FROM products WHERE id = " + id);
        assertThat(updated.get(0).get("name")).isEqualTo("UpdatedFruit");
    }

    // ─── Delete Row ───────────────────────────────────────────────────────────────

    @Test
    @Order(12)
    void deleteRow_shouldRemoveRow() {
        // Insert a row to delete
        databaseServiceImpl.insertRow(new InsertRowRequest("products", Map.of("name", "ToDelete")));
        List<Map<String, Object>> before = databaseServiceImpl.executeQuery(
                "SELECT id FROM products WHERE name = 'ToDelete'");
        assertThat(before).isNotEmpty();
        String id = String.valueOf(before.get(0).get("id"));

        DeleteRowRequest req = new DeleteRowRequest("products", id);
        assertThatCode(() -> databaseServiceImpl.deleteRow(req)).doesNotThrowAnyException();

        List<Map<String, Object>> after = databaseServiceImpl.executeQuery(
                "SELECT id FROM products WHERE name = 'ToDelete'");
        assertThat(after).isEmpty();
    }

    // ─── Create Table ─────────────────────────────────────────────────────────────

    @Test
    @Order(13)
    void createTable_shouldSucceed() {
        ColumnDefinition pk = new ColumnDefinition("id", "INT", 0, true, false, null, null);
        ColumnDefinition name = new ColumnDefinition("title", "VARCHAR", 200, false, true, null, null);
        CreateTableRequest req = new CreateTableRequest("test_table", List.of(pk, name));

        assertThatCode(() -> databaseServiceImpl.createTable(req)).doesNotThrowAnyException();

        // Verify table exists
        Map<String, Object> data = databaseServiceImpl.getTableData("test_table");
        assertThat(data).containsKey("columns");
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────

    @Test
    @Order(14)
    void getTableRows_shouldReturnAllRows() {
        List<Map<String, Object>> rows = databaseServiceImpl.getTableRows("products");
        assertThat(rows).isNotEmpty();
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    @Test
    @Order(15)
    void exportDatabaseSql_shouldContainCreateAndInsert() {
        String dump = databaseServiceImpl.exportDatabaseSql();
        assertThat(dump).contains("-- SQL Dump generated by SQL Visualizer");
        assertThat(dump).containsIgnoringCase("CREATE TABLE");
        assertThat(dump).containsIgnoringCase("INSERT INTO");
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    @Test
    @Order(16)
    void clearDatabase_shouldDropAllTables() {
        assertThatCode(() -> databaseServiceImpl.clearDatabase()).doesNotThrowAnyException();
        Map<String, Object> info = databaseServiceImpl.getDbInfo();
        @SuppressWarnings("unchecked")
        List<?> tables = (List<?>) info.get("tables");
        assertThat(tables).isEmpty();
    }
}
