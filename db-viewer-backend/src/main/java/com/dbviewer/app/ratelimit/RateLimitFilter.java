package com.dbviewer.app.ratelimit;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;

/**
 * Per-address request limits, ahead of everything but CORS.
 *
 * <p>There were none. Signing in could be brute-forced, accounts created by the thousand, and
 * the import and raw-SQL endpoints driven as hard as a script could manage — against a single
 * free-tier instance. The limits are generous enough that a person never meets them; they exist
 * for the script.
 *
 * <p>Runs after the CORS filter, so a refusal still carries {@code Access-Control-Allow-Origin}
 * and the browser can show the 429 instead of an opaque network failure — the same constraint
 * every short-circuiting filter here has.
 *
 * <h2>Which address</h2>
 *
 * <p>Behind Azure App Service (or any reverse proxy) every request arrives from the proxy, so the
 * client is read from {@code X-Forwarded-For}. The <em>last</em> entry is used: that is the one
 * the proxy appended, while anything before it was supplied by the client and could be anything.
 * Set {@code app.ratelimit.trust-forwarded-for=false} when the app is reachable directly, or a
 * client could pick its own key.
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
@RequiredArgsConstructor
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Duration MINUTE = Duration.ofMinutes(1);
    private static final Duration HOUR = Duration.ofHours(1);

    private final RateLimiter limiter;

    @Value("${app.ratelimit.enabled:true}")
    private boolean enabled;

    @Value("${app.ratelimit.trust-forwarded-for:true}")
    private boolean trustForwardedFor;

    @Value("${app.ratelimit.login-per-10-minutes:20}")
    private int loginPerTenMinutes;

    @Value("${app.ratelimit.signup-per-hour:20}")
    private int signupPerHour;

    @Value("${app.ratelimit.import-per-hour:60}")
    private int importPerHour;

    @Value("${app.ratelimit.sql-per-minute:120}")
    private int sqlPerMinute;

    @Value("${app.ratelimit.general-per-minute:1200}")
    private int generalPerMinute;

    /** One rule: a namespace for the key, a limit and a window. */
    private record Rule(String name, int limit, Duration window) {
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        if (!enabled || "OPTIONS".equalsIgnoreCase(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }

        String client = clientAddress(request);
        Rule specific = ruleFor(request.getMethod(), request.getRequestURI());
        Rule general = new Rule("all", generalPerMinute, MINUTE);

        for (Rule rule : specific == null ? new Rule[]{general} : new Rule[]{specific, general}) {
            RateLimiter.Decision decision =
                    limiter.tryAcquire(rule.name() + ":ip:" + client, rule.limit(), rule.window());
            if (!decision.allowed()) {
                log.info("Rate limit {} reached for {} on {} {}", rule.name(), client,
                        request.getMethod(), request.getRequestURI());
                refuse(response, decision.retryAfterSeconds());
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private Rule ruleFor(String method, String path) {
        if (!"POST".equalsIgnoreCase(method)) {
            return null;
        }
        return switch (path) {
            case "/auth/login" -> new Rule("login", loginPerTenMinutes, Duration.ofMinutes(10));
            case "/auth/signup" -> new Rule("signup", signupPerHour, HOUR);
            case "/upload", "/import/analyze" -> new Rule("import", importPerHour, HOUR);
            case "/scratchpad", "/query" -> new Rule("sql", sqlPerMinute, MINUTE);
            default -> null;
        };
    }

    String clientAddress(HttpServletRequest request) {
        if (trustForwardedFor) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                String[] hops = forwarded.split(",");
                String last = hops[hops.length - 1].trim();
                if (!last.isEmpty()) {
                    return last;
                }
            }
        }
        return request.getRemoteAddr();
    }

    private void refuse(HttpServletResponse response, long retryAfterSeconds) throws IOException {
        response.setStatus(429);
        response.setHeader("Retry-After", String.valueOf(retryAfterSeconds));
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"error\":\"Too many requests. Try again in "
                + retryAfterSeconds + " seconds.\",\"retryAfter\":" + retryAfterSeconds + "}");
    }
}
