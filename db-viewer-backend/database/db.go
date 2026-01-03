package database

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite" // Import driver here
)

// DB is a global variable accessible by other packages
var DB *sql.DB

// InitDB initializes the SQLite connection
func InitDB() {
	var err error
	DB, err = sql.Open("sqlite", ":memory:")
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatal("Failed to ping database:", err)
	}
}
