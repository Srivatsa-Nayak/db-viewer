/**
 * A stable name for this browser, sent on every request as `X-Client-Id`.
 *
 * Workspaces belong to somebody. For a signed-in user that is their account, but almost
 * everything here works signed out — and two signed-out visitors must still not end up looking
 * at each other's files, which is exactly what happened while a workspace id was the only thing
 * identifying one.
 *
 * This is not a credential and the backend does not treat it as one; it is a name for "this
 * browser", in the same spirit as a guest cart. Anything that genuinely needs protecting
 * (export, share) still requires a real account. On sign-in the backend hands whatever this id
 * owns over to the account, so making an account never looks like losing your work.
 */

const STORAGE_KEY = 'sql-visualizer.client-id';

/** Matches the backend's `ClientContext` whitelist: letters, digits, `_` and `-`, max 64. */
const newId = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

let cached: string | null = null;

export const getClientId = (): string | null => {
    if (cached) return cached;
    if (typeof window === 'undefined') return null;

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored && /^[A-Za-z0-9_-]{1,64}$/.test(stored)) {
            cached = stored;
            return cached;
        }
        const fresh = newId();
        window.localStorage.setItem(STORAGE_KEY, fresh);
        cached = fresh;
        return cached;
    } catch {
        // Storage disabled (private browsing, policy). Fall back to an id that lives only as
        // long as this tab: isolation still holds, it just does not survive a refresh — which
        // is strictly better than every such browser sharing one anonymous identity.
        cached = newId();
        return cached;
    }
};
