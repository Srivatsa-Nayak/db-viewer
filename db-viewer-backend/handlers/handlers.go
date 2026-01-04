package handlers

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"db-viewer/database" // REPLACE 'db-viewer' WITH YOUR ACTUAL MODULE NAME
	"db-viewer/models"   // REPLACE 'db-viewer' WITH YOUR ACTUAL MODULE NAME

	"io"

	"github.com/gin-gonic/gin"
)

// HandleFileUpload uploads a CSV
// @Summary      Upload CSV
// @Description  Uploads a CSV file and creates a table in SQLite
// @Tags         DataFileUpload
// @Accept       multipart/form-data
// @Produce      json
// @Param        file formData file true "CSV File"
// @Success      200  {object}  map[string]interface{}
// @Router       /upload [post]
// HandleFileUpload uploads a CSV or SQL file
func HandleFileUpload(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}

	// 1. Identify File Type
	filename := strings.ToLower(fileHeader.Filename)
	isSQL := strings.HasSuffix(filename, ".sql")
	isCSV := strings.HasSuffix(filename, ".csv")

	if !isSQL && !isCSV {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only .csv and .sql files are supported"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Unable to open file"})
		return
	}
	defer file.Close()

	// -------------------------------------------
	// PATH A: SQL FILE IMPORT
	// -------------------------------------------
	if isSQL {
		content, err := io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
			return
		}

		sqlString := string(content)

		// Clean up MySQL syntax if we are running on SQLite
		if database.CurrentDriver == "sqlite" || database.CurrentDriver == "sqlite3" {
			sqlString = cleanSQLForSQLite(sqlString)
		}

		// Execute the SQL
		if _, err := database.DB.Exec(sqlString); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "SQL Execution Error: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "SQL executed successfully", "type": "sql"})
		return
	}

	// -------------------------------------------
	// PATH B: CSV FILE IMPORT (Restored)
	// -------------------------------------------
	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse CSV"})
		return
	}

	if len(records) < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV is empty"})
		return
	}

	// 1. Sanitize Table Name
	tableName := strings.TrimSuffix(fileHeader.Filename, ".csv")
	tableName = strings.TrimSuffix(tableName, ".CSV") // Handle uppercase too
	tableName = strings.ReplaceAll(tableName, " ", "_")
	tableName = strings.ReplaceAll(tableName, "-", "_")

	// 2. Extract Headers and Types
	headers := records[0]

	// Sanitize Headers (Remove spaces, special chars)
	for i, h := range headers {
		h = strings.TrimSpace(h)
		h = strings.ReplaceAll(h, " ", "_")
		h = strings.ReplaceAll(h, "/", "_")
		h = strings.ReplaceAll(h, ".", "")
		headers[i] = h
	}

	var dataRows [][]string
	if len(records) > 1 {
		dataRows = records[1:]
	}

	columnTypes := guessColumnTypes(headers, dataRows)

	// 3. Create Table
	createSQL := buildSmartCreateTableSQL(tableName, headers, columnTypes)
	if _, err := database.DB.Exec(createSQL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create table: " + err.Error()})
		return
	}

	// 4. Insert Data
	if len(dataRows) > 0 {
		if err := insertData(tableName, headers, dataRows); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to insert data: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "CSV uploaded successfully",
		"tableName": tableName,
		"columns":   headers,
		"type":      "csv",
	})
}

// HandleQuery runs SQL
// @Summary      Run SQL Query
// @Description  Executes a raw SQL query against the in-memory database
// @Tags         QueryExecuter
// @Accept       json
// @Produce      json
// @Param        request body models.QueryRequest true "SQL Query"
// @Success      200  {object}  map[string]interface{}
// @Router       /query [post]
func HandleQuery(c *gin.Context) {
	var req models.QueryRequest

	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	rows, err := database.DB.Query(req.Query)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	columns, _ := rows.Columns()
	count := len(columns)
	tableData := []map[string]interface{}{}

	for rows.Next() {
		values := make([]interface{}, count)
		valuePtrs := make([]interface{}, count)

		for i := range columns {
			valuePtrs[i] = &values[i]
		}

		rows.Scan(valuePtrs...)

		entry := make(map[string]interface{})
		for i, col := range columns {
			var v interface{}
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				v = string(b)
			} else {
				v = val
			}
			entry[col] = v
		}
		tableData = append(tableData, entry)
	}

	c.JSON(http.StatusOK, gin.H{"data": tableData})
}

