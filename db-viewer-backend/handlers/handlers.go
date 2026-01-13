package handlers

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"db-viewer/database"
	"db-viewer/models"

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

	if isSQL {
		content, err := io.ReadAll(file)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
			return
		}

		sqlString := string(content)

		if database.CurrentDriver == "sqlite" || database.CurrentDriver == "sqlite3" {
			sqlString = cleanSQLForSQLite(sqlString)
		}

		if _, err := database.DB.Exec(sqlString); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "SQL Execution Error: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "SQL executed successfully", "type": "sql"})
		return
	}

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

	tableName := strings.TrimSuffix(fileHeader.Filename, ".csv")
	tableName = strings.TrimSuffix(tableName, ".CSV") // Handle uppercase too
	tableName = strings.ReplaceAll(tableName, " ", "_")
	tableName = strings.ReplaceAll(tableName, "-", "_")

	headers := records[0]

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

	createSQL := buildSmartCreateTableSQL(tableName, headers, columnTypes)
	if _, err := database.DB.Exec(createSQL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create table: " + err.Error()})
		return
	}

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

func HandleGetDBInfo(c *gin.Context) {
	var tables []models.TableInfo
	var tableNames []string
	var relationships []models.Relationship

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

	for _, tbl := range tableNames {
		var fullColumns []models.ColumnInfo

		if database.CurrentDriver == "mysql" {
			schemaRows, err := database.DB.Query("DESCRIBE " + tbl)
			if err == nil {
				defer schemaRows.Close()
				for schemaRows.Next() {
					var field, typ, null, key, def, extra sql.NullString
					schemaRows.Scan(&field, &typ, &null, &key, &def, &extra)
					fullColumns = append(fullColumns, models.ColumnInfo{Name: field.String, Type: typ.String})
				}
			}

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

			fkRows, err := database.DB.Query(fmt.Sprintf("PRAGMA foreign_key_list(%s)", tbl))
			if err == nil {
				defer fkRows.Close()
				for fkRows.Next() {
					var id, seq int
					var table, from, to, on_update, on_delete, match string
					if err := fkRows.Scan(&id, &seq, &table, &from, &to, &on_update, &on_delete, &match); err == nil {
						relationships = append(relationships, models.Relationship{
							SourceTable:  tbl,
							SourceColumn: from,
							TargetTable:  table,
							TargetColumn: to,
						})
					}
				}
			}
		}

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

func HandleAddColumn(c *gin.Context) {
	var req struct {
		TableName  string `json:"table_name"`
		ColumnName string `json:"column_name"`
		ColumnType string `json:"column_type"`
		Length     int    `json:"length"`
		NotNull    bool   `json:"not_null"`
	}

	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	tableName := strings.ReplaceAll(req.TableName, " ", "_")
	colName := strings.ReplaceAll(req.ColumnName, " ", "_")
	baseType := strings.ToUpper(req.ColumnType)

	var typeDef string

	switch baseType {
	case "VARCHAR":
		length := req.Length
		if length == 0 {
			length = 128
		}
		typeDef = fmt.Sprintf("VARCHAR(%d)", length)

	case "INT":
		if database.CurrentDriver == "sqlite" {
			typeDef = "INTEGER"
		} else {
			typeDef = "INT"
		}

	default:
		typeDef = baseType
	}

	if req.NotNull {
		typeDef += " NOT NULL"

		if baseType == "VARCHAR" || baseType == "TEXT" {
			typeDef += " DEFAULT ''"
		} else if baseType == "INT" || baseType == "INTEGER" || baseType == "DECIMAL" {
			typeDef += " DEFAULT 0"
		} else if baseType == "BOOLEAN" {
			typeDef += " DEFAULT 0"
		} else if strings.Contains(baseType, "DATE") || strings.Contains(baseType, "TIME") {
			typeDef += " DEFAULT '1970-01-01'"
		}
	}

	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, colName, typeDef)
	if _, err := database.DB.Exec(query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add column: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Column added successfully"})
}

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

func HandleGetTableData(c *gin.Context) {
	tableName := c.Param("tableName")

	type ColInfo struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}

	var columns []ColInfo

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
			if ctype == "" {
				ctype = "TEXT"
			}
			columns = append(columns, ColInfo{Name: name, Type: ctype})
		}
	}

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
		"columns": columns,
		"rows":    tableRows,
	})
}

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

