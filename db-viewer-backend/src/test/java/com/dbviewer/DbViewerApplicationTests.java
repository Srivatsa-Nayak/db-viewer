package com.dbviewer;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@TestPropertySource(properties = {
    "spring.datasource.url=jdbc:sqlite::memory:",
    "spring.datasource.driver-class-name=org.sqlite.JDBC",
    "app.db.driver=sqlite"
})
class DbViewerApplicationTests {

    @Test
    void contextLoads() {
        // Verifies Spring context starts correctly
    }
}
