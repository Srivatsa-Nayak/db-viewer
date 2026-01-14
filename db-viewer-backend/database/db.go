package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

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
		fmt.Println("DB_PATH not set. Using ephemeral storage: /tmp/visualizer.db")
	}

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Fatalf("Failed to create database directory '%s': %v", dir, err)
	}

	log.Printf("Connecting to SQLite at: %s", dbPath)
	DB, err = sql.Open("sqlite3", dbPath)
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
