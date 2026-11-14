package com.dbviewer.app.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * The response headers every API answer carries, whatever handled it.
 *
 * <p>Set <em>before</em> the chain runs, so a request that a later filter refuses (rate limit,
 * a bad workspace id, somebody else's workspace) still gets them — the same reason CORS runs
 * first. Ordered straight after CORS.
 *
 * <ul>
 *   <li>{@code X-Content-Type-Options: nosniff} — a JSON body is never run as a script.</li>
 *   <li>{@code X-Frame-Options: DENY} — nothing here, Swagger UI included, is meant to be framed.</li>
 *   <li>{@code Referrer-Policy: no-referrer} — URLs here can carry a share token or a
 *       workspace id, and neither should leak to another site.</li>
 *   <li>{@code Cache-Control: no-store} — workspace data is somebody's schema and rows, and must
 *       not be kept by the browser or a proxy. It is also what makes the UI's {@code ?_t=}
 *       cache-busting unnecessary. A handler that chooses its own caching (the template
 *       catalogue) replaces it rather than adding a second header.</li>
 *   <li>{@code Strict-Transport-Security} — only when the request arrived over HTTPS, which on
 *       Azure means the front end says so in {@code X-Forwarded-Proto}; on plain-HTTP localhost a
 *       browser ignores it anyway.</li>
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class SecurityHeadersFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        if (request.isSecure() || "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"))) {
            response.setHeader("Strict-Transport-Security", "max-age=31536000");
        }
        chain.doFilter(request, new CacheControlOverridable(response));
    }

    /**
     * Lets a handler's own {@code Cache-Control} replace the default instead of sitting beside
     * it. Spring writes a {@code ResponseEntity}'s headers with {@code addHeader}, which would
     * otherwise send {@code no-store} and {@code max-age=600} together.
     */
    private static final class CacheControlOverridable extends HttpServletResponseWrapper {
        CacheControlOverridable(HttpServletResponse response) {
            super(response);
        }

        @Override
        public void addHeader(String name, String value) {
            if (HttpHeaders.CACHE_CONTROL.equalsIgnoreCase(name)) {
                super.setHeader(name, value);
            } else {
                super.addHeader(name, value);
            }
        }
    }
}
