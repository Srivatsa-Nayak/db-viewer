package com.dbviewer.app.ratelimit;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Fixed-window request counting, in memory.
 *
 * <p>Deliberately small rather than a library. The deployment is one instance, the limits are
 * coarse (logins per minute, questions per hour), and the failure mode of a fixed window — a
 * burst of up to twice the limit straddling a boundary — is harmless at these sizes. A limit
 * that resets when the server restarts is the accepted trade: the restarts that matter are
 * deploys, not an attacker's tool. Swap in a shared store (Redis, a database table) only when
 * there is more than one instance to agree between.
 *
 * <p>Keys are namespaced by the caller ({@code "login:ip:1.2.3.4"}, {@code "chat:hour:a@b.c"}),
 * so one limiter serves every rule.
 */
@Component
public class RateLimiter {

    /** Windows older than this are dropped on the next sweep. Longer than the longest window used. */
    private static final Duration KEEP = Duration.ofDays(2);

    /** Sweep once every this many calls, so the map cannot grow without bound. */
    private static final int SWEEP_EVERY = 1_000;

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;
    private int callsSinceSweep;

    public RateLimiter() {
        this(Clock.systemUTC());
    }

    RateLimiter(Clock clock) {
        this.clock = clock;
    }

    /**
     * The outcome of a check.
     *
     * @param allowed          false when the limit is already reached
     * @param limit            the limit that applied
     * @param remaining        how many more are allowed in this window, after this call
     * @param retryAfterSeconds when {@code allowed} is false, how long until the window resets
     */
    public record Decision(boolean allowed, int limit, int remaining, long retryAfterSeconds) {
    }

    private static final class Window {
        final long startMillis;
        int count;

        Window(long startMillis) {
            this.startMillis = startMillis;
        }
    }

    /**
     * Counts one use against {@code key} if the limit allows it.
     *
     * @param limit  at most this many per window; zero or less means unlimited
     */
    public Decision tryAcquire(String key, int limit, Duration window) {
        if (limit <= 0) {
            return new Decision(true, limit, Integer.MAX_VALUE, 0);
        }
        maybeSweep();
        long now = clock.millis();
        long length = window.toMillis();
        Window[] result = new Window[1];
        boolean[] allowed = new boolean[1];
        windows.compute(key, (k, current) -> {
            Window w = current == null || now - current.startMillis >= length
                    ? new Window(now) : current;
            allowed[0] = w.count < limit;
            if (allowed[0]) {
                w.count++;
            }
            result[0] = w;
            return w;
        });
        Window w = result[0];
        long retryAfter = Math.max(1, (w.startMillis + length - now + 999) / 1000);
        return new Decision(allowed[0], limit, Math.max(0, limit - w.count),
                allowed[0] ? 0 : retryAfter);
    }

    /** What {@link #tryAcquire} would say, without counting anything. For "N left today" in a UI. */
    public Decision peek(String key, int limit, Duration window) {
        if (limit <= 0) {
            return new Decision(true, limit, Integer.MAX_VALUE, 0);
        }
        long now = clock.millis();
        Window w = windows.get(key);
        int used = w == null || now - w.startMillis >= window.toMillis() ? 0 : w.count;
        return new Decision(used < limit, limit, Math.max(0, limit - used), 0);
    }

    /** Gives one use back — for a request that was counted but then refused for another reason. */
    public void release(String key) {
        windows.computeIfPresent(key, (k, w) -> {
            w.count = Math.max(0, w.count - 1);
            return w;
        });
    }

    private void maybeSweep() {
        if (++callsSinceSweep < SWEEP_EVERY) {
            return;
        }
        callsSinceSweep = 0;
        long cutoff = clock.millis() - KEEP.toMillis();
        Iterator<Map.Entry<String, Window>> it = windows.entrySet().iterator();
        while (it.hasNext()) {
            if (it.next().getValue().startMillis < cutoff) {
                it.remove();
            }
        }
    }
}
