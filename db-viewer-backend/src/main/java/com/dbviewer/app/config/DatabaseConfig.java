package com.dbviewer.app.config;

import com.dbviewer.app.common.Constants;
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
            jdbcTemplate.execute(Constants.Ddl.CREATE_DEFAULT_USERS_TABLE);
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
                ? Constants.Ddl.MYSQL_AUTO_INCREMENT_PK
                : Constants.Ddl.SQLITE_AUTO_INCREMENT_PK;

        jdbcTemplate.execute(Constants.Ddl.CREATE_APP_USERS_TABLE.formatted(autoIncrementKey));

        jdbcTemplate.execute(Constants.Ddl.CREATE_SHARED_LINKS_TABLE);

        jdbcTemplate.execute(Constants.Ddl.CREATE_WORKSPACE_OWNERS_TABLE);
        try {
            jdbcTemplate.execute(Constants.Ddl.CREATE_WORKSPACE_OWNERS_INDEX);
        } catch (Exception e) {
            // An index is an optimisation, not a correctness requirement, and older MySQL
            // rejects IF NOT EXISTS here. Losing it must not stop the app booting.
            log.debug("Workspace owner index not created: {}", e.getMessage());
        }
    }

    public String getCurrentDriver() {
        return dbDriver;
    }
}
