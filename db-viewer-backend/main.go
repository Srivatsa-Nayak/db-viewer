package main

import (
	"fmt"
	"log"

	"db-viewer/database" // REPLACE WITH YOUR MODULE NAME
	"db-viewer/handlers" // REPLACE WITH YOUR MODULE NAME

	_ "db-viewer/docs" // Swagger docs

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	swaggerFiles "github.com/swaggo/files"
	ginSwagger "github.com/swaggo/gin-swagger"
)

// @title           Database Visualizer API
// @version         1.0
// @description     A simple API to upload CSVs to SQLite and run queries.
// @host            localhost:8080
// @BasePath        /
func main() {
	// 1. Initialize Database
	database.InitDB()
	defer database.DB.Close()

	// 2. Setup Router
	r := gin.Default()
	r.Use(cors.Default())

	// 3. Swagger
	r.GET("/swagger/*any", ginSwagger.WrapHandler(swaggerFiles.Handler))

	// 4. Register Routes (Pointing to the handlers package)
	r.POST("/upload", handlers.HandleFileUpload)
	r.POST("/query", handlers.HandleQuery)
	r.GET("/db-info", handlers.HandleGetDBInfo)
	r.POST("/alter-table", handlers.HandleAddColumn)
	r.GET("/export/:tableName", handlers.HandleExportCSV)
	r.POST("/update-cell", handlers.HandleUpdateCell)
	r.GET("/table-data/:tableName", handlers.HandleGetTableData)
	r.POST("/insert-row", handlers.HandleInsertRow)
	r.POST("/delete-row", handlers.HandleDeleteRow)

	fmt.Println("Application running on http://localhost:8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal(err)
	}
}
