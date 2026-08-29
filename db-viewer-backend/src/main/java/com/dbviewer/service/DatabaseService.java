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

}