package com.dbviewer.app.workspace;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Housekeeping for workspaces, on a timer.
 *
 * <p>Two jobs, both of which used to be nobody's:
 *
 * <ul>
 *   <li><b>Connections.</b> Every open workspace holds a connection (a pool on MySQL), and the
 *       cache of them only grew. Ones idle for {@code app.workspace.idle-close-minutes} are
 *       closed, and the oldest beyond {@code app.workspace.max-open} too; the next request for
 *       one simply reopens it.</li>
 *   <li><b>Abandoned files.</b> A signed-out visitor's files belong to one browser, and when that
 *       browser's storage is cleared nothing can ever reach them again — yet their databases
 *       stayed on disk for ever. Anonymous workspaces unused for
 *       {@code app.workspace.anonymous-retention-days} are deleted. A signed-in user's files are
 *       never swept: an account can always come back for them.</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkspaceJanitor {

    private final WorkspaceManager workspaceManager;
    private final WorkspaceOwnershipService ownershipService;
    private final JdbcTemplate appDb;

    @Value("${app.workspace.idle-close-minutes:30}")
    private long idleCloseMinutes;

    @Value("${app.workspace.max-open:200}")
    private int maxOpen;

    /** Zero turns the sweep off. */
    @Value("${app.workspace.anonymous-retention-days:30}")
    private int anonymousRetentionDays;

    @Scheduled(initialDelayString = "${app.workspace.janitor-initial-delay-ms:600000}",
            fixedDelayString = "${app.workspace.janitor-interval-ms:900000}")
    public void run() {
        try {
            workspaceManager.evictIdle(Duration.ofMinutes(idleCloseMinutes), maxOpen);
        } catch (Exception e) {
            log.warn("Closing idle workspaces failed: {}", e.getMessage());
        }
        try {
            sweepAbandoned();
        } catch (Exception e) {
            log.warn("Sweeping abandoned workspaces failed: {}", e.getMessage());
        }
    }

    /** @return the ids deleted */
    public List<String> sweepAbandoned() {
        if (anonymousRetentionDays <= 0) {
            return List.of();
        }
        String cutoff = Instant.now().minus(Duration.ofDays(anonymousRetentionDays)).toString();
        List<String> stale = appDb.queryForList(
                Constants.Ownership.SELECT_STALE_ANONYMOUS, String.class, cutoff);
        for (String id : stale) {
            try {
                workspaceManager.dropWorkspace(id);
                ownershipService.release(id);
            } catch (Exception e) {
                log.warn("Could not delete abandoned workspace {}: {}", id, e.getMessage());
            }
        }
        if (!stale.isEmpty()) {
            log.info("Deleted {} anonymous workspace(s) unused for {} days",
                    stale.size(), anonymousRetentionDays);
        }
        return stale;
    }
}