// HandleGetDBInfo returns Schema + Data + Relationships
func HandleGetDBInfo(c *gin.Context) {
	var tables []models.TableInfo
	var tableNames []string
	var relationships []models.Relationship // Store real relationships here

	// 1. GET TABLE NAMES
	if database.CurrentDriver == "mysql" {
		rows, err := database.DB.Query("SHOW TABLES")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			rows.Scan(&name)
			tableNames = append(tableNames, name)
		}
	} else {
		// SQLite
		rows, err := database.DB.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			rows.Scan(&name)
			tableNames = append(tableNames, name)
		}
	}

	// 2. GET COLUMNS, DATA, AND *REAL* RELATIONSHIPS
	for _, tbl := range tableNames {
		var fullColumns []models.ColumnInfo

		// --- A. GET COLUMNS ---
		if database.CurrentDriver == "mysql" {
			// MySQL Column Logic
			schemaRows, err := database.DB.Query("DESCRIBE " + tbl)
			if err == nil {
				defer schemaRows.Close()
				for schemaRows.Next() {
					var field, typ, null, key, def, extra sql.NullString
					schemaRows.Scan(&field, &typ, &null, &key, &def, &extra)
					fullColumns = append(fullColumns, models.ColumnInfo{Name: field.String, Type: typ.String})
				}
			}

			// MySQL Relationship Logic (Query Information Schema)
			// Note: We use the current DB connection.
			// In a production app, we should filter by TABLE_SCHEMA = DATABASE()
			relQuery := `
				SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME 
				FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
				WHERE TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`

			fkRows, err := database.DB.Query(relQuery, tbl)
			if err == nil {
				defer fkRows.Close()
				for fkRows.Next() {
					var colName, refTable, refCol string
					if err := fkRows.Scan(&colName, &refTable, &refCol); err == nil {
						relationships = append(relationships, models.Relationship{
							SourceTable:  tbl,
							SourceColumn: colName,
							TargetTable:  refTable,
							TargetColumn: refCol,
						})
					}
				}
			}

		} else {
			// --- SQLite Column Logic ---
			schemaRows, err := database.DB.Query(fmt.Sprintf("PRAGMA table_info(%s)", tbl))
			if err == nil {
				defer schemaRows.Close()
				for schemaRows.Next() {
					var cid int
					var name, ctype string
					var notnull, pk int
					var dflt interface{}
					schemaRows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk)
					if ctype == "" {
						ctype = "TEXT"
					}
					fullColumns = append(fullColumns, models.ColumnInfo{Name: name, Type: ctype})
				}
			}

			// --- SQLite Relationship Logic (PRAGMA foreign_key_list) ---
			// This asks SQLite: "Who is this table connected to?"
			fkRows, err := database.DB.Query(fmt.Sprintf("PRAGMA foreign_key_list(%s)", tbl))
			if err == nil {
				defer fkRows.Close()
				for fkRows.Next() {
					var id, seq int
					var table, from, to, on_update, on_delete, match string
					// SQLite returns: id, seq, table, from, to, on_update, on_delete, match
					if err := fkRows.Scan(&id, &seq, &table, &from, &to, &on_update, &on_delete, &match); err == nil {
						relationships = append(relationships, models.Relationship{
							SourceTable:  tbl,
							SourceColumn: from,  // The column in *this* table
							TargetTable:  table, // The table it points to
							TargetColumn: to,
						})
					}
				}
			}
		}

		// --- B. GET SAMPLE DATA (Limit 100) ---
		dataRows, err := database.DB.Query(fmt.Sprintf("SELECT * FROM %s LIMIT 100", tbl))
		var tableData []map[string]interface{}

		if err == nil {
			colNames, _ := dataRows.Columns()
			for dataRows.Next() {
				values := make([]interface{}, len(colNames))
				valuePtrs := make([]interface{}, len(colNames))
				for i := range colNames {
					valuePtrs[i] = &values[i]
				}

				dataRows.Scan(valuePtrs...)
				entry := make(map[string]interface{})

				for i, col := range colNames {
					val := values[i]
					if b, ok := val.([]byte); ok {
						entry[col] = string(b)
					} else {
						entry[col] = val
					}
				}
				tableData = append(tableData, entry)
			}
			dataRows.Close()
		}

		tables = append(tables, models.TableInfo{
			Name:    tbl,
			Columns: fullColumns,
			Rows:    tableData,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"tables":        tables,
		"relationships": relationships,
	})
}

