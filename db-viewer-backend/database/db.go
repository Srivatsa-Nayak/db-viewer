package database

import (
	"database/sql"
	"log"
	"os"

	_ "github.com/go-sql-driver/mysql" // Import mysql driver
	_ "modernc.org/sqlite"             // Import driver here
)

// DB is a global variable accessible by other packages
var DB *sql.DB
var CurrentDriver string

// InitDB initializes the SQLite connection
func InitDB() {
	var err error

	driver := os.Getenv("DB_DRIVER")
	dsn := os.Getenv("DB_DSN") // Data Source Name (connection string)

	if driver == "" {
		driver = "sqlite"
		dsn = "./data.db"
	}

	CurrentDriver = driver

	// 2. Open Connection
	DB, err = sql.Open(driver, dsn)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatal("Database unreachable:", err)
	}

	log.Printf("Connected to %s database successfully", driver)
}
