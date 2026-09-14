package com.dbviewer.app.service.impl;

import com.dbviewer.app.common.Constants;
import com.dbviewer.app.exception.WorkspaceForbiddenException;
import com.dbviewer.app.service.WorkspaceOwnershipService;
import com.dbviewer.app.workspace.OwnerKey;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Set;

/** @see WorkspaceOwnershipService */
@Slf4j
@Service
@RequiredArgsConstructor
public class WorkspaceOwnershipServiceImpl implements WorkspaceOwnershipService {

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void claimOrVerify(String workspaceId) {
        if (workspaceId == null || workspaceId.isBlank()) {
            return;
        }

        String owner = OwnerKey.current();
        String existing = findOwner(workspaceId);

        if (existing == null) {
            // Unclaimed. An identified caller takes it; an anonymous-but-unidentified one
            // (curl, Swagger) uses it without claiming, so direct API use keeps working
            // without letting a missing header become a way around the check.
            if (owner != null) {
                claim(workspaceId, owner);
            }
            return;
        }

        if (!existing.equals(owner)) {
            log.debug("Refused workspace {} to {}", workspaceId, owner == null ? "an unidentified caller" : owner);
            throw new WorkspaceForbiddenException(workspaceId);
        }
    }

    private void claim(String workspaceId, String owner) {
        try {
            jdbcTemplate.update(Constants.Ownership.INSERT_OWNER,
                    workspaceId, owner, Instant.now().toString());
            log.info("Workspace {} claimed by {}", workspaceId, owner);
        } catch (DataAccessException e) {
            // Two requests for a brand new workspace can race here — the UI fires the upload and
            // the schema read back to back. The primary key settles it; re-read and let the
            // loser be judged against whatever actually landed rather than failing outright.
            String winner = findOwner(workspaceId);
            if (winner == null || !winner.equals(owner)) {
                throw new WorkspaceForbiddenException(workspaceId);
            }
        }
    }

    @Override
    public List<String> listOwned(List<String> existingWorkspaceIds) {
        String owner = OwnerKey.current();
        if (owner == null) {
            // No identity, so nothing is "yours". Returning everything here would hand a caller
            // the one thing the ids were protecting.
            return List.of();
        }

        Set<String> owned = Set.copyOf(
                jdbcTemplate.queryForList(Constants.Ownership.SELECT_WORKSPACES_BY_OWNER, String.class, owner));

        // Intersected with what is actually on disk: an owner row can outlive its database if
        // the data directory was wiped, and the UI uses this list to decide what still exists.
        return existingWorkspaceIds.stream().filter(owned::contains).toList();
    }

    @Override
    public void release(String workspaceId) {
        if (workspaceId == null || workspaceId.isBlank()) {
            return;
        }
        try {
            jdbcTemplate.update(Constants.Ownership.DELETE_OWNER, workspaceId);
        } catch (DataAccessException e) {
            // The workspace itself is already gone; a stale owner row is harmless because the
            // id can never be reissued.
            log.warn("Could not release ownership of workspace {}: {}", workspaceId, e.getMessage());
        }
    }

    @Override
    public int adoptAnonymous(String clientId, String email) {
        if (clientId == null || clientId.isBlank() || email == null || email.isBlank()) {
            return 0;
        }
        try {
            int moved = jdbcTemplate.update(Constants.Ownership.ADOPT_ANONYMOUS,
                    OwnerKey.forUser(email), OwnerKey.forAnonymous(clientId));
            if (moved > 0) {
                log.info("Adopted {} anonymous workspace(s) into {}", moved, email);
            }
            return moved;
        } catch (DataAccessException e) {
            // Never fail a sign-in over this. The account is created either way; the files stay
            // anonymous and the user can still reach them in this browser.
            log.warn("Could not adopt anonymous workspaces for {}: {}", email, e.getMessage());
            return 0;
        }
    }

    private String findOwner(String workspaceId) {
        try {
            return jdbcTemplate.queryForObject(Constants.Ownership.SELECT_OWNER, String.class, workspaceId);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }
}
