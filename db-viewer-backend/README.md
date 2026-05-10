# Database Visualizer — Spring Boot

A complete Spring Boot 3.3 / Java 17 port of the original Go (Gin) `db-viewer` backend.
Every route, handler, and business logic rule from the Go source has been faithfully converted.

---

## Tech Stack

| Layer        | Technology                                   |
|--------------|----------------------------------------------|
| Language     | Java 17                                       |
| Framework    | Spring Boot 3.3                              |
| Database     | SQLite (default) / MySQL                     |
| JDBC         | Spring JdbcTemplate                          |
| API Docs     | SpringDoc OpenAPI 2.5 (Swagger UI)           |
| Build        | Maven 3.9 (wrapper included)                 |
| Container    | Docker (multi-stage, Alpine JRE)             |

---

## Project Structure

```
db-viewer-springboot/
├── Dockerfile
├── docker-compose.yml
├── mvnw / mvnw.cmd                            ← Maven wrapper (no local install needed)
├── pom.xml
├── src/
│   ├── main/
│   │   ├── java/com/dbviewer/
│   │   │   ├── DbViewerApplication.java       ← Entry point  (mirrors main.go)
│   │   │   ├── config/
│   │   │   │   ├── CorsConfig.java            ← CORS         (mirrors gin-contrib/cors)
│   │   │   │   ├── DatabaseConfig.java        ← DB init      (mirrors database/db.go)
│   │   │   │   └── OpenApiConfig.java         ← Swagger
│   │   │   ├── controller/
│   │   │   │   ├── DatabaseController.java    ← All routes   (mirrors handlers.go)
│   │   │   │   └── GlobalExceptionHandler.java
│   │   │   ├── dto/
│   │   │   │   └── Dtos.java                  ← All POJOs    (mirrors models/models.go)
│   │   │   └── service/
│   │   │       └── DatabaseService.java       ← All logic    (mirrors handlers.go)
│   │   └── resources/
│   │       ├── application.properties         ← SQLite default
│   │       ├── application-mysql.properties   ← MySQL profile
│   │       └── application-prod.properties    ← Production overrides
│   └── test/
│       ├── java/com/dbviewer/
│       │   ├── DbViewerApplicationTests.java
│       │   ├── controller/
│       │   │   └── DatabaseControllerIntegrationTest.java   ← 19 MockMvc tests
│       │   └── service/
│       │       └── DatabaseServiceTest.java                 ← 16 unit tests
│       └── resources/
│           └── application-test.properties
```

---

## API Endpoints

| Method   | Path                  | Go Handler               | Description                       |
|----------|-----------------------|--------------------------|-----------------------------------|
| GET      | /                     | inline                   | Health check                      |
| POST     | /upload               | HandleFileUpload         | Upload .csv or .sql file          |
| POST     | /query                | HandleQuery              | Execute raw SQL                   |
| GET      | /db-info              | HandleGetDBInfo          | All table schemas + relationships |
| GET      | /table-data/{name}    | HandleGetTableData       | Columns + rows for a table        |
| POST     | /alter-table          | HandleAddColumn          | Add column to existing table      |
| POST     | /update-cell          | HandleUpdateCell         | Edit a single cell by record ID   |
| POST     | /insert-row           | HandleInsertRow          | Insert row (empty or with data)   |
| POST     | /delete-row           | HandleDeleteRow          | Delete row by ID                  |
| POST     | /create-table         | HandleCreateTable        | Create table with FK support      |
| DELETE   | /clear                | HandleClearDatabase      | Drop all tables                   |
| GET      | /export/{name}        | HandleExportCSV          | Download table as CSV             |
| GET      | /export-sql           | HandleExportDatabaseSQL  | Download full SQL dump            |
| GET      | /swagger-ui.html      | —                        | Interactive API docs              |

---

## Running Locally

Requirements: Java 17+ (check: `java -version`)

```bash
# Build and run using included Maven wrapper
./mvnw spring-boot:run

# Or build a JAR first
./mvnw clean package -DskipTests
java -jar target/db-viewer-1.0.0.jar
```

- App: http://localhost:8080
- Swagger UI: http://localhost:8080/swagger-ui.html
- OpenAPI JSON: http://localhost:8080/v3/api-docs

---

## Running Tests

```bash
# All 35 tests
./mvnw test

# Individual classes
./mvnw test -Dtest=DatabaseServiceTest
./mvnw test -Dtest=DatabaseControllerIntegrationTest
```

Tests use an in-memory SQLite database — no setup required.

---

## Docker

```bash
# Build and run (SQLite)
docker build -t db-viewer .
docker run -p 8080:8080 -v $(pwd)/data:/data db-viewer

# Docker Compose (SQLite)
docker-compose up app

# Docker Compose (MySQL)
docker-compose --profile mysql up
```

---

## Environment Variables

| Variable                 | Default            | Description                     |
|--------------------------|--------------------|---------------------------------|
| DB_PATH                  | ./visualizer.db    | SQLite file path                |
| PORT                     | 8080               | Server port                     |
| SPRING_PROFILES_ACTIVE   | (none)             | Set to mysql or prod            |
| MYSQL_HOST               | localhost          | MySQL host (mysql profile)      |
| MYSQL_PORT               | 3306               | MySQL port                      |
| MYSQL_DB                 | dbviewer           | MySQL database name             |
| MYSQL_USER               | root               | MySQL username                  |
| MYSQL_PASSWORD           | root               | MySQL password                  |

---

## Switching to MySQL

```bash
java -jar target/db-viewer-1.0.0.jar \
  --spring.profiles.active=mysql \
  --MYSQL_HOST=localhost \
  --MYSQL_USER=user \
  --MYSQL_PASSWORD=secret
```

---

## Go to Java Conversion Notes

| Go | Java |
|----|------|
| gin.Context JSON response | ResponseEntity<?> |
| database/sql DB.Exec | JdbcTemplate.execute / update |
| database/sql DB.Query | JdbcTemplate.queryForList |
| PRAGMA table_info | Same SQL via JdbcTemplate |
| csv.NewReader | Custom parseCsvLine (quoted-field aware) |
| gin-contrib/cors | Spring CorsFilter |
| swaggo/gin-swagger | SpringDoc OpenAPI |
| os.Getenv("DB_PATH") | ${DB_PATH:./visualizer.db} in properties |
| Multi-statement DB.Exec | Split on semicolons, execute each stmt |
