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
            log.info("Database initialized successfully. Driver: {}", dbDriver);
        } catch (Exception e) {
            log.warn("Warning: Failed to initialize default tables: {}", e.getMessage());
        }
    }

    public String getCurrentDriver() {
        return dbDriver;
    }
}
