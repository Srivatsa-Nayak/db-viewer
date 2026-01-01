package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"

	_ "db-viewer/docs"

	"regexp"

	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

var db *sql.DB

type ColumnInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type TableInfo struct {
	Name    string                   `json:"name"`
	Columns []ColumnInfo             `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
}

type Relationship struct {
	SourceTable  string `json:"source_table"`
	TargetTable  string `json:"target_table"`
	SourceColumn string `json:"source_column"`
}

// Request body for adding a column
type AddColumnRequest struct {
	TableName  string `json:"table_name"`
	ColumnName string `json:"column_name"`
	ColumnType string `json:"column_type"` // e.g., "TEXT", "INT"
}

// @title           Database Visualizer API
// @version         1.0
// @description     A simple API to upload CSVs to SQLite and run queries.
// @host            localhost:8080
// @BasePath        /
func main() {
	var err error
	db, err = sql.Open("sqlite", ":memory:")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	r := gin.Default()
	r.Use(cors.Default())

	// --- SWAGGER ROUTE ---
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// Endpoints
	r.POST("/upload", handleFileUpload)
	r.POST("/query", handleQuery)
	r.GET("/db-info", handleGetDBInfo)
	r.POST("/alter-table", handleAddColumn)
	r.GET("/export/:tableName", handleExportCSV)

	fmt.Println("Application running on http://localhost:8080")
	r.Run(":8080")
}

// handleFileUpload uploads a CSV
// @Summary      Upload CSV
// @Description  Uploads a CSV file and creates a table in SQLite
// @Tags         DataFileUpload
// @Accept       multipart/form-data
// @Produce      json
// @Param        file formData file true "CSV File"
// @Success      200  {object}  map[string]interface{}
// @Router       /upload [post]
func handleFileUpload(c *gin.Context) {
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
	createTableSQL := buildCreateTableSQL(tableName, headers)

	if _, err := db.Exec(createTableSQL); err != nil {
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

// QueryRequest defines the body for queries
type QueryRequest struct {
	Query string `json:"query" example:"SELECT * FROM users"`
}

// handleQuery runs SQL
// @Summary      Run SQL Query
// @Description  Executes a raw SQL query against the in-memory database
// @Tags         QueryExecuter
// @Accept       json
// @Produce      json
// @Param        request body QueryRequest true "SQL Query"
// @Success      200  {object}  map[string]interface{}
// @Router       /query [post]
func handleQuery(c *gin.Context) {
	var req QueryRequest

	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	rows, err := db.Query(req.Query)
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

func buildCreateTableSQL(tableName string, headers []string) string {
	var cols []string
	for _, h := range headers {
		cleanHeader := strings.ReplaceAll(h, " ", "_")
		cols = append(cols, fmt.Sprintf("%s TEXT", cleanHeader))
	}
	return fmt.Sprintf("CREATE TABLE IF NOT EXISTS %s (%s);", tableName, strings.Join(cols, ", "))
}

func insertData(tableName string, rows [][]string) error {
	tx, err := db.Begin()
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

// handleGetDBInfo analyzes the DB to return Schema + Data + Relationships
// @Summary      Get Database Schema & Data
// @Description  Returns all tables, their rows, and inferred relationships based on column names (e.g., user_id -> users)
// @Tags         handleDBInfo
// @Produce      json
// @Success      200  {object}  map[string]interface{}
// @Router       /db-info [get]
func handleGetDBInfo(c *gin.Context) {
	// 1. Get all table names
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table'")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var tables []TableInfo
	var tableNames []string

	for rows.Next() {
		var name string
		rows.Scan(&name)
		tableNames = append(tableNames, name)
	}
	rows.Close()

	// 2. Loop through tables
	for _, tbl := range tableNames {

		// --- STEP A: Get Exact Schema (Metadata) ---
		// We use PRAGMA to get the real types (INT, DECIMAL) even if the column is empty
		schemaRows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", tbl))
		if err != nil {
			continue
		}

		var fullColumns []ColumnInfo

		for schemaRows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dflt interface{}

			schemaRows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk)

			// Fallback if SQLite returns empty type
			if ctype == "" {
				ctype = "VARCHAR"
			}

			fullColumns = append(fullColumns, ColumnInfo{
				Name: name,
				Type: ctype, // This now comes from the DB definition, not a guess!
			})
		}
		schemaRows.Close()

		// --- STEP B: Get Data (Rows) ---
		dataRows, err := db.Query(fmt.Sprintf("SELECT * FROM %s", tbl))
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
						// Convert bytes to string for JSON safety
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

		tables = append(tables, TableInfo{
			Name:    tbl,
			Columns: fullColumns, // Uses the PRAGMA types
			Rows:    tableData,
		})
	}

	// --- STEP C: Calculate Relationships (Foreign Keys) ---
	relationships := []Relationship{}
	for _, sourceTbl := range tables {
		for _, col := range sourceTbl.Columns {
			if strings.HasSuffix(col.Name, "_id") {
				targetTblName := strings.TrimSuffix(col.Name, "_id")
				// Check if target table actually exists
				for _, targetTbl := range tableNames {
					if targetTbl == targetTblName || targetTbl == targetTblName+"s" {
						relationships = append(relationships, Relationship{
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

// inferColumnType analyzes a list of values to guess the SQL type
func inferColumnType(values []string) string {
	if len(values) == 0 {
		return "VARCHAR"
	}

	isInt := true
	isFloat := true
	isBool := true
	hasData := false // <--- NEW: Track if we actually saw data

	// Regex for checking formats
	intRegex := regexp.MustCompile(`^-?\d+$`)
	floatRegex := regexp.MustCompile(`^-?\d*\.\d+$`)

	for _, v := range values {
		if v == "" {
			continue
		} // Skip empty cells
		hasData = true // <--- Mark that we found a value

		// Check Integer
		if !intRegex.MatchString(v) {
			isInt = false
		}

		// Check Float
		if !floatRegex.MatchString(v) && !intRegex.MatchString(v) {
			isFloat = false
		}

		// Check Boolean
		lowerV := strings.ToLower(v)
		if lowerV != "true" && lowerV != "false" && lowerV != "0" && lowerV != "1" && lowerV != "yes" && lowerV != "no" {
			isBool = false
		}
	}

	// FIX: If the column is completely empty, default to Text (VARCHAR)
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

// handleAddColumn executes ALTER TABLE
func handleAddColumn(c *gin.Context) {
	var req AddColumnRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	// Sanitize inputs to prevent SQL Injection (Basic)
	tableName := strings.ReplaceAll(req.TableName, " ", "_")
	colName := strings.ReplaceAll(req.ColumnName, " ", "_")
	colType := strings.ToUpper(req.ColumnType)

	// Validate Type (Allow only safe types)
	validTypes := map[string]bool{"VARCHAR": true, "INT": true, "DECIMAL": true, "REAL": true, "BOOLEAN": true}
	if !validTypes[colType] {
		// Default to TEXT if invalid
		colType = "VARCHAR"
	}

	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", tableName, colName, colType)

	if _, err := db.Exec(query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Column added successfully"})
}

// handleExportCSV streams the table data as a CSV file
func handleExportCSV(c *gin.Context) {
	tableName := c.Param("tableName")

	// Query all data
	rows, err := db.Query(fmt.Sprintf("SELECT * FROM %s", tableName))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Table not found"})
		return
	}
	defer rows.Close()

	// Set headers for file download
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%s.csv", tableName))
	c.Header("Content-Type", "text/csv")

	// Create CSV Writer pointing to the response writer
	writer := csv.NewWriter(c.Writer)

	// 1. Write Header
	cols, _ := rows.Columns()
	writer.Write(cols)

	// 2. Write Rows
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
				// Convert everything to string for CSV
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