func HandleInsertRow(c *gin.Context) {
	var req struct {
		TableName string                 `json:"table_name"`
		Data      map[string]interface{} `json:"data"`
	}

	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	cleanData := make(map[string]interface{})
	for k, v := range req.Data {
		if strings.EqualFold(k, "id") {
			continue
		}

		if str, ok := v.(string); ok && strings.TrimSpace(str) == "" {
			continue
		}
		if v == nil {
			continue
		}
		cleanData[k] = v
	}

	q := "\""
	if database.CurrentDriver == "mysql" {
		q = "`"
	}

	if len(cleanData) == 0 {
		var query string
		if database.CurrentDriver == "mysql" {
			query = fmt.Sprintf("INSERT INTO %s%s%s () VALUES ()", q, req.TableName, q)
		} else {
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

	var cols []string
	var vals []interface{}
	var placeholders []string

	for k, v := range cleanData {
		cols = append(cols, k)
		vals = append(vals, v)
		placeholders = append(placeholders, "?")
	}

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

	q := "\""
	if database.CurrentDriver == "mysql" {
		q = "`"
	}

	placeholders := make([]string, len(rows[0]))
	for i := range placeholders {
		placeholders[i] = "?"
	}

	quotedHeaders := make([]string, len(headers))
	for i, h := range headers {
		quotedHeaders[i] = fmt.Sprintf("%s%s%s", q, h, q)
	}

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
		var colValues []string
		for _, row := range rows {
			if i < len(row) {
				colValues = append(colValues, row[i])
			}
		}
		colTypes[i] = inferColumnType(colValues)
	}
	return colTypes
}

func buildSmartCreateTableSQL(tableName string, headers []string, types []string) string {
	var builder strings.Builder

	hasID := false
	for _, h := range headers {
		if strings.EqualFold(h, "id") {
			hasID = true
			break
		}
	}

	q := "\""
	if database.CurrentDriver == "mysql" {
		q = "`" // MySQL Backticks
	}

	builder.WriteString(fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s%s%s (", q, tableName, q))

	if !hasID {
		if database.CurrentDriver == "mysql" {
			builder.WriteString(fmt.Sprintf("%sid%s INT AUTO_INCREMENT PRIMARY KEY, ", q, q))
		} else {
			builder.WriteString(fmt.Sprintf("%sid%s INTEGER PRIMARY KEY AUTOINCREMENT, ", q, q))
		}
	}

	for i, header := range headers {
		colType := types[i]

		if strings.EqualFold(header, "id") {
			switch database.CurrentDriver {
			case "sqlite":
				if colType == "INTEGER" || colType == "INT" {
					colType = "INTEGER PRIMARY KEY"
				}
			case "mysql":
				if colType == "INT" || colType == "INTEGER" {
					colType = "INT AUTO_INCREMENT PRIMARY KEY"
				}
			}
		}

		if database.CurrentDriver == "mysql" && colType == "TEXT" {
			colType = "VARCHAR(255)"
		}

		builder.WriteString(fmt.Sprintf("%s%s%s %s, ", q, header, q, colType))
	}

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

	reEngine := regexp.MustCompile(`\) ENGINE=[^;]+;`)
	result = reEngine.ReplaceAllString(result, ");")

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
		rows.Close()

		database.DB.Exec("SET FOREIGN_KEY_CHECKS = 0")
		for _, table := range tableNames {
			_, err := database.DB.Exec("DROP TABLE IF EXISTS " + table)
			if err != nil {
				fmt.Println("Error dropping table:", table, err)
			}
		}
		database.DB.Exec("SET FOREIGN_KEY_CHECKS = 1")

	} else {
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
		rows.Close()

		if _, err := database.DB.Exec("PRAGMA foreign_keys = OFF"); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "DB Busy: " + err.Error()})
			return
		}

		for _, table := range tableNames {
			_, err := database.DB.Exec(fmt.Sprintf("DROP TABLE IF EXISTS \"%s\"", table))
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to drop " + table + ": " + err.Error()})
				return
			}
		}

		database.DB.Exec("PRAGMA foreign_keys = ON")
	}

	c.JSON(http.StatusOK, gin.H{"message": "Database cleared successfully"})
}

