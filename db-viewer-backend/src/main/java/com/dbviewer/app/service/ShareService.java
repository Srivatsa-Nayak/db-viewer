package com.dbviewer.app.service;

import java.util.List;
import java.util.Map;

/**
 * Read-only share links for a workspace.
 *
 * <p>A link is a random token mapped to a workspace id. Anyone holding the token can read that
 * file's schema; nobody can change it through this route. Creating and revoking a link requires
 * an account, viewing one does not — a share link nobody can open is not a share link.
 *
 * @see com.dbviewer.app.service.impl.ShareServiceImpl
 */
public interface ShareService {

    /**
     * Creates — or returns the existing — link for the workspace on the current request.
     *
     * @throws com.dbviewer.app.exception.UnauthorizedException if nobody is signed in
     * @throws IllegalArgumentException if no file is open on this request
     */
    Map<String, Object> createLink(String fileName);

    /**
     * The shared file's schema. Public on purpose — the token is the credential.
     *
     * @throws IllegalArgumentException if the token is unknown or has been revoked
     */
    Map<String, Object> viewShared(String token);

    /** Links created by the signed-in user. */
    List<Map<String, Object>> listMine();

    /**
     * Revokes one of the signed-in user's links.
     *
     * @throws IllegalArgumentException if the token is not theirs, or does not exist
     */
    void revoke(String token);

    /** Removes any links pointing at a workspace that has just been deleted. */
    void revokeForWorkspace(String workspaceId);
}
