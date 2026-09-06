package com.dbviewer.service;

import com.dbviewer.dto.*;
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
     * Generates a full SQL dump of the database.
     * Mirrors HandleExportDatabaseSQL in Go.
     */
    String exportDatabaseSql();

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

    /** Loads the bundled example schema into the current workspace. */
    Map<String, Object> loadExampleSchema();

    /**
     * Ids of every workspace that still has a database, so the UI can restore a previous
     * session and drop entries whose database no longer exists.
     */
    List<String> listWorkspaces();

    /**
     * Discards the workspace bound to the current request: its database file (SQLite)
     * or schema (MySQL) is deleted outright. Without a workspace id on the request this
     * degrades to {@link #clearDatabase()} against the default datasource.
     */
    void deleteWorkspace();

}