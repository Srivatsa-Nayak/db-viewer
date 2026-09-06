/**
 * Remembers which files were open, so a browser refresh does not look like data loss.
 *
 * Only lightweight metadata is stored: ids, filenames and node positions. The schema itself is
 * always re-read from the backend on restore, because the databases are the source of truth and
 * a cached copy would go stale the moment another tab or an API call changed something.
 */

const STORAGE_KEY = 'sql-visualizer.session';
const STORAGE_VERSION = 1;

export interface PersistedWorkspace {
    id: string;
    name: string;
    isImported: boolean;
    /** Canvas layout the user arranged, keyed by table name. */
    positions: Record<string, { x: number; y: number }>;
}

export interface PersistedSession {
    version: number;
    activeWorkspaceId: string | null;
    workspaces: PersistedWorkspace[];
}

/**
 * localStorage throws rather than returning null in a few real situations - Safari private
 * browsing, storage disabled by policy, quota exhausted - so every access is guarded. Losing
 * the session is a small annoyance; taking the whole app down with it is not acceptable.
 */
const safeStorage = (): Storage | null => {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        return window.localStorage;
    } catch {
        return null;
    }
};

export const loadSession = (): PersistedSession | null => {
    const storage = safeStorage();
    if (!storage) return null;

    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as PersistedSession;
        // A stored session from an older shape is discarded rather than guessed at.
        if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.workspaces)) {
            return null;
        }
        return {
            version: STORAGE_VERSION,
            activeWorkspaceId: parsed.activeWorkspaceId ?? null,
            workspaces: parsed.workspaces
                .filter(w => typeof w?.id === 'string' && typeof w?.name === 'string')
                .map(w => ({
                    id: w.id,
                    name: w.name,
                    isImported: Boolean(w.isImported),
                    positions: w.positions && typeof w.positions === 'object' ? w.positions : {},
                })),
        };
    } catch {
        return null;
    }
};

export const saveSession = (session: PersistedSession): void => {
    const storage = safeStorage();
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ ...session, version: STORAGE_VERSION }));
    } catch {
        // Quota or a disabled store - nothing useful to do, and not worth interrupting the user.
    }
};

export const clearSession = (): void => {
    const storage = safeStorage();
    if (!storage) return;
    try {
        storage.removeItem(STORAGE_KEY);
    } catch {
        // Ignore - see saveSession.
    }
};
