package com.dbviewer.app.service;

import com.dbviewer.app.auth.AuthContext;
import com.dbviewer.app.common.Constants;
import com.dbviewer.app.dto.ColumnDefinition;
import com.dbviewer.app.dto.CreateTableRequest;
import com.dbviewer.app.service.impl.DatabaseServiceImpl;
import com.dbviewer.app.workspace.WorkspaceContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Sharing a file that already has more than one link.
 *
 * <p>"One link per file per owner" is the intent, but nothing in the schema enforces it and the
 * check-then-insert that implements it is not atomic — two quick clicks can both find nothing and
 * both insert. When that happened, every later attempt to share that file returned a 500:
 * {@code queryForObject} throws on two rows, and the {@code EmptyResultDataAccessException} the
 * code caught is a *subclass* of that exception, so "no link" was handled and "two links" was not.
 */
@SpringBootTest
@TestPropertySource(properties = {
        // A *named, shared-cache* in-memory database, unlike the plain `:memory:` the other
        // suites use. Plain `:memory:` gives every connection its own empty database, so the
        // moment a test touches more than one thread the pool hands out a connection where
        // `shared_links` does not exist. The concurrency test below needs several callers to see
        // one database, which is the whole point of it.
        "spring.datasource.url=jdbc:sqlite:file:sharedupes?mode=memory&cache=shared",
        "spring.datasource.driver-class-name=org.sqlite.JDBC",
        "app.db.driver=sqlite"
})
class ShareDuplicateLinkTest {

    private static final String OWNER = "dupes@example.com";

    @Autowired
    private ShareService shareService;

    @Autowired
    private DatabaseServiceImpl databaseService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private String workspace;

    @BeforeEach
    void openWorkspace() {
        workspace = "sharedup" + UUID.randomUUID().toString().replace("-", "");
        WorkspaceContext.set(workspace);
        AuthContext.set(OWNER);
        databaseService.createTable(new CreateTableRequest("widgets", List.of(
                new ColumnDefinition("id", "INT", 0, true, false, null, null))));
    }

    @AfterEach
    void closeWorkspace() {
        jdbcTemplate.update("DELETE FROM shared_links WHERE workspace_id = ?", workspace);
        databaseService.deleteWorkspace();
        AuthContext.clear();
        WorkspaceContext.clear();
    }

    /** Inserts a link directly, bypassing the service's own de-duplication. */
    private void insertLink(String token, String createdAt) {
        jdbcTemplate.update(Constants.Share.INSERT_LINK,
                token, workspace, "widgets.sql", OWNER, createdAt);
    }

    @Test
    void twoLinksForOneFile_shouldNotBreakSharing() {
        insertLink("tokenOLDER", "2020-01-01T00:00:00Z");
        insertLink("tokenNEWER", "2024-01-01T00:00:00Z");

        Map<String, Object> result = shareService.createLink("widgets.sql");

        // The oldest wins: it is the one most likely to be in somebody's inbox already.
        assertThat(result).containsEntry("token", "tokenOLDER");
    }

    @Test
    void duplicates_shouldNotBeDeleted() {
        insertLink("tokenOLDER", "2020-01-01T00:00:00Z");
        insertLink("tokenNEWER", "2024-01-01T00:00:00Z");

        shareService.createLink("widgets.sql");

        // Revoking a link somebody already has, silently, to tidy up a duplicate would be a
        // worse outcome than the duplicate.
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM shared_links WHERE workspace_id = ?", Integer.class, workspace);
        assertThat(count).isEqualTo(2);
        assertThatCode(() -> shareService.viewShared("tokenNEWER")).doesNotThrowAnyException();
    }

    @Test
    void repeatedSharing_shouldReuseOneLink() {
        String first = String.valueOf(shareService.createLink("widgets.sql").get("token"));
        String second = String.valueOf(shareService.createLink("widgets.sql").get("token"));

        assertThat(second).isEqualTo(first);
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM shared_links WHERE workspace_id = ?", Integer.class, workspace);
        assertThat(count).isEqualTo(1);
    }

    /**
     * The race that produced the duplicates in the first place.
     *
     * <p>Opening the share dialog fires the request twice under React's development double-invoke,
     * and a double-click does the same in production. Both calls used to pass the "does a link
     * exist?" check before either inserted, leaving two tokens for one file — after which the
     * dialog showed one link on first open and a different one on every open after.
     */
    @Test
    void concurrentSharing_shouldStillProduceOneLink() throws Exception {
        int callers = 8;
        ExecutorService pool = Executors.newFixedThreadPool(callers);
        CountDownLatch startLine = new CountDownLatch(1);
        try {
            List<Future<String>> results = new ArrayList<>();
            for (int i = 0; i < callers; i++) {
                results.add(pool.submit(() -> {
                    // The contexts are thread-locals, so each caller binds its own.
                    WorkspaceContext.set(workspace);
                    AuthContext.set(OWNER);
                    try {
                        startLine.await();
                        return String.valueOf(shareService.createLink("widgets.sql").get("token"));
                    } finally {
                        AuthContext.clear();
                        WorkspaceContext.clear();
                    }
                }));
            }
            startLine.countDown();

            Set<String> tokens = new HashSet<>();
            for (Future<String> result : results) {
                tokens.add(result.get(20, TimeUnit.SECONDS));
            }

            // Every caller saw the same link, and only one was ever written.
            assertThat(tokens).hasSize(1);
            Integer count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM shared_links WHERE workspace_id = ?",
                    Integer.class, workspace);
            assertThat(count).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void aSharedView_shouldCarryColoursAndGroups() {
        databaseService.setCanvasMeta("table", "widgets", "{\"colour\":\"rose\"}");
        databaseService.setCanvasMeta("group", "g1",
                "{\"name\":\"Billing\",\"tables\":[\"widgets\"]}");

        String token = String.valueOf(shareService.createLink("widgets.sql").get("token"));
        Map<String, Object> shared = shareService.viewShared(token);

        // A shared diagram that drops the colours and boundaries is a worse copy of the thing
        // the sender was looking at.
        List<Map<String, Object>> meta = (List<Map<String, Object>>) shared.get("canvasMeta");
        assertThat(meta).hasSize(2);
        assertThat(meta).anySatisfy(row -> {
            assertThat(row).containsEntry("kind", "group");
            assertThat(String.valueOf(row.get("payload"))).contains("Billing");
        });
        assertThat(meta).anySatisfy(row -> assertThat(row).containsEntry("kind", "table"));
    }

    @Test
    void aSharedViewOfAnUnannotatedFile_shouldStillWork() {
        String token = String.valueOf(shareService.createLink("widgets.sql").get("token"));
        Map<String, Object> shared = shareService.viewShared(token);

        assertThat(shared).containsKey("canvasMeta");
        assertThat((List<?>) shared.get("canvasMeta")).isEmpty();
        assertThat((List<?>) shared.get("tables")).hasSize(1);
    }
}
