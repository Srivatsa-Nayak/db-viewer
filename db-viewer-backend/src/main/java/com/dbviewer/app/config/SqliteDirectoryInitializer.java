package com.dbviewer.app.config;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Creates the folder the application's SQLite file lives in, before anything tries to open it.
 *
 * <p>SQLite creates a missing database <em>file</em> but not a missing directory, and the
 * connection pool opens the file before any application code runs. So pointing {@code DB_PATH}
 * at somewhere new — {@code /home/data/visualizer.db} on Azure, which is the durable place for
 * it — used to start an app whose every request failed with "path ... does not exist", until
 * someone created the folder by hand. Workspace files never had the problem:
 * {@code WorkspaceManager} creates {@code WORKSPACE_DIR} itself.
 *
 * <p>An {@link EnvironmentPostProcessor} because it has to run after the configuration (command
 * line, environment variables, properties files) is known and before the {@code DataSource}
 * exists. Registered in {@code META-INF/spring.factories}. In-memory and non-SQLite URLs are left
 * alone.
 */
public class SqliteDirectoryInitializer implements EnvironmentPostProcessor {

    private static final String PREFIX = "jdbc:sqlite:";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        Path parent = parentDirectory(environment.getProperty("spring.datasource.url"));
        if (parent == null || Files.isDirectory(parent)) {
            return;
        }
        try {
            Files.createDirectories(parent);
        } catch (IOException | SecurityException e) {
            // Not fatal here: the pool will fail to open the file and say why, which is a
            // clearer report than one thrown before logging is even set up.
            System.err.println("Could not create the database folder " + parent + ": " + e.getMessage());
        }
    }

    /** The folder of a file-backed SQLite URL, or null for anything else. */
    static Path parentDirectory(String url) {
        if (url == null || !url.startsWith(PREFIX)) {
            return null;
        }
        String file = url.substring(PREFIX.length());
        if (file.contains("mode=memory")) {
            return null;
        }
        int query = file.indexOf('?');
        if (query >= 0) {
            file = file.substring(0, query);
        }
        if (file.startsWith("file:")) {
            file = file.substring("file:".length());
        }
        if (file.isBlank() || file.startsWith(":memory:")) {
            return null;
        }
        return Path.of(file).toAbsolutePath().getParent();
    }
}
