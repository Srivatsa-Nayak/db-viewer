package com.dbviewer.app.workspace;

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
 *
 * <p>Also binds {@code X-Client-Id} to {@link ClientContext}. That is what gives an anonymous
 * visitor an identity, so {@link WorkspaceOwnershipFilter} can keep two signed-out browsers
 * from seeing each other's files. It is bound here rather than in its own filter because it is
 * needed for exactly the same requests, and the two together define "whose request is this".
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class WorkspaceFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Workspace-Id";
    public static final String QUERY_PARAM = "workspaceId";
    public static final String CLIENT_HEADER = "X-Client-Id";
    public static final String CLIENT_QUERY_PARAM = "clientId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String workspaceId = request.getHeader(HEADER);
        if (workspaceId == null || workspaceId.isBlank()) {
            workspaceId = request.getParameter(QUERY_PARAM);
        }

        String clientId = request.getHeader(CLIENT_HEADER);
        if (clientId == null || clientId.isBlank()) {
            clientId = request.getParameter(CLIENT_QUERY_PARAM);
        }
        ClientContext.set(clientId);

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
            // Request threads are pooled, so anything left bound here would leak into whoever
            // the thread serves next.
            WorkspaceContext.clear();
            ClientContext.clear();
        }
    }
}
