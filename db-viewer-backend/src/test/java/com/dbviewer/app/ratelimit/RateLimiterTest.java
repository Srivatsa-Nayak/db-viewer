package com.dbviewer.app.ratelimit;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

/** The fixed-window counter behind every limit: chat quotas, logins, uploads. */
class RateLimiterTest {

    /** A clock the test moves by hand. */
    private static final class TestClock extends Clock {
        Instant now = Instant.parse("2026-11-09T10:00:00Z");

        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    private final TestClock clock = new TestClock();
    private final RateLimiter limiter = new RateLimiter(clock);
    private static final Duration MINUTE = Duration.ofMinutes(1);

    @Test
    void allowsUpToTheLimitThenRefusesWithARetryAfter() {
        for (int i = 0; i < 3; i++) {
            assertThat(limiter.tryAcquire("k", 3, MINUTE).allowed()).isTrue();
        }
        RateLimiter.Decision refused = limiter.tryAcquire("k", 3, MINUTE);

        assertThat(refused.allowed()).isFalse();
        assertThat(refused.remaining()).isZero();
        assertThat(refused.retryAfterSeconds()).isBetween(1L, 60L);
    }

    @Test
    void theWindowResets() {
        limiter.tryAcquire("k", 1, MINUTE);
        assertThat(limiter.tryAcquire("k", 1, MINUTE).allowed()).isFalse();

        clock.now = clock.now.plusSeconds(61);

        assertThat(limiter.tryAcquire("k", 1, MINUTE).allowed()).isTrue();
    }

    @Test
    void keysAreIndependent() {
        limiter.tryAcquire("a", 1, MINUTE);
        assertThat(limiter.tryAcquire("b", 1, MINUTE).allowed()).isTrue();
    }

    @Test
    void peekCountsNothingAndReleaseGivesOneBack() {
        limiter.tryAcquire("k", 2, MINUTE);
        assertThat(limiter.peek("k", 2, MINUTE).remaining()).isEqualTo(1);
        assertThat(limiter.peek("k", 2, MINUTE).remaining()).isEqualTo(1);

        limiter.release("k");

        assertThat(limiter.peek("k", 2, MINUTE).remaining()).isEqualTo(2);
    }

    @Test
    void aLimitOfZeroMeansUnlimited() {
        for (int i = 0; i < 100; i++) {
            assertThat(limiter.tryAcquire("k", 0, MINUTE).allowed()).isTrue();
        }
    }
}