// HandleAddColumn executes ALTER TABLE
func HandleAddColumn(c *gin.Context) {
	var req models.AddColumnRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	tableName := strings.ReplaceAll(req.TableName, " ", "_")
	colName := strings.ReplaceAll(req.ColumnName, " ", "_")
	colType := strings.ToUpper(req.ColumnType)

	validTypes := map[string]bool{"VARCHAR": true, "INT": true, "DECIMAL": true, "REAL": true, "BOOLEAN": true, "DATE": true,
		"DATETIME": true,
		"TEXT":     true,
		"TIME":     true,
		"FLOAT":    true}
	if !validTypes[colType] {
		colType = "VARCHAR"
	}

	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, colName, colType)

	if _, err := database.DB.Exec(query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Column added successfully"})
}

// HandleExportCSV streams the table data
func HandleExportCSV(c *gin.Context) {
	tableName := c.Param("tableName")
	rows, err := database.DB.Query(fmt.Sprintf("SELECT * FROM %s", tableName))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Table not found"})
		return
	}
	defer rows.Close()

	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.csv", tableName))
	c.Header("Content-Type", "text/csv")

	writer := csv.NewWriter(c.Writer)
	cols, _ := rows.Columns()
	writer.Write(cols)

	count := len(cols)
	values := make([]interface{}, count)
	valuePtrs := make([]interface{}, count)
	for i := range cols {
		valuePtrs[i] = &values[i]
	}

	for rows.Next() {
		rows.Scan(valuePtrs...)
		record := make([]string, count)
		for i, val := range values {
			if val != nil {
				switch v := val.(type) {
				case []byte:
					record[i] = string(v)
				default:
					record[i] = fmt.Sprintf("%v", v)
				}
			} else {
				record[i] = ""
			}
		}
		writer.Write(record)
	}
	writer.Flush()
}

// HandleGetTableData fetches only the rows
// Replace existing HandleGetTableData
func HandleGetTableData(c *gin.Context) {
	tableName := c.Param("tableName")

	// Define a struct to hold Name AND Type
	type ColInfo struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}

	var columns []ColInfo

	// 1. GET COLUMNS with TYPES
	if database.CurrentDriver == "mysql" {
		rows, err := database.DB.Query("DESCRIBE " + tableName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var field, typ, null, key, def, extra sql.NullString
			rows.Scan(&field, &typ, &null, &key, &def, &extra)
			columns = append(columns, ColInfo{Name: field.String, Type: typ.String})
		}
	} else {
		// SQLite Logic
		rows, err := database.DB.Query(fmt.Sprintf("PRAGMA table_info(%s)", tableName))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, ctype string
			var rest interface{}
			rows.Scan(&cid, &name, &ctype, &rest, &rest, &rest)
			// SQLite types can be empty, default to TEXT
			if ctype == "" {
				ctype = "TEXT"
			}
			columns = append(columns, ColInfo{Name: name, Type: ctype})
		}
	}

	// 2. GET DATA
	rows, err := database.DB.Query(fmt.Sprintf("SELECT * FROM %s LIMIT 100", tableName))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	colNames, _ := rows.Columns()
	tableRows := []map[string]interface{}{}

	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range colNames {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)

		entry := make(map[string]interface{})
		for i, col := range colNames {
			val := values[i]
			if b, ok := val.([]byte); ok {
				entry[col] = string(b)
			} else {
				entry[col] = val
			}
		}
		tableRows = append(tableRows, entry)
	}

	c.JSON(http.StatusOK, gin.H{
		"columns": columns, // Now sends [{name: "dob", type: "DATE"}, ...]
		"rows":    tableRows,
	})
}

