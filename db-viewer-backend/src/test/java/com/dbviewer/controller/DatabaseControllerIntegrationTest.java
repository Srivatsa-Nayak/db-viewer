package com.dbviewer.controller;

import com.dbviewer.service.impl.DatabaseServiceImpl;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * MockMvc integration tests — covers every endpoint in DatabaseController.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.datasource.url=jdbc:sqlite::memory:",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class DatabaseControllerIntegrationTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired
    DatabaseServiceImpl databaseServiceImpl;

    // ─── Health Check ─────────────────────────────────────────────────────────────

    @Test
    @Order(1)
    void healthCheck_shouldReturn200() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("Service is up and running"));
    }

    // ─── File Upload ─────────────────────────────────────────────────────────────

    @Test
    @Order(2)
    void uploadCsv_shouldReturn200AndCreateTable() throws Exception {
        String csvContent = "id,product_name,price,stock\n101,Mouse,25.99,100\n102,Keyboard,75.00,50\n";
        MockMultipartFile file = new MockMultipartFile(
                "file", "products.csv", "text/csv", csvContent.getBytes());

        mockMvc.perform(multipart("/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("CSV uploaded successfully"))
                .andExpect(jsonPath("$.tableName").value("products"))
                .andExpect(jsonPath("$.type").value("csv"));
    }

    @Test
    @Order(3)
    void uploadSql_shouldReturn200() throws Exception {
        String sqlContent = "CREATE TABLE IF NOT EXISTS orders ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT, qty INTEGER DEFAULT 0);";
        MockMultipartFile file = new MockMultipartFile(
                "file", "orders.sql", "application/sql", sqlContent.getBytes());

        mockMvc.perform(multipart("/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("sql"));
    }

    @Test
    @Order(4)
    void uploadUnsupportedFile_shouldReturn400() throws Exception {
        ClassPathResource resource = new ClassPathResource("test-files-for-upload/sample.csv");

        MockMultipartFile file = new MockMultipartFile(
                "file",
                resource.getFilename(),
                "text/csv",
                resource.getInputStream()
        );

        mockMvc.perform(multipart("/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.type").value("csv"));
    }

    @Test
    @Order(5)
    void uploadWithNoFile_shouldReturn400() throws Exception {
        mockMvc.perform(multipart("/upload"))
                .andExpect(status().isBadRequest());
    }

    // ─── Query ────────────────────────────────────────────────────────────────────

    @Test
    @Order(6)
    void query_validSelect_shouldReturnData() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("query", "SELECT * FROM products"));

        mockMvc.perform(post("/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data", hasSize(greaterThanOrEqualTo(2))));
    }

    @Test
    @Order(7)
    void query_invalidSql_shouldReturn400() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("query", "SELECT * FROM no_such_table_xyz"));

        mockMvc.perform(post("/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    // ─── DB Info ─────────────────────────────────────────────────────────────────

    @Test
    @Order(8)
    void dbInfo_shouldReturnTablesAndRelationships() throws Exception {
        mockMvc.perform(get("/db-info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tables").isArray())
                .andExpect(jsonPath("$.relationships").isArray());
    }

    // ─── Table Data ───────────────────────────────────────────────────────────────

    @Test
    @Order(9)
    void tableData_shouldReturnColumnsAndRows() throws Exception {
        mockMvc.perform(get("/table-data/products"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.columns").isArray())
                .andExpect(jsonPath("$.rows").isArray());
    }

    // ─── Create Table ─────────────────────────────────────────────────────────────

    @Test
    @Order(10)
    void createTable_shouldReturn200() throws Exception {
        String body = """
                {
                  "tableName": "categories",
                  "columns": [
                    {"name": "id",    "type": "INT",     "isPk": true},
                    {"name": "label", "type": "VARCHAR", "length": 100, "notNull": true}
                  ]
                }
                """;

        mockMvc.perform(post("/create-table")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Table created successfully"));
    }

    // ─── Alter Table ─────────────────────────────────────────────────────────────

    @Test
    @Order(11)
    void addColumn_shouldReturn200() throws Exception {
        String body = """
                {"tableName": "products", "columnName": "sku", "columnType": "VARCHAR", "length": 50}
                """;

        mockMvc.perform(post("/alter-table")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Column added successfully"));
    }

    // ─── Insert Row ───────────────────────────────────────────────────────────────

    @Test
    @Order(12)
    void insertRow_withData_shouldReturn200() throws Exception {
        String body = """
                {"tableName": "products", "data": {"product_name": "Monitor", "price": "199.99", "stock": "10"}}
                """;

        mockMvc.perform(post("/insert-row")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Row added successfully"));
    }

    @Test
    @Order(13)
    void insertRow_empty_shouldReturn200() throws Exception {
        String body = """
                {"tableName": "orders"}
                """;

        mockMvc.perform(post("/insert-row")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    // ─── Update Cell ─────────────────────────────────────────────────────────────

    @Test
    @Order(14)
    void updateCell_shouldReturn200() throws Exception {
        // Get a real ID first
        var rows = databaseServiceImpl.executeQuery("SELECT id FROM products LIMIT 1");
        String id = String.valueOf(rows.get(0).get("id"));

        String body = objectMapper.writeValueAsString(Map.of(
                "tableName", "products",
                "recordId", id,
                "columnName", "product_name",
                "newValue", "Super Mouse"
        ));

        mockMvc.perform(post("/update-cell")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Updated successfully"));
    }

    // ─── Delete Row ───────────────────────────────────────────────────────────────

    @Test
    @Order(15)
    void deleteRow_shouldReturn200() throws Exception {
        // Insert a row to delete
        databaseServiceImpl.executeQuery(
                "INSERT INTO products (product_name, price, stock) VALUES ('Temp', 0, 0)");
        var rows = databaseServiceImpl.executeQuery(
                "SELECT id FROM products WHERE product_name='Temp' LIMIT 1");
        String id = String.valueOf(rows.get(0).get("id"));

        String body = objectMapper.writeValueAsString(
                Map.of("tableName", "products", "recordId", id));

        mockMvc.perform(post("/delete-row")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Row deleted successfully"));
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────

    @Test
    @Order(16)
    void exportCsv_shouldReturnCsvFile() throws Exception {
        mockMvc.perform(get("/export/products"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", containsString("text/csv")))
                .andExpect(header().string("Content-Disposition", containsString("products.csv")))
                .andExpect(content().string(containsString("product_name")));
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    @Test
    @Order(17)
    void exportSql_shouldReturnSqlDump() throws Exception {
        mockMvc.perform(get("/export-sql").param("filename", "my_backup.sql"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("my_backup.sql")))
                .andExpect(content().string(containsString("SQL Dump")));
    }

    @Test
    @Order(18)
    void exportSql_defaultFilename_shouldAppendExtension() throws Exception {
        mockMvc.perform(get("/export-sql"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("database_export.sql")));
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    @Test
    @Order(19)
    void clearDatabase_shouldReturn200() throws Exception {
        mockMvc.perform(delete("/clear"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Database cleared successfully"));
    }
}
