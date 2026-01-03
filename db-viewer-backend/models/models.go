package models

// ColumnInfo represents metadata for a single column
type ColumnInfo struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// TableInfo represents the full schema and data of a table
type TableInfo struct {
	Name    string                   `json:"name"`
	Columns []ColumnInfo             `json:"columns"`
	Rows    []map[string]interface{} `json:"rows"`
}

// Relationship represents a foreign key link
type Relationship struct {
	SourceTable  string `json:"source_table"`
	TargetTable  string `json:"target_table"`
	SourceColumn string `json:"source_column"`
}

// AddColumnRequest is the payload for adding a column
type AddColumnRequest struct {
	TableName  string `json:"table_name"`
	ColumnName string `json:"column_name"`
	ColumnType string `json:"column_type"`
}

// UpdateCellRequest is the payload for editing a cell
type UpdateCellRequest struct {
	TableName  string `json:"table_name"`
	RecordID   string `json:"record_id"`
	ColumnName string `json:"column_name"`
	NewValue   string `json:"new_value"`
}

// QueryRequest defines the body for SQL queries
type QueryRequest struct {
	Query string `json:"query" example:"SELECT * FROM users"`
}

// InsertRowRequest is the payload for creating an empty row
type InsertRowRequest struct {
	TableName string `json:"table_name"`
}

// DeleteRowRequest is the payload for deleting a row
type DeleteRowRequest struct {
	TableName string `json:"table_name"`
	RecordID  string `json:"record_id"`
}
