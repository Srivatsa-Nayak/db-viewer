package com.dbviewer.controller;

import com.dbviewer.dto.*;
import com.dbviewer.service.impl.DatabaseServiceImpl;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.PrintWriter;
import java.util.List;
import java.util.Map;

/**
 * REST Controller - mirrors all routes defined in Go main.go
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@Tag(name = "Database Visualizer API")
public class DatabaseController {

    private final DatabaseServiceImpl databaseServiceImpl;

    /** Maven's project version, filtered into application.properties at build time. */
    @Value("${app.version:unknown}")
    private String appVersion;

    // ─── Health Check ─────────────────────────────────────────────────────────────

    @GetMapping("/")
    @Operation(summary = "Health Check", description = "Returns service status and version")
    public ResponseEntity<Map<String, String>> healthCheck() {
        return ResponseEntity.ok(Map.of(
                "status", "Service is up and running",
                "version", appVersion));
    }

    // ─── Version ──────────────────────────────────────────────────────────────────

    @GetMapping("/version")
    @Operation(summary = "Application Version",
            description = "Returns the version declared in pom.xml. Displayed in the UI's info modal.")
    public ResponseEntity<Map<String, String>> version() {
        return ResponseEntity.ok(Map.of("version", appVersion));
    }

    // ─── File Upload ─────────────────────────────────────────────────────────────

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Upload CSV or SQL File",
            description = "Uploads a CSV or SQL file and creates/executes in SQLite",
            tags = {"DataFileUpload"})
    public ResponseEntity<?> uploadFile(@RequestParam("file") MultipartFile file) {
        try {
            Map<String, Object> result = databaseServiceImpl.handleFileUpload(file);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("File upload error", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Query Execution ──────────────────────────────────────────────────────────

    @PostMapping("/query")
    @Operation(summary = "Run SQL Query",
            description = "Executes a raw SQL query against the database",
            tags = {"QueryExecuter"})
    public ResponseEntity<?> runQuery(@RequestBody QueryRequest request) {
        try {
            List<Map<String, Object>> data = databaseServiceImpl.executeQuery(request.getQuery());
            return ResponseEntity.ok(Map.of("data", data));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── DB Info ─────────────────────────────────────────────────────────────────

    @GetMapping("/db-info")
    @Operation(summary = "Get Database Info",
            description = "Returns all table schemas, rows, and relationships")
    public ResponseEntity<?> getDbInfo() {
        try {
            return ResponseEntity.ok(databaseServiceImpl.getDbInfo());
        } catch (Exception e) {
            log.error("DB info error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Table Data ───────────────────────────────────────────────────────────────

    @GetMapping("/table-data/{tableName}")
    @Operation(summary = "Get Table Data", description = "Returns columns and rows for a specific table")
    public ResponseEntity<?> getTableData(@PathVariable String tableName) {
        try {
            return ResponseEntity.ok(databaseServiceImpl.getTableData(tableName));
        } catch (Exception e) {
            log.error("Table data error for {}", tableName, e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Alter Table (Add Column) ─────────────────────────────────────────────────

    @PostMapping("/alter-table")
    @Operation(summary = "Add Column", description = "Adds a new column to an existing table")
    public ResponseEntity<?> addColumn(@RequestBody AddColumnRequest request) {
        try {
            databaseServiceImpl.addColumn(request);
            return ResponseEntity.ok(Map.of("message", "Column added successfully"));
        } catch (Exception e) {
            log.error("Add column error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Failed to add column: " + e.getMessage()));
        }
    }

    // ─── Update Column ────────────────────────────────────────────────────────────

    @PostMapping("/update-column")
    @Operation(summary = "Edit Column",
            description = "Renames an existing column and/or changes its type or nullability. "
                    + "Omit a field to leave it unchanged.")
    public ResponseEntity<?> updateColumn(@RequestBody UpdateColumnRequest request) {
        try {
            databaseServiceImpl.updateColumn(request);
            return ResponseEntity.ok(Map.of("message", "Column updated successfully"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Update column error", e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Failed to update column: " + e.getMessage()));
        }
    }

    // ─── Update Cell ─────────────────────────────────────────────────────────────

    @PostMapping("/update-cell")
    @Operation(summary = "Update Cell", description = "Updates a cell value for a specific row/column")
    public ResponseEntity<?> updateCell(@RequestBody UpdateCellRequest request) {
        try {
            databaseServiceImpl.updateCell(request);
            return ResponseEntity.ok(Map.of("message", "Updated successfully"));
        } catch (Exception e) {
            log.error("Update cell error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Insert Row ───────────────────────────────────────────────────────────────

    @PostMapping("/insert-row")
    @Operation(summary = "Insert Row", description = "Inserts a new row (empty or with data)")
    public ResponseEntity<?> insertRow(@RequestBody InsertRowRequest request) {
        try {
            Map<String, Object> result = databaseServiceImpl.insertRow(request);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            log.error("Insert row error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Insert failed: " + e.getMessage()));
        }
    }

    // ─── Delete Row ───────────────────────────────────────────────────────────────

    @PostMapping("/delete-row")
    @Operation(summary = "Delete Row", description = "Deletes a row by its ID")
    public ResponseEntity<?> deleteRow(@RequestBody DeleteRowRequest request) {
        try {
            databaseServiceImpl.deleteRow(request);
            return ResponseEntity.ok(Map.of("message", "Row deleted successfully"));
        } catch (Exception e) {
            log.error("Delete row error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Create Table ─────────────────────────────────────────────────────────────

    @PostMapping("/create-table")
    @Operation(summary = "Create Table", description = "Creates a new table with the specified columns and constraints")
    public ResponseEntity<?> createTable(@RequestBody CreateTableRequest request) {
        try {
            databaseServiceImpl.createTable(request);
            return ResponseEntity.ok(Map.of("message", "Table created successfully"));
        } catch (Exception e) {
            log.error("Create table error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", "Failed to create table: " + e.getMessage()));
        }
    }

    // ─── Clear Database ───────────────────────────────────────────────────────────

    @DeleteMapping("/clear")
    @Operation(summary = "Clear Database", description = "Drops all user tables from the database")
    public ResponseEntity<?> clearDatabase() {
        try {
            databaseServiceImpl.clearDatabase();
            return ResponseEntity.ok(Map.of("message", "Database cleared successfully"));
        } catch (Exception e) {
            log.error("Clear DB error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── List Workspaces ──────────────────────────────────────────────────────────

    @GetMapping("/workspaces")
    @Operation(summary = "List Workspaces",
            description = "Ids of every workspace that still has a database. The UI uses this to "
                    + "restore the files that were open before a browser refresh.")
    public ResponseEntity<?> listWorkspaces() {
        try {
            return ResponseEntity.ok(Map.of("workspaces", databaseServiceImpl.listWorkspaces()));
        } catch (Exception e) {
            log.error("List workspaces error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Delete Workspace ─────────────────────────────────────────────────────────

    @DeleteMapping("/workspace")
    @Operation(summary = "Delete Workspace",
            description = "Deletes the database backing the workspace named by the X-Workspace-Id "
                    + "header. Without that header this clears the default database instead.")
    public ResponseEntity<?> deleteWorkspace() {
        try {
            databaseServiceImpl.deleteWorkspace();
            return ResponseEntity.ok(Map.of("message", "Workspace deleted successfully"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Delete workspace error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Export CSV ───────────────────────────────────────────────────────────────

    @GetMapping("/export/{tableName}")
    @Operation(summary = "Export Table as CSV", description = "Downloads the specified table as a CSV file")
    public void exportCsv(@PathVariable String tableName, HttpServletResponse response) {
        try {
            response.setContentType("text/csv");
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=" + tableName + ".csv");

            List<Map<String, Object>> rows = databaseServiceImpl.getTableRows(tableName);
            PrintWriter writer = response.getWriter();

            if (!rows.isEmpty()) {
                // Write headers
                List<String> headers = new java.util.ArrayList<>(rows.get(0).keySet());
                writer.println(String.join(",", headers));

                // Write rows
                for (Map<String, Object> row : rows) {
                    List<String> values = headers.stream()
                            .map(h -> {
                                Object v = row.get(h);
                                if (v == null) return "";
                                String s = v.toString();
                                // Escape commas and quotes
                                if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
                                    s = "\"" + s.replace("\"", "\"\"") + "\"";
                                }
                                return s;
                            }).toList();
                    writer.println(String.join(",", values));
                }
            }
            writer.flush();
        } catch (Exception e) {
            log.error("Export CSV error for {}", tableName, e);
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        }
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    @GetMapping("/export-sql")
    @Operation(summary = "Export Database as SQL", description = "Downloads a full SQL dump of the database")
    public ResponseEntity<String> exportSql(
            @RequestParam(value = "filename", defaultValue = "database_export.sql") String filename) {
        try {
            if (!filename.toLowerCase().endsWith(".sql")) {
                filename += ".sql";
            }
            String dump = databaseServiceImpl.exportDatabaseSql();
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                    .contentType(MediaType.parseMediaType("application/sql"))
                    .body(dump);
        } catch (Exception e) {
            log.error("Export SQL error", e);
            return ResponseEntity.internalServerError().build();
        }
    }
}
