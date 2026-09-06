package com.dbviewer.workspace;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Binds the request's workspace id to {@link WorkspaceContext} for the duration of the call.
 *
 * <p>The id is read from the {@code X-Workspace-Id} header, falling back to a
 * {@code workspaceId} query parameter. The query parameter matters for the two
 * download endpoints ({@code /export/{table}} and {@code /export-sql}): those are
 * opened directly by the browser, which cannot attach custom headers.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class WorkspaceFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Workspace-Id";
    public static final String QUERY_PARAM = "workspaceId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String workspaceId = request.getHeader(HEADER);
        if (workspaceId == null || workspaceId.isBlank()) {
            workspaceId = request.getParameter(QUERY_PARAM);
        }

        if (workspaceId != null && !workspaceId.isBlank()) {
            try {
                // Validate here rather than deeper in: a bad id is a client error, and the
                // controllers translate everything they catch into a 500.
                workspaceId = WorkspaceManager.sanitize(workspaceId);
            } catch (IllegalArgumentException e) {
                response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.getWriter().write(
                        "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
                return;
            }
            WorkspaceContext.set(workspaceId);
        }

        try {
            chain.doFilter(request, response);
        } finally {
            WorkspaceContext.clear();
        }
    }
}
