package com.dbviewer.app.exception;

/**
 * Thrown when a caller addresses a workspace that belongs to somebody else. Maps to 403.
 *
 * <p>Distinct from {@link UnauthorizedException} (401, "you need an account") on purpose: this
 * one means the caller is perfectly well identified and simply does not own the thing they asked
 * for, so signing in again would not help.
 */
public class WorkspaceForbiddenException extends RuntimeException {

    private final String workspaceId;

    public WorkspaceForbiddenException(String workspaceId) {
        super("This file belongs to a different session. Open your own files from the explorer.");
        this.workspaceId = workspaceId;
    }

    public String getWorkspaceId() {
        return workspaceId;
    }
}
