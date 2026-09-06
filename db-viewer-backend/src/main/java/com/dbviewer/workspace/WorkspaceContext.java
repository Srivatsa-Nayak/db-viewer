package com.dbviewer.workspace;

/**
 * Holds the workspace id for the current request thread.
 *
 * <p>Every SQL file open in the UI is its own workspace and therefore its own
 * physical database, so two files can define the same table names without
 * colliding. The id travels on the {@code X-Workspace-Id} header (or a
 * {@code workspaceId} query parameter for browser-initiated downloads, which
 * cannot set headers) and is bound here by {@link WorkspaceFilter}.
 *
 * <p>A {@code null} id means "no workspace was supplied" and the service falls
 * back to the single default datasource configured in application.properties.
 */
public final class WorkspaceContext {

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private WorkspaceContext() {
    }

    public static void set(String workspaceId) {
        CURRENT.set(workspaceId);
    }

    public static String get() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }
}
