package database

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql"
	_ "modernc.org/sqlite"
)

var DB *sql.DB
var CurrentDriver string

// InitDB initializes the SQLite connection
func InitDB() {
	var err error

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "/tmp/visualizer.db"
	}
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	createTableQuery := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT
	);`
	if _, err := DB.Exec(createTableQuery); err != nil {
		log.Printf("Warning: Failed to initialize default tables: %v", err)
	}

	CurrentDriver = "sqlite"
	log.Println("Database initialized successfully.")
}
