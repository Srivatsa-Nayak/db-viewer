package com.dbviewer.app.controller;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.exception.UnauthorizedException;
import com.dbviewer.app.dto.*;
import com.dbviewer.app.exception.TableInUseException;
import com.dbviewer.app.service.DatabaseService;
import com.dbviewer.app.service.ShareService;
import com.dbviewer.app.service.TemplateService;
import com.dbviewer.app.sql.SqlDialect;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
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

    private final DatabaseService databaseService;
    private final ShareService shareService;
    private final TemplateService templateService;

    /** The template behind the canvas's "Show me an example" button. */
    private static final String DEFAULT_TEMPLATE = "ecommerce";

    private static final ObjectMapper JSON = new ObjectMapper();

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

    @PostMapping(value = "/import/analyze", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Preview An Import",
            description = "Reports the tables, columns and inferred types a file would produce, "
                    + "along with the SQL dialect it appears to be written for and everything "
                    + "that would be skipped. Creates nothing - the workspace is untouched.",
            tags = {"DataFileUpload"})
    public ResponseEntity<?> analyzeImport(@RequestParam("file") MultipartFile file) {
        try {
            return ResponseEntity.ok(databaseService.analyzeUpload(file));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Import analysis error", e);
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "That file could not be read: " + e.getMessage()));
        }
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Upload CSV or SQL File",
            description = "Creates the tables described by a CSV or SQL file. Send columnTypes as "
                    + "a JSON object to override the types the preview inferred - keyed by column "
                    + "name for a CSV, by table.column for a script.",
            tags = {"DataFileUpload"})
    public ResponseEntity<?> uploadFile(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "columnTypes", required = false) String columnTypes) {
        try {
            Map<String, Object> result =
                    databaseService.handleFileUpload(file, parseColumnTypes(columnTypes));
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("File upload error", e);
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * The corrected types come as a JSON object in a multipart field, because the file has to
     * travel in the same request - a second upload would mean sending a large dump twice.
     */
    private Map<String, String> parseColumnTypes(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return JSON.readValue(json, new TypeReference<Map<String, String>>() { });
        } catch (Exception e) {
            throw new IllegalArgumentException("columnTypes must be a JSON object of column -> type");
        }
    }

    // ─── Query Execution ──────────────────────────────────────────────────────────

    @PostMapping("/query")
    @Operation(summary = "Run SQL Query",
            description = "Executes a raw SQL query against the database",
            tags = {"QueryExecuter"})
    public ResponseEntity<?> runQuery(@RequestBody QueryRequest request) {
        try {
            List<Map<String, Object>> data = databaseService.executeQuery(request.getQuery());
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
            return ResponseEntity.ok(databaseService.getDbInfo());
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
            return ResponseEntity.ok(databaseService.getTableData(tableName));
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
            databaseService.addColumn(request);
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
            databaseService.updateColumn(request);
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
            databaseService.updateCell(request);
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
            Map<String, Object> result = databaseService.insertRow(request);
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
            databaseService.deleteRow(request);
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
            databaseService.createTable(request);
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
            databaseService.clearDatabase();
            return ResponseEntity.ok(Map.of("message", "Database cleared successfully"));
        } catch (Exception e) {
            log.error("Clear DB error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Drop Table ───────────────────────────────────────────────────────────────

    @DeleteMapping("/table/{tableName}")
    @Operation(summary = "Delete Table",
            description = "Drops a table. Returns 409 when another table's foreign key still "
                    + "references it, listing the tables that depend on it.")
    public ResponseEntity<?> dropTable(@PathVariable String tableName) {
        try {
            databaseService.dropTable(tableName);
            return ResponseEntity.ok(Map.of("message", "Table deleted successfully"));
        } catch (TableInUseException e) {
            return ResponseEntity.status(409).body(Map.of(
                    "error", e.getMessage(),
                    "table", e.getTableName(),
                    "referencedBy", e.getReferencedBy()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Drop table error for {}", tableName, e);
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Failed to delete the table: " + e.getMessage()));
        }
    }

    // ─── Table Notes ──────────────────────────────────────────────────────────────

    @GetMapping("/table-notes")
    @Operation(summary = "List All Notes",
            description = "Every note in the workspace, so the UI can badge tables with open items.")
    public ResponseEntity<?> getAllNotes() {
        try {
            return ResponseEntity.ok(Map.of("notes", databaseService.getAllTableNotes()));
        } catch (Exception e) {
            log.error("List notes error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/table-notes/{tableName}")
    @Operation(summary = "Notes For A Table")
    public ResponseEntity<?> getNotes(@PathVariable String tableName) {
        try {
            return ResponseEntity.ok(Map.of("notes", databaseService.getTableNotes(tableName)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Notes error for {}", tableName, e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    public record NoteRequest(String note) {
    }

    public record NoteDoneRequest(Boolean done) {
    }

    @PostMapping("/table-notes/{tableName}")
    @Operation(summary = "Add A Note", description = "Attaches a to-do note to a table.")
    public ResponseEntity<?> addNote(@PathVariable String tableName, @RequestBody NoteRequest request) {
        try {
            return ResponseEntity.ok(
                    databaseService.addTableNote(tableName, request == null ? null : request.note()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Add note error for {}", tableName, e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/table-notes/{noteId}/done")
    @Operation(summary = "Tick A Note Off")
    public ResponseEntity<?> setNoteDone(@PathVariable long noteId, @RequestBody NoteDoneRequest request) {
        try {
            databaseService.setTableNoteDone(noteId, request != null && Boolean.TRUE.equals(request.done()));
            return ResponseEntity.ok(Map.of("message", "Note updated"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Update note error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/table-notes/{noteId}")
    @Operation(summary = "Delete A Note")
    public ResponseEntity<?> deleteNote(@PathVariable long noteId) {
        try {
            databaseService.deleteTableNote(noteId);
            return ResponseEntity.ok(Map.of("message", "Note deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Delete note error", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    // ─── Example Schema ───────────────────────────────────────────────────────────

    @PostMapping("/demo")
    @Operation(summary = "Load Example Schema",
            description = "Fills the current workspace with the Online Store template. Kept as a "
                    + "shortcut for the canvas's empty state; /templates/{id}/apply is the general form.")
    public ResponseEntity<?> loadExample() {
        try {
            return ResponseEntity.ok(templateService.apply(DEFAULT_TEMPLATE));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            log.error("Load example error", e);
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
            return ResponseEntity.ok(Map.of("workspaces", databaseService.listWorkspaces()));
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
            String workspaceId = com.dbviewer.app.workspace.WorkspaceContext.get();
            databaseService.deleteWorkspace();
            if (workspaceId != null && !workspaceId.isBlank()) {
                // A link to a database that no longer exists is worse than no link.
                shareService.revokeForWorkspace(workspaceId);
            }
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
            // Taking data out of the app is the one thing that needs an account.
            AuthContext.require();
            response.setContentType("text/csv");
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=" + tableName + ".csv");

            List<Map<String, Object>> rows = databaseService.getTableRows(tableName);
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
        } catch (UnauthorizedException e) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        } catch (Exception e) {
            log.error("Export CSV error for {}", tableName, e);
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
        }
    }

    // ─── Export SQL ───────────────────────────────────────────────────────────────

    @GetMapping("/dialects")
    @Operation(summary = "Supported SQL Dialects",
            description = "The engines an export can target. Ids are what /export-sql accepts.")
    public ResponseEntity<?> dialects() {
        return ResponseEntity.ok(Map.of("dialects", java.util.Arrays.stream(SqlDialect.values())
                .map(d -> Map.of("id", d.id(), "label", d.label()))
                .toList()));
    }

    @GetMapping("/export-sql")
    @Operation(summary = "Export Database as SQL",
            description = "Downloads a full SQL dump. Pass dialect=mysql|mariadb|postgres|"
                    + "sqlserver|sqlite|generic to get the syntax that engine requires.")
    public ResponseEntity<String> exportSql(
            @RequestParam(value = "filename", defaultValue = "database_export.sql") String filename,
            @RequestParam(value = "dialect", required = false) String dialect) {
        try {
            AuthContext.require();
            if (!filename.toLowerCase().endsWith(".sql")) {
                filename += ".sql";
            }
            // An unknown dialect falls back to portable SQL rather than being refused: a script
            // that runs almost anywhere is a better answer to a typo than a 400.
            String dump = databaseService.exportDatabaseSql(
                    SqlDialect.fromId(dialect, SqlDialect.GENERIC));
            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                    .contentType(MediaType.parseMediaType("application/sql"))
                    .body(dump);
        } catch (UnauthorizedException e) {
            return ResponseEntity.status(401).body(e.getMessage());
        } catch (Exception e) {
            log.error("Export SQL error", e);
            return ResponseEntity.internalServerError().build();
        }
    }
}
