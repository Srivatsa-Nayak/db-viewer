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
func HandleFileUpload(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Unable to open file"})
		return
	}
	defer file.Close()

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

	tableName := strings.Split(fileHeader.Filename, ".")[0]
	tableName = strings.ReplaceAll(tableName, " ", "_")
	headers := records[0]

	// --- NEW LOGIC: Infer Types from Data ---
	// We pass the data rows (records[1:]) to guess the types
	columnTypes := guessColumnTypes(headers, records[1:])

	createTableSQL := buildSmartCreateTableSQL(tableName, headers, columnTypes)

	if _, err := database.DB.Exec(createTableSQL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create table: " + err.Error()})
		return
	}

	if err := insertData(tableName, records[1:]); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to insert data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "Table created successfully",
		"tableName": tableName,
		"columns":   headers,
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
	rows, err := database.DB.Query("SELECT name FROM sqlite_master WHERE type='table'")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var tables []models.TableInfo
	var tableNames []string

	for rows.Next() {
		var name string
		rows.Scan(&name)
		tableNames = append(tableNames, name)
	}
	rows.Close()

	for _, tbl := range tableNames {
		// Get Schema
		schemaRows, err := database.DB.Query(fmt.Sprintf("PRAGMA table_info(%s)", tbl))
		if err != nil {
			continue
		}

		var fullColumns []models.ColumnInfo

		for schemaRows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dflt interface{}

			schemaRows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk)
			if ctype == "" {
				ctype = "VARCHAR"
			}

			fullColumns = append(fullColumns, models.ColumnInfo{
				Name: name,
				Type: ctype,
			})
		}
		schemaRows.Close()

		// Get Data
		dataRows, err := database.DB.Query(fmt.Sprintf("SELECT * FROM %s", tbl))
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
					if val != nil {
						if b, ok := val.([]byte); ok {
							entry[col] = string(b)
						} else {
							entry[col] = val
						}
					} else {
						entry[col] = nil
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

	// Calculate Relationships
	relationships := []models.Relationship{}
	for _, sourceTbl := range tables {
		for _, col := range sourceTbl.Columns {
			if strings.HasSuffix(col.Name, "_id") {
				targetTblName := strings.TrimSuffix(col.Name, "_id")
				for _, targetTbl := range tableNames {
					if targetTbl == targetTblName || targetTbl == targetTblName+"s" {
						relationships = append(relationships, models.Relationship{
							SourceTable:  sourceTbl.Name,
							SourceColumn: col.Name,
							TargetTable:  targetTbl,
						})
					}
				}
			}
		}
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

	validTypes := map[string]bool{"VARCHAR": true, "INT": true, "DECIMAL": true, "REAL": true, "BOOLEAN": true}
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
func HandleGetTableData(c *gin.Context) {
	tableName := c.Param("tableName")
	rows, err := database.DB.Query(fmt.Sprintf("SELECT * FROM %s", tableName))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	var result []map[string]interface{}

	for rows.Next() {
		values := make([]interface{}, len(cols))
		valuePtrs := make([]interface{}, len(cols))
		for i := range cols {
			valuePtrs[i] = &values[i]
		}
		rows.Scan(valuePtrs...)

		entry := make(map[string]interface{})
		for i, col := range cols {
			val := values[i]
			if b, ok := val.([]byte); ok {
				entry[col] = string(b)
			} else {
				entry[col] = val
			}
		}
		result = append(result, entry)
	}
	c.JSON(http.StatusOK, result)
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
	var req models.InsertRowRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	tableName := strings.ReplaceAll(req.TableName, " ", "_")

	var maxID sql.NullInt64
	err := database.DB.QueryRow(fmt.Sprintf("SELECT MAX(id) FROM %s", tableName)).Scan(&maxID)

	nextID := 1
	if err == nil && maxID.Valid {
		nextID = int(maxID.Int64) + 1
	}

	query := fmt.Sprintf("INSERT INTO %s (id) VALUES (?)", tableName)
	_, err = database.DB.Exec(query, nextID)
	if err != nil {
		_, err = database.DB.Exec(fmt.Sprintf("INSERT INTO %s DEFAULT VALUES", tableName))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Row created", "id": nextID})
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

func insertData(tableName string, rows [][]string) error {
	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}

	placeholders := make([]string, len(rows[0]))
	for i := range placeholders {
		placeholders[i] = "?"
	}
	stmtStr := fmt.Sprintf("INSERT INTO %s VALUES (%s)", tableName, strings.Join(placeholders, ","))

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
	var cols []string
	for i, h := range headers {
		cleanHeader := strings.ReplaceAll(h, " ", "_")
		sqlType := types[i] // Use the guessed type
		cols = append(cols, fmt.Sprintf("%s %s", cleanHeader, sqlType))
	}
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (%s);", tableName, strings.Join(cols, ", "))
}