// HandleUpdateCell executes the SQL Update
func HandleUpdateCell(c *gin.Context) {
	var req models.UpdateCellRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	tableName := strings.ReplaceAll(req.TableName, " ", "_")
	colName := strings.ReplaceAll(req.ColumnName, " ", "_")

	query := fmt.Sprintf("UPDATE %s SET %s = ? WHERE id = ?", tableName, colName)

	if _, err := database.DB.Exec(query, req.NewValue, req.RecordID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

// HandleInsertRow inserts a new row
func HandleInsertRow(c *gin.Context) {
	// We accept a "data" map to handle other columns
	var req struct {
		TableName string                 `json:"table_name"`
		Data      map[string]interface{} `json:"data"`
	}

	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// 1. Sanitize Data: Remove 'id' and empty strings
	cleanData := make(map[string]interface{})
	for k, v := range req.Data {
		// CRITICAL: Always skip 'id' so the DB auto-increments it
		if strings.EqualFold(k, "id") {
			continue
		}

		// Skip empty strings (treat as NULL/Default)
		if str, ok := v.(string); ok && strings.TrimSpace(str) == "" {
			continue
		}
		if v == nil {
			continue
		}
		cleanData[k] = v
	}

	// 2. Determine Quote Style
	q := "\""
	if database.CurrentDriver == "mysql" {
		q = "`"
	}

	// 3. Construct Query
	// If cleanData is empty (e.g., user sent only ID or empty strings), insert a default row
	if len(cleanData) == 0 {
		var query string
		if database.CurrentDriver == "mysql" {
			// MySQL: INSERT INTO table () VALUES ()
			query = fmt.Sprintf("INSERT INTO %s%s%s () VALUES ()", q, req.TableName, q)
		} else {
			// SQLite: INSERT INTO table DEFAULT VALUES
			query = fmt.Sprintf("INSERT INTO %s%s%s DEFAULT VALUES", q, req.TableName, q)
		}

		res, err := database.DB.Exec(query)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Insert failed: " + err.Error()})
			return
		}
		id, _ := res.LastInsertId()
		c.JSON(http.StatusOK, gin.H{"message": "Row created", "id": id})
		return
	}

	// 4. Dynamic Insert with specific columns
	var cols []string
	var vals []interface{}
	var placeholders []string

	for k, v := range cleanData {
		cols = append(cols, k)
		vals = append(vals, v)
		placeholders = append(placeholders, "?")
	}

	// Quote column names
	quotedCols := make([]string, len(cols))
	for i, col := range cols {
		quotedCols[i] = fmt.Sprintf("%s%s%s", q, col, q)
	}

	query := fmt.Sprintf("INSERT INTO %s%s%s (%s) VALUES (%s)",
		q, req.TableName, q,
		strings.Join(quotedCols, ", "),
		strings.Join(placeholders, ", "))

	res, err := database.DB.Exec(query, vals...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Insert failed: " + err.Error()})
		return
	}

	id, _ := res.LastInsertId()
	c.JSON(http.StatusOK, gin.H{"message": "Row added successfully", "id": id})
}

// HandleDeleteRow deletes a row
func HandleDeleteRow(c *gin.Context) {
	var req models.DeleteRowRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	tableName := strings.ReplaceAll(req.TableName, " ", "_")
	query := fmt.Sprintf("DELETE FROM %s WHERE id = ?", tableName)

	if _, err := database.DB.Exec(query, req.RecordID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Row deleted successfully"})
}

// --- HELPER FUNCTIONS ---

func buildCreateTableSQL(tableName string, headers []string) string {
	var cols []string
	for _, h := range headers {
		cleanHeader := strings.ReplaceAll(h, " ", "_")
		cols = append(cols, fmt.Sprintf("%s TEXT", cleanHeader))
	}
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (%s);", tableName, strings.Join(cols, ", "))
}

func insertData(tableName string, headers []string, rows [][]string) error {
	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}

	// Determine Quote Style
	q := "\""
	if database.CurrentDriver == "mysql" {
		q = "`"
	}

	// Build placeholders (?,?,?)
	placeholders := make([]string, len(rows[0]))
	for i := range placeholders {
		placeholders[i] = "?"
	}

	// Build Column Names list: "col1", "col2", "col3"
	quotedHeaders := make([]string, len(headers))
	for i, h := range headers {
		quotedHeaders[i] = fmt.Sprintf("%s%s%s", q, h, q)
	}

	// Explicit Insert: INSERT INTO table (col1, col2) VALUES (?,?)
	// This is much safer than implicit INSERT INTO table VALUES (?,?)
	stmtStr := fmt.Sprintf("INSERT INTO %s%s%s (%s) VALUES (%s)",
		q, tableName, q,
		strings.Join(quotedHeaders, ","),
		strings.Join(placeholders, ","))

	stmt, err := tx.Prepare(stmtStr)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, row := range rows {
		args := make([]interface{}, len(row))
		for i, v := range row {
			args[i] = v
		}
		if _, err := stmt.Exec(args...); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// inferColumnType (Private helper, currently unused but preserved)
func inferColumnType(values []string) string {
	if len(values) == 0 {
		return "VARCHAR"
	}
	isInt := true
	isFloat := true
	isBool := true
	hasData := false

	intRegex := regexp.MustCompile(`^-?\d+$`)
	floatRegex := regexp.MustCompile(`^-?\d*\.\d+$`)

	for _, v := range values {
		if v == "" {
			continue
		}
		hasData = true
		if !intRegex.MatchString(v) {
			isInt = false
		}
		if !floatRegex.MatchString(v) && !intRegex.MatchString(v) {
			isFloat = false
		}
		lowerV := strings.ToLower(v)
		if lowerV != "true" && lowerV != "false" && lowerV != "0" && lowerV != "1" && lowerV != "yes" && lowerV != "no" {
			isBool = false
		}
	}

	if !hasData {
		return "VARCHAR"
	}
	if isBool {
		return "BOOL"
	}
	if isInt {
		return "INT"
	}
	if isFloat {
		return "DECIMAL"
	}
	return "VARCHAR"
}

func guessColumnTypes(headers []string, rows [][]string) []string {
	colTypes := make([]string, len(headers))

	for i := range headers {
		// Extract all values for this specific column
		var colValues []string
		for _, row := range rows {
			if i < len(row) {
				colValues = append(colValues, row[i])
			}
		}
		// Use our existing logic to guess
		colTypes[i] = inferColumnType(colValues)
	}
	return colTypes
}

// buildSmartCreateTableSQL constructs the SQL with REAL types (INT, BOOL) instead of just TEXT
func buildSmartCreateTableSQL(tableName string, headers []string, types []string) string {
	var builder strings.Builder

	// 1. Check if "id" already exists
	hasID := false
	for _, h := range headers {
		if strings.EqualFold(h, "id") {
			hasID = true
			break
		}
	}

	// 2. Determine Quote Style
	q := "\"" // Default SQLite quotes
	if database.CurrentDriver == "mysql" {
		q = "`" // MySQL Backticks
	}

	builder.WriteString(fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s%s%s (", q, tableName, q))

	// 3. If ID does NOT exist, create a dedicated one
	if !hasID {
		if database.CurrentDriver == "mysql" {
			builder.WriteString(fmt.Sprintf("%sid%s INT AUTO_INCREMENT PRIMARY KEY, ", q, q))
		} else {
			builder.WriteString(fmt.Sprintf("%sid%s INTEGER PRIMARY KEY AUTOINCREMENT, ", q, q))
		}
	}

	// 4. Add CSV Columns
	for i, header := range headers {
		colType := types[i]

		// FIX: If CSV has an 'id' column, make sure it is AUTO_INCREMENT
		if strings.EqualFold(header, "id") {
			if database.CurrentDriver == "sqlite" {
				// SQLite auto-increments INTEGER PRIMARY KEY by default
				if colType == "INTEGER" || colType == "INT" {
					colType = "INTEGER PRIMARY KEY"
				}
			} else if database.CurrentDriver == "mysql" {
				// MySQL needs explicit AUTO_INCREMENT
				if colType == "INT" || colType == "INTEGER" {
					colType = "INT AUTO_INCREMENT PRIMARY KEY"
				}
			}
		}

		// MySQL prefers VARCHAR over TEXT
		if database.CurrentDriver == "mysql" && colType == "TEXT" {
			colType = "VARCHAR(255)"
		}

		builder.WriteString(fmt.Sprintf("%s%s%s %s, ", q, header, q, colType))
	}

	// Remove trailing comma and close
	sql := builder.String()
	sql = strings.TrimSuffix(sql, ", ")
	sql += ");"

	return sql
}

func cleanSQLForSQLite(sqlContent string) string {
	lines := strings.Split(sqlContent, "\n")
	var cleanLines []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Skip commands that SQLite doesn't support
		if strings.HasPrefix(trimmed, "SET") ||
			strings.HasPrefix(trimmed, "LOCK TABLES") ||
			strings.HasPrefix(trimmed, "UNLOCK TABLES") ||
			strings.HasPrefix(trimmed, "/*!") ||
			strings.HasPrefix(trimmed, "BEGIN") ||
			strings.HasPrefix(trimmed, "COMMIT") ||
			strings.HasPrefix(trimmed, "START") ||
			strings.HasPrefix(trimmed, "USE") {
			continue
		}

		cleanLines = append(cleanLines, line)
	}

	result := strings.Join(cleanLines, "\n")

	// Regex looks for ") ENGINE=..." up to the semicolon
	reEngine := regexp.MustCompile(`\) ENGINE=[^;]+;`)
	result = reEngine.ReplaceAllString(result, ");")

	// Easier to just remove it for visualization purposes).
	result = strings.ReplaceAll(result, "AUTO_INCREMENT", "")

	// result = strings.ReplaceAll(result, "`", "\"")

	return result
}

func HandleClearDatabase(c *gin.Context) {
	var tableNames []string
	// 1. GET TABLE NAMES
	if database.CurrentDriver == "mysql" {
		rows, err := database.DB.Query("SHOW TABLES")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tables"})
			return
		}

		for rows.Next() {
			var name string
			rows.Scan(&name)
			tableNames = append(tableNames, name)
		}
		rows.Close() // <--- CRITICAL: Close before executing drops

		// MySQL Drop Logic
		database.DB.Exec("SET FOREIGN_KEY_CHECKS = 0")
		for _, table := range tableNames {
			_, err := database.DB.Exec("DROP TABLE IF EXISTS " + table)
			if err != nil {
				fmt.Println("Error dropping table:", table, err)
			}
		}
		database.DB.Exec("SET FOREIGN_KEY_CHECKS = 1")

	} else {
		// SQLite Logic
		rows, err := database.DB.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tables"})
			return
		}

		for rows.Next() {
			var name string
			rows.Scan(&name)
			tableNames = append(tableNames, name)
		}
		rows.Close() // <--- CRITICAL FIX: Release the read lock immediately

		// SQLite Drop Logic
		// 1. Disable Foreign Keys to allow dropping in any order
		if _, err := database.DB.Exec("PRAGMA foreign_keys = OFF"); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "DB Busy: " + err.Error()})
			return
		}

		// 2. Drop Tables
		for _, table := range tableNames {
			// Use quotes \"%s\" to handle tables with spaces or special chars
			_, err := database.DB.Exec(fmt.Sprintf("DROP TABLE IF EXISTS \"%s\"", table))
			if err != nil {
				// If database is still locked, this will tell us
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to drop " + table + ": " + err.Error()})
				return
			}
		}

		// 3. Re-enable Foreign Keys
		database.DB.Exec("PRAGMA foreign_keys = ON")
	}

	c.JSON(http.StatusOK, gin.H{"message": "Database cleared successfully"})
}

