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
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * End-to-end coverage of the REST surface: routing, request binding, status codes, and the
 * effect each call has on the database.
 *
 * <p>This is the only layer that tests the ordinary CRUD endpoints. An earlier service-level
 * suite asserted the same operations one layer down, which meant every change had to be
 * mirrored in two places while catching nothing extra — going through MockMvc exercises the
 * same service code plus the wiring around it.
 *
 * <p>Each test asserts what actually changed rather than just a 200, because a handler that
 * returns success without doing anything is the failure worth catching.
 *
 * <p>Tests share one in-memory database and run in declared order: the CSV upload seeds the
 * `products` table the later tests operate on.
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
    @Autowired DatabaseServiceImpl databaseServiceImpl;

    private static String bearerToken;

    /**
     * Signs up once and reuses the token. Exporting is the one thing that needs an account,
     * so the export tests have to authenticate.
     */
    private String token() throws Exception {
        if (bearerToken == null) {
            String body = objectMapper.writeValueAsString(Map.of(
                    "email", "exporter@example.com", "password", "A-good-password"));
            String response = mockMvc.perform(post("/auth/signup")
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            bearerToken = "Bearer " + objectMapper.readTree(response).get("token").asText();
        }
        return bearerToken;
    }

    // ─── Health ───────────────────────────────────────────────────────────────────

    @Test
    @Order(1)
    void healthCheck_shouldReportStatusAndVersion() throws Exception {
        mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("Service is up and running"))
                // The UI shows this in its info modal, so an empty value is a real regression.
                .andExpect(jsonPath("$.version").isNotEmpty());
    }

    // ─── Upload ───────────────────────────────────────────────────────────────────

    @Test
    @Order(2)
    void uploadCsv_shouldCreateTheTableAndItsRows() throws Exception {
        String csv = "id,product_name,price,stock\n101,Mouse,25.99,100\n102,Keyboard,75.00,50\n";
        MockMultipartFile file = new MockMultipartFile(
                "file", "products.csv", "text/csv", csv.getBytes());

        mockMvc.perform(multipart("/upload").file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tableName").value("products"))
                .andExpect(jsonPath("$.type").value("csv"));

        mockMvc.perform(get("/table-data/products"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.columns[*].name",
                        containsInAnyOrder("id", "product_name", "price", "stock")))
                .andExpect(jsonPath("$.rows", hasSize(2)));
    }

    @Test
    @Order(3)
    void upload_withUnsupportedFileType_shouldReturn400() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "notes.txt", "text/plain", "hello".getBytes());

        mockMvc.perform(multipart("/upload").file(file))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error", containsString("Only .csv and .sql")));
    }

    @Test
    @Order(4)
    void upload_withNoFile_shouldReturn400() throws Exception {
        mockMvc.perform(multipart("/upload"))
                .andExpect(status().isBadRequest());
    }

    // ─── Query ────────────────────────────────────────────────────────────────────

    @Test
    @Order(5)
    void query_validSelect_shouldReturnRows() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of("query", "SELECT * FROM products"));

        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data", hasSize(2)));
    }

    @Test
    @Order(6)
    void query_invalidSql_shouldReturn400WithAnError() throws Exception {
        String body = objectMapper.writeValueAsString(
                Map.of("query", "SELECT * FROM no_such_table_xyz"));

        mockMvc.perform(post("/query").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    // ─── Schema changes ───────────────────────────────────────────────────────────

    @Test
    @Order(7)
    void createTable_shouldApplyPrimaryKeyAndNotNull() throws Exception {
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
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        // The "isPk" flag used to be dropped during JSON binding, so tables were created
        // without a primary key and without auto-increment. Assert the DDL, not the status.
        String pkQuery = objectMapper.writeValueAsString(Map.of(
                "query", "SELECT sql FROM sqlite_master WHERE type='table' AND name='categories'"));

        mockMvc.perform(post("/query")
                        .contentType(MediaType.APPLICATION_JSON).content(pkQuery))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].sql", containsString("PRIMARY KEY")))
                .andExpect(jsonPath("$.data[0].sql", containsString("NOT NULL")));
    }

    @Test
    @Order(8)
    void addColumn_shouldAppearInTheSchema() throws Exception {
        String body = """
                {"tableName": "products", "columnName": "sku", "columnType": "VARCHAR", "length": 50}
                """;

        mockMvc.perform(post("/alter-table")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        mockMvc.perform(get("/table-data/products"))
                .andExpect(jsonPath("$.columns[*].name", hasItem("sku")));
    }

    @Test
    @Order(9)
    void updateColumn_shouldRenameIt() throws Exception {
        String body = """
                {"tableName": "products", "columnName": "sku", "newColumnName": "sku_code"}
                """;

        mockMvc.perform(post("/update-column")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        mockMvc.perform(get("/table-data/products"))
                .andExpect(jsonPath("$.columns[*].name", hasItem("sku_code")))
                .andExpect(jsonPath("$.columns[*].name", not(hasItem("sku"))));
    }

    // ─── Rows ─────────────────────────────────────────────────────────────────────

    @Test
    @Order(10)
    void insertRow_withValues_shouldStoreThem() throws Exception {
        String body = """
                {"tableName": "products", "data": {"product_name": "Monitor", "price": "199.99", "stock": "10"}}
                """;

        mockMvc.perform(post("/insert-row")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        mockMvc.perform(get("/table-data/products"))
                .andExpect(jsonPath("$.rows", hasSize(3)))
                .andExpect(jsonPath("$.rows[*].product_name", hasItem("Monitor")));
    }

    @Test
    @Order(11)
    void insertRow_withNoData_shouldUseDatabaseDefaults() throws Exception {
        // A distinct SQL path: "INSERT INTO t DEFAULT VALUES" rather than a parameterised insert.
        mockMvc.perform(post("/insert-row")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tableName": "products"}
                                """))
                .andExpect(status().isOk());

        mockMvc.perform(get("/table-data/products"))
                .andExpect(jsonPath("$.rows", hasSize(4)));
    }

    @Test
    @Order(12)
    void updateCell_shouldChangeTheStoredValue() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
                "tableName", "products",
                "recordId", "101",
                "columnName", "product_name",
                "newValue", "Super Mouse"));

        mockMvc.perform(post("/update-cell")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        mockMvc.perform(get("/table-data/products"))
                .andExpect(jsonPath("$.rows[?(@.id == 101)].product_name", hasItem("Super Mouse")));
    }

    @Test
    @Order(13)
    void deleteRow_shouldRemoveIt() throws Exception {
        String body = objectMapper.writeValueAsString(
                Map.of("tableName", "products", "recordId", "102"));

        mockMvc.perform(post("/delete-row")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        mockMvc.perform(get("/table-data/products"))
                .andExpect(jsonPath("$.rows", hasSize(3)))
                .andExpect(jsonPath("$.rows[*].id", not(hasItem(102))));
    }

    // ─── Workspace scoping ────────────────────────────────────────────────────────

    @Test
    @Order(14)
    void workspaceTables_shouldNotLeakIntoTheDefaultDatabase() throws Exception {
        String body = """
                {"tableName": "ctrl_scoped", "columns": [{"name": "id", "type": "INT", "isPk": true}]}
                """;

        mockMvc.perform(post("/create-table")
                        .header("X-Workspace-Id", "ctrltestws")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());

        mockMvc.perform(get("/db-info").header("X-Workspace-Id", "ctrltestws"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tables[*].name", hasItem("ctrl_scoped")));

        // The same call without the header hits the default database, which never saw it.
        mockMvc.perform(get("/db-info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tables[*].name", not(hasItem("ctrl_scoped"))));
    }

    @Test
    @Order(15)
    void request_withMalformedWorkspaceId_shouldReturn400() throws Exception {
        // The id becomes a filename and a SQL identifier, so it is rejected at the filter
        // before any handler runs.
        mockMvc.perform(get("/db-info").header("X-Workspace-Id", "../../etc/passwd"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    // ─── Exports ──────────────────────────────────────────────────────────────────

    @Test
    @Order(16)
    void export_withoutAnAccount_shouldReturn401() throws Exception {
        // Gating is enforced here, not only in the UI, so it cannot be bypassed by calling
        // the API directly.
        mockMvc.perform(get("/export/products")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/export-sql")).andExpect(status().isUnauthorized());
    }

    @Test
    @Order(17)
    void exportCsv_shouldStreamTheTableAsCsv() throws Exception {
        mockMvc.perform(get("/export/products").header("Authorization", token()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", containsString("text/csv")))
                .andExpect(header().string("Content-Disposition", containsString("products.csv")))
                .andExpect(content().string(containsString("product_name")));
    }

    @Test
    @Order(18)
    void exportSql_shouldStreamADumpWithSchemaAndData() throws Exception {
        mockMvc.perform(get("/export-sql").param("filename", "my_backup.sql")
                        .header("Authorization", token()))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("my_backup.sql")))
                .andExpect(content().string(containsString("CREATE TABLE")))
                .andExpect(content().string(containsString("INSERT INTO")));
    }

    // ─── Clear ────────────────────────────────────────────────────────────────────

    @Test
    @Order(19)
    void clearDatabase_shouldDropEveryTable() throws Exception {
        mockMvc.perform(delete("/clear"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/db-info"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tables", hasSize(0)));
    }
}
