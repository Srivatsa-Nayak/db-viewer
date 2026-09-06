package com.dbviewer.share;

import com.dbviewer.auth.AuthContext;
import com.dbviewer.service.impl.DatabaseServiceImpl;
import com.dbviewer.workspace.WorkspaceContext;
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
public class ShareService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbcTemplate;
    private final DatabaseServiceImpl databaseService;

    /** Creates (or reuses) a link for the workspace on the current request. */
    public Map<String, Object> createLink(String fileName) {
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
        jdbcTemplate.update(
                "INSERT INTO shared_links (token, workspace_id, file_name, owner_email, created_at) "
                        + "VALUES (?, ?, ?, ?, ?)",
                token, workspaceId, fileName, owner, Instant.now().toString());

        log.info("Created share link for workspace {} by {}", workspaceId, owner);
        return describe(token, workspaceId, fileName, owner);
    }

    /** The shared file's schema. Public on purpose - the token is the credential. */
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
    public List<Map<String, Object>> listMine() {
        String owner = AuthContext.require();
        return jdbcTemplate.queryForList(
                "SELECT token, workspace_id, file_name, created_at FROM shared_links "
                        + "WHERE owner_email = ? ORDER BY created_at DESC", owner);
    }

    public void revoke(String token) {
        String owner = AuthContext.require();
        int removed = jdbcTemplate.update(
                "DELETE FROM shared_links WHERE token = ? AND owner_email = ?", token, owner);
        if (removed == 0) {
            throw new IllegalArgumentException("No such share link.");
        }
    }

    /** Removes any links pointing at a workspace that has just been deleted. */
    public void revokeForWorkspace(String workspaceId) {
        try {
            jdbcTemplate.update("DELETE FROM shared_links WHERE workspace_id = ?", workspaceId);
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

    private String findExistingToken(String workspaceId, String owner) {
        try {
            return jdbcTemplate.queryForObject(
                    "SELECT token FROM shared_links WHERE workspace_id = ? AND owner_email = ?",
                    String.class, workspaceId, owner);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private Map<String, Object> findLink(String token) {
        try {
            return jdbcTemplate.queryForMap("SELECT * FROM shared_links WHERE token = ?", token);
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