func HandleExportDatabaseSQL(c *gin.Context) {
	userFilename := c.Query("filename")

	if userFilename == "" {
		userFilename = "database_export.sql"
	}

	if !strings.HasSuffix(strings.ToLower(userFilename), ".sql") {
		userFilename += ".sql"
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", userFilename))
	c.Header("Content-Type", "application/sql")

	// originalName := c.Query("filename")
	// if originalName == "" {
	// 	originalName = "database.sql"
	// }
	// baseName := strings.TrimSuffix(originalName, ".sql")
	// baseName = strings.TrimSuffix(baseName, ".csv")
	// downloadName := fmt.Sprintf("%s_modified.sql", baseName)

	// c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s", downloadName))
	// c.Header("Content-Type", "application/sql")

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

	for _, table := range tables {
		var createSQL string

		if database.CurrentDriver == "mysql" {
			var dummyName string
			database.DB.QueryRow("SHOW CREATE TABLE "+table).Scan(&dummyName, &createSQL)
		} else {
			database.DB.QueryRow("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", table).Scan(&createSQL)
			reFormat := regexp.MustCompile(`\s*[\r\n]+\s*,`)
			createSQL = reFormat.ReplaceAllString(createSQL, ",\n    ")
		}

		if createSQL != "" {
			dumpBuilder.WriteString(fmt.Sprintf("\n-- Structure for table `%s`\n", table))
			dumpBuilder.WriteString(fmt.Sprintf("DROP TABLE IF EXISTS `%s`;\n", table))
			dumpBuilder.WriteString(createSQL + ";\n\n")
		}

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

func HandleCreateTable(c *gin.Context) {
	var req struct {
		TableName string `json:"table_name"`
		Columns   []struct {
			Name     string `json:"name"`
			Type     string `json:"type"`
			Length   int    `json:"length"`
			IsPK     bool   `json:"is_pk"`
			NotNull  bool   `json:"not_null"`
			RefTable string `json:"ref_table"`
			RefCol   string `json:"ref_col"`
		} `json:"columns"`
	}

	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	tableName := strings.ReplaceAll(req.TableName, " ", "_")
	var colDefs []string
	var fkDefs []string

	q := "\""
	if database.CurrentDriver == "mysql" {
		q = "`"
	}

	for _, col := range req.Columns {
		colName := strings.ReplaceAll(col.Name, " ", "_")
		colType := strings.ToUpper(col.Type)

		typeDef := colType
		if colType == "VARCHAR" {
			len := col.Length
			if len == 0 {
				len = 128
			}
			typeDef = fmt.Sprintf("VARCHAR(%d)", len)
		} else if colType == "INT" && database.CurrentDriver == "sqlite" {
			typeDef = "INTEGER"
		}

		if col.IsPK {
			if database.CurrentDriver == "sqlite" {
				typeDef += " PRIMARY KEY AUTOINCREMENT"
			} else {
				typeDef += " AUTO_INCREMENT PRIMARY KEY"
			}
		} else {
			if col.NotNull {
				typeDef += " NOT NULL"
			}
			// Add defaults for safety
			if colType == "INT" || colType == "INTEGER" {
				typeDef += " DEFAULT 0"
			}
			if colType == "BOOLEAN" {
				typeDef += " DEFAULT 0"
			}
		}

		colDefs = append(colDefs, fmt.Sprintf("%s%s%s %s", q, colName, q, typeDef))

		if col.RefTable != "" && col.RefCol != "" {
			fkStr := fmt.Sprintf("FOREIGN KEY (%s%s%s) REFERENCES %s%s%s(%s%s%s)",
				q, colName, q,
				q, col.RefTable, q,
				q, col.RefCol, q)
			fkStr += " ON DELETE CASCADE"
			fkDefs = append(fkDefs, fkStr)
		}
	}

	fullDefs := append(colDefs, fkDefs...)
	query := fmt.Sprintf("CREATE TABLE %s (%s);", tableName, strings.Join(fullDefs, ", "))

	if _, err := database.DB.Exec(query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create table: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Table created successfully"})
}
