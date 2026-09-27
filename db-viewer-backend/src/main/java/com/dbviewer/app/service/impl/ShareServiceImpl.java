package com.dbviewer.app.service.impl;

import com.dbviewer.app.service.DatabaseService;
import com.dbviewer.app.service.ShareService;
import com.dbviewer.app.common.Constants;
import com.dbviewer.app.auth.AuthContext;

import com.dbviewer.app.workspace.WorkspaceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only share links for a workspace.
 *
 * <p>A link is a random token mapped to a workspace id. Anyone holding the token can read that
 * file's schema; nobody can change it through this route. Creating and revoking a link requires
 * an account, viewing one does not - a share link nobody can open is not a share link.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ShareServiceImpl implements ShareService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbcTemplate;
    private final DatabaseService databaseService;

    /**
     * Creates (or reuses) a link for the workspace on the current request.
     *
     * <p>Synchronized because "one link per file per owner" is a check-then-insert, and that is
     * not atomic: two requests can both find nothing and both insert. This is not hypothetical —
     * opening the share dialog fires the request twice under React's development double-invoke,
     * and a double-click on Share does the same in production. The result was a second token for
     * the same file, so the dialog showed one link on first open and a different one afterwards.
     *
     * <p>A lock on the singleton is the right scope for this application: one process, and a
     * call that is rare and returns in milliseconds, so the contention is not measurable. It
     * would not survive a multi-instance deployment — that would want a unique index on
     * {@code (workspace_id, owner_email)}, which cannot be added while duplicates from before
     * this fix still exist in the wild. {@link #findExistingToken} stays tolerant of them.
     */
    @Override
    public synchronized Map<String, Object> createLink(String fileName) {
        String owner = AuthContext.require();
        String workspaceId = WorkspaceContext.get();
        if (workspaceId == null || workspaceId.isBlank()) {
            throw new IllegalArgumentException("Open a file before sharing it.");
        }

        // One link per file per owner, so sharing the same file twice does not scatter tokens
        // the user then has to keep track of.
        String existing = findExistingToken(workspaceId, owner);
        if (existing != null) {
            return describe(existing, workspaceId, fileName, owner);
        }

        String token = newToken();
        jdbcTemplate.update(Constants.Share.INSERT_LINK,
                token, workspaceId, fileName, owner, Instant.now().toString());

        log.info("Created share link for workspace {} by {}", workspaceId, owner);
        return describe(token, workspaceId, fileName, owner);
    }

    /** The shared file's schema. Public on purpose - the token is the credential. */
    @Override
    public Map<String, Object> viewShared(String token) {
        Map<String, Object> link = findLink(token);
        if (link == null) {
            throw new IllegalArgumentException("This share link is no longer valid.");
        }

        String workspaceId = String.valueOf(link.get("workspace_id"));
        String previous = WorkspaceContext.get();
        try {
            // Read the shared workspace regardless of which file the viewer has open.
            WorkspaceContext.set(workspaceId);
            Map<String, Object> schema = databaseService.getDbInfo();

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("fileName", link.get("file_name"));
            result.put("sharedBy", link.get("owner_email"));
            result.put("sharedAt", link.get("created_at"));
            result.put("tables", schema.get("tables"));
            result.put("relationships", schema.get("relationships"));
            // The colours and domain groups travel with the link. They are statements about the
            // schema — which tables belong together, which are reference data — and a shared
            // diagram that drops them is a worse copy of the thing the sender was looking at.
            result.put("canvasMeta", databaseService.getCanvasMeta());
            return result;
        } finally {
            if (previous == null) {
                WorkspaceContext.clear();
            } else {
                WorkspaceContext.set(previous);
            }
        }
    }

    /** Links created by the signed-in user. */
    @Override
    public List<Map<String, Object>> listMine() {
        String owner = AuthContext.require();
        return jdbcTemplate.queryForList(Constants.Share.SELECT_LINKS_BY_OWNER, owner);
    }

    @Override
    public void revoke(String token) {
        String owner = AuthContext.require();
        int removed = jdbcTemplate.update(
                Constants.Share.DELETE_LINK_BY_TOKEN_AND_OWNER, token, owner);
        if (removed == 0) {
            throw new IllegalArgumentException("No such share link.");
        }
    }

    /** Removes any links pointing at a workspace that has just been deleted. */
    @Override
    public void revokeForWorkspace(String workspaceId) {
        try {
            jdbcTemplate.update(Constants.Share.DELETE_LINKS_BY_WORKSPACE, workspaceId);
        } catch (Exception e) {
            log.warn("Could not clean up share links for workspace {}: {}", workspaceId, e.getMessage());
        }
    }

    private Map<String, Object> describe(String token, String workspaceId, String fileName, String owner) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("token", token);
        result.put("workspaceId", workspaceId);
        result.put("fileName", fileName);
        result.put("sharedBy", owner);
        return result;
    }

    /**
     * The link this file already has, or null.
     *
     * <p>Deliberately not {@code queryForObject}. That throws
     * {@code IncorrectResultSizeDataAccessException} the moment a second row exists, and the
     * {@code EmptyResultDataAccessException} this used to catch is a *subclass* of it — so "no
     * link yet" was handled and "two links" brought sharing down with a 500. Duplicates are
     * possible because nothing in the schema forbids them: the check-then-insert below is not
     * atomic, and two quick clicks can both find nothing.
     *
     * <p>Returning the oldest keeps the answer stable across calls, and the oldest is the one a
     * user is most likely to have already sent to somebody. Nothing is deleted — every token
     * that exists still resolves, and quietly revoking one would break a link already shared.
     */
    private String findExistingToken(String workspaceId, String owner) {
        List<String> tokens = jdbcTemplate.queryForList(
                Constants.Share.SELECT_TOKENS_BY_WORKSPACE_AND_OWNER,
                String.class, workspaceId, owner);
        if (tokens.size() > 1) {
            log.warn("Workspace {} has {} share links for {}; using the oldest",
                    workspaceId, tokens.size(), owner);
        }
        return tokens.isEmpty() ? null : tokens.get(0);
    }

    private Map<String, Object> findLink(String token) {
        try {
            return jdbcTemplate.queryForMap(Constants.Share.SELECT_LINK_BY_TOKEN, token);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    /** 192 bits of randomness, URL-safe - long enough that tokens cannot be guessed. */
    private String newToken() {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
