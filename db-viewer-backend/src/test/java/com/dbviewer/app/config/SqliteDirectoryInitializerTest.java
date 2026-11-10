package com.dbviewer.app.config;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** The application database's folder is created before the connection pool needs it. */
class SqliteDirectoryInitializerTest {

    @TempDir Path temp;

    private void run(String url) {
        MockEnvironment environment = new MockEnvironment().withProperty("spring.datasource.url", url);
        new SqliteDirectoryInitializer().postProcessEnvironment(environment, new SpringApplication());
    }

    @Test
    void createsAMissingFolder_includingItsParents() {
        Path target = temp.resolve("home").resolve("data");
        run("jdbc:sqlite:" + target.resolve("visualizer.db"));

        assertThat(Files.isDirectory(target)).isTrue();
        // The file itself is SQLite's job, not this one's.
        assertThat(Files.exists(target.resolve("visualizer.db"))).isFalse();
    }

    @Test
    void ignoresQueryParametersAndTheFilePrefix() {
        Path target = temp.resolve("withparams");
        run("jdbc:sqlite:file:" + target.resolve("app.db") + "?journal_mode=WAL");

        assertThat(Files.isDirectory(target)).isTrue();
    }

    @Test
    void leavesInMemoryAndOtherDatabasesAlone() {
        assertThat(SqliteDirectoryInitializer.parentDirectory("jdbc:sqlite::memory:")).isNull();
        assertThat(SqliteDirectoryInitializer.parentDirectory("jdbc:sqlite:file:x?mode=memory&cache=shared")).isNull();
        assertThat(SqliteDirectoryInitializer.parentDirectory("jdbc:mysql://localhost/db")).isNull();
        assertThat(SqliteDirectoryInitializer.parentDirectory(null)).isNull();
    }

    @Test
    void aRelativePathResolvesAgainstTheWorkingFolder() {
        assertThat(SqliteDirectoryInitializer.parentDirectory("jdbc:sqlite:./visualizer.db"))
                .isEqualTo(Path.of("./visualizer.db").toAbsolutePath().getParent());
    }
}
