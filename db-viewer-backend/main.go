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

	r.POST("/upload", handleFileUpload)
	r.POST("/query", handleQuery)
	r.GET("/db-info", handleGetDBInfo)

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
	// 1. Get all table names (Same as before)
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table'")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	tables := []TableInfo{}
	var tableNames []string

	for rows.Next() {
		var name string
		rows.Scan(&name)
		tableNames = append(tableNames, name)
	}
	rows.Close()

	// 2. Loop through tables to get Columns and Data
	for _, tbl := range tableNames {
		// Get Data
		dataRows, err := db.Query(fmt.Sprintf("SELECT * FROM %s", tbl))
		if err != nil {
			continue
		}

		colNames, _ := dataRows.Columns()
		var tableData []map[string]interface{}

		// We need to store raw string values column-wise to perform inference
		// Map: ColumnName -> List of values
		columnValues := make(map[string][]string)

		for dataRows.Next() {
			// ... (Scanning logic same as before) ...
			values := make([]interface{}, len(colNames))
			valuePtrs := make([]interface{}, len(colNames))
			for i := range colNames {
				valuePtrs[i] = &values[i]
			}
			dataRows.Scan(valuePtrs...)

			entry := make(map[string]interface{})
			for i, col := range colNames {
				val := values[i]
				var strVal string

				b, ok := val.([]byte)
				if ok {
					strVal = string(b)
				} else if val != nil {
					strVal = fmt.Sprintf("%v", val)
				}

				entry[col] = strVal
				// Collect values for inference
				columnValues[col] = append(columnValues[col], strVal)
			}
			tableData = append(tableData, entry)
		}
		dataRows.Close()

		// 3. Build Column Info with Inferred Types
		var fullColumns []ColumnInfo
		for _, colName := range colNames {
			inferred := inferColumnType(columnValues[colName])
			fullColumns = append(fullColumns, ColumnInfo{
				Name: colName,
				Type: inferred,
			})
		}

		tables = append(tables, TableInfo{
			Name:    tbl,
			Columns: fullColumns, // Now sending Typed columns
			Rows:    tableData,
		})
	}

	// ... (Relationship logic stays the same) ...
	// Note: Ensure you update your relationship logic if it relied on 'Columns' being []string.
	// Since we changed TableInfo.Columns to []ColumnInfo, you might need to loop differently.

	// UPDATED RELATIONSHIP LOOP:
	relationships := []Relationship{}
	for _, sourceTbl := range tables {
		for _, col := range sourceTbl.Columns {
			if strings.HasSuffix(col.Name, "_id") { // changed col -> col.Name
				targetTblName := strings.TrimSuffix(col.Name, "_id")
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

func inferColumnType(values []string) string {
	if len(values) == 0 {
		return "VARCHAR"
	}

	isInt := true
	isFloat := true
	isBool := true

	// Regex for checking formats
	intRegex := regexp.MustCompile(`^-?\d+$`)
	floatRegex := regexp.MustCompile(`^-?\d*\.\d+$`)

	for _, v := range values {
		if v == "" {
			continue
		} // Skip empty cells

		// Check Integer
		if !intRegex.MatchString(v) {
			isInt = false
		}

		// Check Float (if it's already not an int, it might be a float)
		if !floatRegex.MatchString(v) && !intRegex.MatchString(v) {
			isFloat = false
		}

		// Check Boolean
		lowerV := strings.ToLower(v)
		if lowerV != "true" && lowerV != "false" && lowerV != "0" && lowerV != "1" && lowerV != "yes" && lowerV != "no" {
			isBool = false
		}
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
