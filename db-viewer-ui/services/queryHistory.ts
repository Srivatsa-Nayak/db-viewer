/**
 * The SQL panel's history: what was run against each file, most recent first.
 *
 * Per file, because a query is written against one schema and is noise in another. In this
 * browser only (localStorage), because a script can quote somebody's data — an INSERT carries
 * its values — and the server has no reason to keep that. It goes when the file is deleted, and
 * all of it goes on sign-out, the same as the open-file list. Capped in count and in size so a
 * pasted dump cannot fill the quota that the session layout also lives in.
 *
 * Every function takes the storage as an argument (defaulting to the browser's) so the rules can
 * be unit-tested without a DOM.
 */

export interface HistoryEntry {
    sql: string;
    /** When it was last run, ms since the epoch. */
    at: number;
    /** False when a statement in it failed. */
    ok: boolean;
}

const KEY = 'sql-visualizer.query-history';
export const MAX_ENTRIES = 25;
/** A script longer than this is a dump, not something anyone re-runs from a list. */
export const MAX_SQL_LENGTH = 20_000;

type Store = Record<string, HistoryEntry[]>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): StorageLike | null => {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
};

const read = (storage: StorageLike | null): Store => {
    if (!storage) return {};
    try {
        const parsed = JSON.parse(storage.getItem(KEY) ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Store : {};
    } catch {
        return {};
    }
};

const write = (storage: StorageLike | null, store: Store) => {
    if (!storage) return;
    try {
        if (Object.keys(store).length === 0) storage.removeItem(KEY);
        else storage.setItem(KEY, JSON.stringify(store));
    } catch {
        // Quota or a disabled store: history is a convenience, never worth an error.
    }
};

export const loadHistory = (workspaceId: string, storage = browserStorage()): HistoryEntry[] => {
    const entries = read(storage)[workspaceId];
    return Array.isArray(entries)
        ? entries.filter(e => e && typeof e.sql === 'string' && typeof e.at === 'number')
        : [];
};

/** Adds a run to the top. Running the same script again moves it up rather than duplicating it. */
export const recordRun = (
    workspaceId: string, sql: string, ok: boolean, storage = browserStorage(), now = Date.now(),
): HistoryEntry[] => {
    const text = sql.trim();
    if (!text || text.length > MAX_SQL_LENGTH) return loadHistory(workspaceId, storage);
    const store = read(storage);
    const previous = (store[workspaceId] ?? []).filter(e => e.sql !== text);
    const next = [{ sql: text, at: now, ok }, ...previous].slice(0, MAX_ENTRIES);
    store[workspaceId] = next;
    write(storage, store);
    return next;
};

export const forgetHistory = (workspaceId: string, storage = browserStorage()) => {
    const store = read(storage);
    if (!(workspaceId in store)) return;
    delete store[workspaceId];
    write(storage, store);
};

export const forgetAllHistory = (storage = browserStorage()) => {
    try {
        storage?.removeItem(KEY);
    } catch {
        // As above.
    }
};

/** "just now", "5 min ago", "3 h ago", then a date. */
export const describeWhen = (at: number, now = Date.now()): string => {
    const minutes = Math.round((now - at) / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(at).toLocaleDateString();
};
