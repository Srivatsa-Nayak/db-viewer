package com.dbviewer.app.workspace;

import com.dbviewer.app.exception.WorkspaceForbiddenException;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Refuses a request that names a workspace belonging to somebody else.
 *
 * <p>Runs after {@link WorkspaceFilter} (which resolves the id) and the auth filter (which
 * resolves the caller), because the check needs both. Doing it here rather than in each service
 * means a new endpoint is covered the moment it is written — there is no per-controller step to
 * forget, which is how the original "the id is the only protection" state came about.
 *
 * <p>{@code /share/**} is exempt: viewing a shared link is public by design, and the share
 * service switches to the shared workspace internally, after this filter has run.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 30)
@RequiredArgsConstructor
public class WorkspaceOwnershipFilter extends OncePerRequestFilter {

    private final WorkspaceOwnershipService ownershipService;

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.startsWith("/share/") || path.startsWith("/auth/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String workspaceId = WorkspaceContext.get();

        if (workspaceId != null && !workspaceId.isBlank()) {
            // A workspace is always someone's. A caller with neither a sign-in nor an
            // X-Client-Id used to be let into any workspace nobody had claimed yet, without
            // claiming it — so whoever learned a fresh id first could read and write it. Now an
            // identity is required to touch a workspace at all; a request with no workspace
            // header still works, against the shared __sandbox.
            if (OwnerKey.current() == null) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.getWriter().write("{\"error\":\"Send an X-Client-Id header (any stable "
                        + "string that identifies you) or sign in to use a workspace.\","
                        + "\"identityRequired\":true}");
                return;
            }
            try {
                ownershipService.claimOrVerify(workspaceId);
            } catch (WorkspaceForbiddenException e) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.getWriter().write(
                        "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\",\"notYourWorkspace\":true}");
                return;
            }
        }

        chain.doFilter(request, response);
    }
}
