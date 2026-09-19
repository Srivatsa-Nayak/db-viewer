package com.dbviewer.app.service;

import java.util.List;

/**
 * Decides who may open which workspace.
 *
 * <p>Before this existed, a workspace id was the only thing standing between a caller and a
 * file: ids were timestamps, and anyone who guessed or reused one read and wrote somebody
 * else's tables. Every workspace is now claimed by the first identified caller to touch it, and
 * refused to everybody else.
 *
 * @see com.dbviewer.app.service.impl.WorkspaceOwnershipServiceImpl
 */
public interface WorkspaceOwnershipService {

    /**
     * Claims the workspace for the current caller, or confirms they already own it.
     *
     * <p>First touch wins. A caller with no identity at all (a bare API or Swagger call) claims
     * nothing but may still use workspaces nobody has claimed — which is what keeps the API
     * usable directly without turning the header into a security boundary.
     *
     * @throws com.dbviewer.app.exception.WorkspaceForbiddenException if somebody else owns it
     */
    void claimOrVerify(String workspaceId);

    /**
     * A workspace as the file list needs it: the id that addresses it and the name the user
     * gave it.
     *
     * @param name what the user called the file; null for a workspace claimed before names
     *             were recorded, or by a caller that never set one
     */
    record OwnedWorkspace(String id, String name) { }

    /** Workspaces the current caller owns, narrowed to those whose database still exists. */
    List<OwnedWorkspace> listOwned(List<String> existingWorkspaceIds);

    /**
     * Records the file name for a workspace the caller already owns.
     *
     * <p>The name used to exist only in the browser. That made it impossible to answer "what
     * files does this account have?" on any other machine, and signing out — which clears
     * localStorage — destroyed the only copy.
     */
    void rename(String workspaceId, String fileName);

    /** Forgets a workspace's owner. Called when the workspace itself is deleted. */
    void release(String workspaceId);

    /**
     * Re-keys a browser's anonymous workspaces onto an account, on sign-in or sign-up.
     *
     * @return how many workspaces changed hands
     */
    int adoptAnonymous(String clientId, String email);
}
