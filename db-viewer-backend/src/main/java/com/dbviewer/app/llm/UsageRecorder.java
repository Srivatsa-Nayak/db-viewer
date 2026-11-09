package com.dbviewer.app.llm;

import com.dbviewer.app.common.Constants;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;

/**
 * Writes the assistant's usage to the application database and logs each call.
 *
 * <p>Takes the injected {@link JdbcTemplate}, which is the application's own database — never a
 * workspace. That matters twice: usage is about accounts, not files; and this runs on the
 * streaming thread, where the request's workspace context is already gone.
 */
@Slf4j
@Component
public class UsageRecorder {

    private final JdbcTemplate appDb;
    private final Clock clock;

    @Autowired
    public UsageRecorder(JdbcTemplate appDb) {
        this(appDb, Clock.systemUTC());
    }

    UsageRecorder(JdbcTemplate appDb, Clock clock) {
        this.appDb = appDb;
        this.clock = clock;
    }

    /** Today in UTC, as the usage rows key it. */
    public String today() {
        return LocalDate.now(clock).toString();
    }

    /**
     * Records one answered question. Never throws: losing a usage row is better than losing the
     * answer the user is reading.
     */
    public void record(String email, LlmCredentials credentials, Usage usage, long millis) {
        String who = email == null || email.isBlank() ? "anonymous" : email;
        Usage u = usage == null ? Usage.NONE : usage;
        double cost = u.costUsd() == null ? 0 : u.costUsd();
        int own = credentials.ownKey() ? 1 : 0;

        // One line per call, so a spend question can be answered from the logs as well.
        log.info("llm usage user={} provider={} model={} ownKey={} input={} cached={} output={} "
                        + "costUsd={} ms={}",
                who, credentials.provider().name(), credentials.model(), credentials.ownKey(),
                u.inputTokens(), u.cachedTokens(), u.outputTokens(),
                u.costUsd() == null ? "n/a" : String.format("%.6f", u.costUsd()), millis);

        String day = today();
        try {
            int updated = appDb.update(Constants.Usage.ADD,
                    u.inputTokens(), u.outputTokens(), u.cachedTokens(), cost,
                    day, who, credentials.provider().name(), credentials.model(), own);
            if (updated == 0) {
                appDb.update(Constants.Usage.INSERT,
                        day, who, credentials.provider().name(), credentials.model(), own,
                        u.inputTokens(), u.outputTokens(), u.cachedTokens(), cost);
            }
        } catch (Exception e) {
            // Two concurrent first-calls of the day can race on the insert; the loser's row is
            // the one lost. Rare, and the log line above still has it.
            log.warn("Could not record LLM usage: {}", e.getMessage());
        }
    }

    /** Questions answered on the app's own key today, across every user. */
    public long appKeyRequestsToday() {
        try {
            Long count = appDb.queryForObject(Constants.Usage.APP_KEY_REQUESTS_ON, Long.class, today());
            return count == null ? 0 : count;
        } catch (Exception e) {
            log.debug("Could not read today's app-key usage: {}", e.getMessage());
            return 0;
        }
    }
}
