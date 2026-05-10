# DB Viewer Backend Project Overview

## Purpose

This project is a Spring Boot backend for a database visualizer API. It provides endpoints for uploading CSV or SQL files, inspecting database schemas and rows, running SQL queries, editing table data, creating tables, clearing the database, and exporting data as CSV or SQL.

The codebase appears to be a Java 17 / Spring Boot port of an earlier Go Gin backend. Several class comments and the README map Spring components back to the original Go handlers and models.

## Tech Stack

- Java 17
- Spring Boot 3.3.0
- Maven with wrapper scripts: `mvnw` and `mvnw.cmd`
- Spring Web MVC
- Spring JDBC with `JdbcTemplate`
- SQLite by default
- Optional MySQL profile
- SpringDoc OpenAPI / Swagger UI
- Lombok
- Docker and Docker Compose
- JUnit 5, MockMvc, AssertJ for tests

## Main Structure

```text
src/main/java/com/dbviewer
  DbViewerApplication.java
  config/
    CorsConfig.java
    DatabaseConfig.java
    OpenApiConfig.java
  controller/
    DatabaseController.java
    GlobalExceptionHandler.java
  dto/
    request and response DTO classes
  service/
    DatabaseService.java
    impl/DatabaseServiceImpl.java

src/main/resources
  application.properties
  application-mysql.properties
  application-prod.properties

src/test/java/com/dbviewer
  DbViewerApplicationTests.java
  controller/DatabaseControllerIntegrationTest.java
  service/DatabaseServiceImplTest.java
```

## Runtime Behavior

The application starts through `DbViewerApplication` and exposes a REST API from `DatabaseController`.

Most business logic lives in `DatabaseServiceImpl`, which uses `JdbcTemplate` directly. The service supports both SQLite and MySQL behavior by checking the configured database driver from `DatabaseConfig`.

Default persistence is SQLite using:

```properties
spring.datasource.url=jdbc:sqlite:${DB_PATH:./visualizer.db}
app.db.driver=sqlite
```

The MySQL profile switches the JDBC URL, driver, dialect, credentials, and `app.db.driver` to MySQL.

## Key Features

- Upload `.csv` files and create database tables from headers.
- Infer simple column types from CSV values.
- Upload `.sql` files and execute statements.
- Clean some MySQL-style SQL syntax before executing against SQLite.
- Execute raw SQL queries.
- Return table metadata, preview rows, and foreign key relationships.
- Add columns to existing tables.
- Update individual cells by `id`.
- Insert rows, including default/empty rows.
- Delete rows by `id`.
- Create tables with primary keys and optional foreign keys.
- Drop all user tables.
- Export one table as CSV.
- Export the full database as a SQL dump.

## API Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Health check |
| `POST` | `/upload` | Upload a CSV or SQL file |
| `POST` | `/query` | Execute a raw SQL query |
| `GET` | `/db-info` | Return table schemas, row previews, and relationships |
| `GET` | `/table-data/{tableName}` | Return columns and rows for one table |
| `POST` | `/alter-table` | Add a column to a table |
| `POST` | `/update-cell` | Update one cell by row id |
| `POST` | `/insert-row` | Insert a row |
| `POST` | `/delete-row` | Delete a row by id |
| `POST` | `/create-table` | Create a table from column definitions |
| `DELETE` | `/clear` | Drop all user tables |
| `GET` | `/export/{tableName}` | Export one table as CSV |
| `GET` | `/export-sql` | Export the database as SQL |
| `GET` | `/swagger-ui.html` | Swagger UI |
| `GET` | `/v3/api-docs` | OpenAPI JSON |

## Local Development

Run with the Maven wrapper:

```powershell
.\mvnw.cmd spring-boot:run
```

Build a JAR:

```powershell
.\mvnw.cmd clean package
```

Run the packaged application:

```powershell
java -jar target\db-viewer-1.0.0.jar
```

Default URLs:

- App health check: `http://localhost:8080/`
- Swagger UI: `http://localhost:8080/swagger-ui.html`
- OpenAPI JSON: `http://localhost:8080/v3/api-docs`

## Tests

Run all tests:

```powershell
.\mvnw.cmd test
```

The tests use an in-memory SQLite database. The test suite covers controller endpoints with MockMvc and service-level database operations.

Current notable tests:

- `DatabaseControllerIntegrationTest` covers every controller endpoint.
- `DatabaseServiceImplTest` covers CSV upload, SQL upload, querying, metadata, table changes, row changes, export, and clear behavior.

## Docker

Build and run the default SQLite container:

```powershell
docker build -t db-viewer .
docker run -p 8080:8080 -v ${PWD}\data:/data db-viewer
```

Run with Docker Compose using SQLite:

```powershell
docker-compose up app
```

Run with Docker Compose using MySQL:

```powershell
docker-compose --profile mysql up
```

The MySQL app service is exposed on host port `8081` and talks to the Compose-managed MySQL container.

## Configuration

Common environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_PATH` | `./visualizer.db` | SQLite database file path |
| `PORT` | `8080` | Server port in Docker |
| `SPRING_PROFILES_ACTIVE` | none | Use `mysql` or `prod` profiles |
| `MYSQL_HOST` | `localhost` | MySQL host |
| `MYSQL_PORT` | `3306` | MySQL port |
| `MYSQL_DB` | `dbviewer` | MySQL database |
| `MYSQL_USER` | `root` | MySQL username |
| `MYSQL_PASSWORD` | `root` | MySQL password |

## Implementation Notes

- `DatabaseController` currently depends on `DatabaseServiceImpl` directly instead of the `DatabaseService` interface.
- `DatabaseServiceImpl` builds several SQL statements dynamically. It quotes identifiers in many paths, but table and column names should still be treated carefully because raw SQL execution is an explicit feature.
- CSV parsing is implemented manually in `parseCsvLine`, even though OpenCSV is listed as a dependency.
- Query execution allows read statements such as `SELECT`, `PRAGMA`, and `SHOW`; other statements are executed as updates.
- The generated SQL dump uses database metadata plus table rows to reconstruct schema and inserts.
- The repository worktree currently appears inconsistent with Git history: Git reports old Go files as deleted and the current Spring Boot tree as untracked. Avoid cleanup or reset operations unless that migration state is intentional and has been reviewed.
