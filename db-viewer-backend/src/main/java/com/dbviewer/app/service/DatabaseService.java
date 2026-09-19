package com.dbviewer.app.service;

import com.dbviewer.app.exception.TableInUseException;
import com.dbviewer.app.dto.*;
import com.dbviewer.app.sql.SqlDialect;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

/**
 * Contract for all database operations.
 * Mirrors the handler functions defined in Go's handlers.go.
 */
public interface DatabaseService {

    /**
     * Handles CSV and SQL file uploads.
     * Mirrors HandleFileUpload in Go.
     */
    Map<String, Object> handleFileUpload(MultipartFile file) throws Exception;

    /**
     * Runs an import the user has already reviewed, applying the column types they corrected.
     *
     * @param typeOverrides keyed by column name for a CSV, by {@code table.column} for a script;
     *                      empty to use whatever was inferred or declared
     */
    Map<String, Object> handleFileUpload(MultipartFile file, Map<String, String> typeOverrides)
            throws Exception;

    /**
     * Describes what importing a file would produce, without importing it.
     *
     * <p>The half of an import that can be undone by pressing Cancel. Type inference on a CSV is
     * guesswork, and a wrong guess is destructive — an {@code INT} postcode column has lost its
     * leading zeros by the time anyone sees the canvas — so the plan is shown first and the DDL
     * runs only once it has been confirmed.
     */
    ImportPlan analyzeUpload(MultipartFile file) throws Exception;

    /**
     * Executes a raw SQL query.
     * Mirrors HandleQuery in Go.
     */
    List<Map<String, Object>> executeQuery(String sql);

    /**
     * Gets all table schemas, row previews, and foreign key relationships.
     * Mirrors HandleGetDBInfo in Go.
     */
    Map<String, Object> getDbInfo();

    /**
     * Gets column metadata and rows for a specific table.
     * Mirrors HandleGetTableData in Go.
     */
    Map<String, Object> getTableData(String tableName);

    /**
     * Adds a column to an existing table.
     * Mirrors HandleAddColumn in Go.
     */
    void addColumn(AddColumnRequest req);

    /**
     * Renames an existing column and/or changes its type or nullability.
     * On SQLite a type change rebuilds the table, because ALTER COLUMN is unsupported there.
     */
    void updateColumn(UpdateColumnRequest req);

    /**
     * Updates a single cell value by record ID.
     * Mirrors HandleUpdateCell in Go.
     */
    void updateCell(UpdateCellRequest req);

    /**
     * Inserts a new row (empty or with data).
     * Mirrors HandleInsertRow in Go.
     */
    Map<String, Object> insertRow(InsertRowRequest req);

    /**
     * Deletes a row by its ID.
     * Mirrors HandleDeleteRow in Go.
     */
    void deleteRow(DeleteRowRequest req);

    /**
     * Drops all tables in the database.
     * Mirrors HandleClearDatabase in Go.
     */
    void clearDatabase();

    /**
     * Creates a new table from a column definition.
     * Mirrors HandleCreateTable in Go.
     */
    void createTable(CreateTableRequest req);

    /**
     * Returns all rows from a table for CSV export.
     * Mirrors HandleExportCSV in Go.
     */
    List<Map<String, Object>> getTableRows(String tableName);

    /**
     * Generates a full SQL dump of the database, in the dialect the workspace itself runs on.
     * Mirrors HandleExportDatabaseSQL in Go.
     */
    String exportDatabaseSql();

    /**
     * Generates a full SQL dump written for a particular engine.
     *
     * <p>Not a formatting preference: {@code AUTOINCREMENT}, {@code SERIAL},
     * {@code IDENTITY(1,1)} and {@code AUTO_INCREMENT} are four spellings of the same idea and
     * no engine accepts another's, so an untargeted export is only ever nearly runnable.
     */
    String exportDatabaseSql(SqlDialect target);

    /**
     * Drops a table. Refuses with {@link TableInUseException} when another table's foreign key
     * still references it, rather than leaving dangling references behind.
     */
    void dropTable(String tableName);

    /** Notes attached to one table - a to-do list the user can come back to. */
    List<Map<String, Object>> getTableNotes(String tableName);

    /** Every note in the workspace, so the UI can badge which tables have open items. */
    List<Map<String, Object>> getAllTableNotes();

    Map<String, Object> addTableNote(String tableName, String note);

    void setTableNoteDone(long noteId, boolean done);

    void deleteTableNote(long noteId);

    /**
     * Runs a SQL script into the current workspace, refusing if it already has tables.
     * Shared by the starter templates and the bundled example.
     */
    Map<String, Object> runScript(String script);

    /**
     * Every workspace the caller owns that still has a database, with the name the user gave it.
     *
     * <p>This is how the UI rebuilds the file list — on a browser refresh, and on sign-in, where
     * it is the only source: signing out clears the browser's copy.
     */
    List<WorkspaceOwnershipService.OwnedWorkspace> listWorkspaces();

    /** Records what the user called the current workspace, so the file list can show it. */
    void setWorkspaceName(String fileName);

    /**
     * Discards the workspace bound to the current request: its database file (SQLite)
     * or schema (MySQL) is deleted outright. Without a workspace id on the request this
     * degrades to {@link #clearDatabase()} against the default datasource.
     */
    void deleteWorkspace();

}