package com.dbviewer.config;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Database initialization - mirrors Go database.InitDB()
 * Creates default 'users' table on startup if it doesn't exist.
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class DatabaseConfig {

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.db.driver:sqlite}")
    private String dbDriver;

    @PostConstruct
    public void init() {
        try {
            String createUsers = """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT
                    )
                    """;
            jdbcTemplate.execute(createUsers);
            createApplicationTables();
            log.info("Database initialized successfully. Driver: {}", dbDriver);
        } catch (Exception e) {
            log.warn("Warning: Failed to initialize default tables: {}", e.getMessage());
        }
    }

    /**
     * Tables the application itself owns, as opposed to the user's data.
     *
     * <p>These live in the default database rather than in a workspace: an account and the links
     * it has shared exist across every file the user opens, not inside one of them.
     */
    private void createApplicationTables() {
        String autoIncrementKey = "mysql".equalsIgnoreCase(dbDriver)
                ? "INT AUTO_INCREMENT PRIMARY KEY"
                : "INTEGER PRIMARY KEY AUTOINCREMENT";

        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS app_users (
                    id %s,
                    email VARCHAR(320) NOT NULL UNIQUE,
                    display_name VARCHAR(120),
                    password_hash VARCHAR(120) NOT NULL,
                    created_at VARCHAR(40) NOT NULL
                )
                """.formatted(autoIncrementKey));

        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS shared_links (
                    token VARCHAR(64) NOT NULL PRIMARY KEY,
                    workspace_id VARCHAR(64) NOT NULL,
                    file_name VARCHAR(255),
                    owner_email VARCHAR(320) NOT NULL,
                    created_at VARCHAR(40) NOT NULL
                )
                """);
    }

    public String getCurrentDriver() {
        return dbDriver;
    }
}