// HandleExportDatabaseSQL generates a full SQL dump
func HandleExportDatabaseSQL(c *gin.Context) {
	originalName := c.Query("filename")
	if originalName == "" {
		originalName = "database.sql"
	}
	baseName := strings.TrimSuffix(originalName, ".sql")
	baseName = strings.TrimSuffix(baseName, ".csv")
	downloadName := fmt.Sprintf("%s_modified.sql", baseName)

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", downloadName))
	c.Header("Content-Type", "application/sql")

	var dumpBuilder strings.Builder
	fmt.Fprintf(&dumpBuilder, "-- SQL Dump generated by SQL Visualizer\n")

	// 1. Get Tables
	var tables []string
	if database.CurrentDriver == "mysql" {
		rows, _ := database.DB.Query("SHOW TABLES")
		defer rows.Close()
		for rows.Next() {
			var name string
			rows.Scan(&name)
			tables = append(tables, name)
		}
	} else {
		rows, _ := database.DB.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
		defer rows.Close()
		for rows.Next() {
			var name string
			rows.Scan(&name)
			tables = append(tables, name)
		}
	}

	// 2. Generate SQL
	for _, table := range tables {
		var createSQL string

		if database.CurrentDriver == "mysql" {
			var dummyName string
			database.DB.QueryRow("SHOW CREATE TABLE "+table).Scan(&dummyName, &createSQL)
		} else {
			database.DB.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", table).Scan(&createSQL)

			// --- FIX: CLEAN UP SQLITE FORMATTING ---
			reFormat := regexp.MustCompile(`\s*[\r\n]+\s*,`)

			// Replace with: "," and a newline + indentation
			createSQL = reFormat.ReplaceAllString(createSQL, ",\n    ")
			// ---------------------------------------
		}

		if createSQL != "" {
			dumpBuilder.WriteString(fmt.Sprintf("\n-- Structure for table `%s`\n", table))
			dumpBuilder.WriteString(fmt.Sprintf("DROP TABLE IF EXISTS `%s`;\n", table))
			dumpBuilder.WriteString(createSQL + ";\n\n")
		}

		// Dump Data
		dumpBuilder.WriteString(fmt.Sprintf("-- Data for table `%s`\n", table))
		rows, err := database.DB.Query(fmt.Sprintf("SELECT * FROM %s", table))
		if err == nil {
			cols, _ := rows.Columns()
			values := make([]interface{}, len(cols))
			scanArgs := make([]interface{}, len(cols))
			for i := range values {
				scanArgs[i] = &values[i]
			}

			for rows.Next() {
				rows.Scan(scanArgs...)
				var rowValues []string
				for _, v := range values {
					if v == nil {
						rowValues = append(rowValues, "NULL")
					} else {
						switch val := v.(type) {
						case []byte:
							rowValues = append(rowValues, fmt.Sprintf("'%s'", strings.ReplaceAll(string(val), "'", "''")))
						case string:
							rowValues = append(rowValues, fmt.Sprintf("'%s'", strings.ReplaceAll(val, "'", "''")))
						default:
							rowValues = append(rowValues, fmt.Sprintf("'%v'", val))
						}
					}
				}

				q := "\""
				if database.CurrentDriver == "mysql" {
					q = "`"
				}

				dumpBuilder.WriteString(fmt.Sprintf("INSERT INTO %s%s%s (%s) VALUES (%s);\n",
					q, table, q,
					strings.Join(cols, ", "),
					strings.Join(rowValues, ", ")))
			}
			rows.Close()
		}
		dumpBuilder.WriteString("\n")
	}

	c.String(http.StatusOK, dumpBuilder.String())
}
