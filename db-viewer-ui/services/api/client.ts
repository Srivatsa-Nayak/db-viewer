/**
 * The one Axios instance and everything every request carries: the workspace and client ids,
 * the session token, the timeout, and a readable error for a request that got no response.
 * Plus the wire-format normalisation every schema-reading call goes through.
 */
import axios from 'axios';
import { getClientId } from '../clientId';
import {
    COLD_START_TIMEOUT_MS, isBackendAwake, markBackendAwake, requestFinished, requestStarted,
} from '../backendStatus';
import {
    ColumnInfo, RawColumnInfo, RawRelationship, RawSchemaResponse, Relationship, SchemaResponse,
    TableInfo,
} from '@/types';

/* ── Wire -> UI normalisation ─────────────────────────────────────────────
   The backend answers with `is_pk` in some places and `isPk` in others. Folding
   both into one shape here is the only way the rest of the app can trust
   `types/index.ts` as ground truth. */

export const normaliseColumn = (c: RawColumnInfo): ColumnInfo => ({
    name: c.name,
    type: c.type,
    isPk: c.isPk ?? c.is_pk ?? false,
    notNull: c.notNull ?? c.not_null ?? false,
    isUnique: c.isUnique ?? c.unique ?? false,
    // Null and empty string both mean "no default"; only a real value is worth showing.
    defaultValue: c.defaultValue ?? c.default_value ?? undefined,
    autoIncrement: c.autoIncrement ?? c.auto_increment ?? false,
});

/** Drops a relationship that is missing an endpoint rather than drawing half an edge. */
export const normaliseRelationships = (raw: RawRelationship[] = []): Relationship[] =>
    raw.flatMap(r => {
        const sourceTable = r.sourceTable ?? r.source_table;
        const targetTable = r.targetTable ?? r.target_table;
        const sourceColumn = r.sourceColumn ?? r.source_column;
        const targetColumn = r.targetColumn ?? r.target_column ?? 'id';
        if (!sourceTable || !targetTable || !sourceColumn) return [];
        return [{
            sourceTable, targetTable, sourceColumn, targetColumn,
            constraintId: r.constraintId ?? r.constraint_id,
            onDelete: r.onDelete ?? r.on_delete ?? undefined,
        }];
    });

export const normaliseSchema = (raw: RawSchemaResponse | undefined): SchemaResponse => ({
    tables: (raw?.tables ?? []).map((t): TableInfo => ({
        name: t.name,
        columns: (t.columns ?? []).map(normaliseColumn),
        rows: t.rows ?? [],
        isView: t.isView ?? t.view ?? false,
    })),
    relationships: normaliseRelationships(raw?.relationships),
});

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/**
 * Every request gives up after this long. There was no timeout at all, so a backend that
 * accepted a connection and then stalled left spinners turning for ever. Imports pass their own,
 * longer one: a 50MB dump on a slow link legitimately takes minutes.
 *
 * Until the backend has answered once in this tab the limit is `COLD_START_TIMEOUT_MS` instead
 * (see `services/backendStatus.ts`): the free hosting plan stops an idle backend, and starting
 * it again was measured at 26s — too close to 30s to leave a visitor's first click to chance.
 */
const REQUEST_TIMEOUT_MS = 30_000;
export const IMPORT_TIMEOUT_MS = 5 * 60_000;

export const api = axios.create({
    baseURL: API_URL,
    timeout: REQUEST_TIMEOUT_MS,
});

api.interceptors.request.use((config) => {
    if (!isBackendAwake() && (config.timeout ?? REQUEST_TIMEOUT_MS) < COLD_START_TIMEOUT_MS) {
        config.timeout = COLD_START_TIMEOUT_MS;
    }
    requestStarted();
    return config;
});

api.interceptors.response.use(
    (response) => {
        requestFinished(response.status);
        return response;
    },
    (error) => {
        requestFinished(axios.isAxiosError(error) ? error.response?.status : undefined);
        return Promise.reject(error);
    },
);

/**
 * Starts the backend if the hosting plan has stopped it, without anyone waiting on the answer.
 *
 * Sent once per tab from the root layout, so a visitor who lands on the docs or a share link
 * has a backend that is already starting by the time they click anything. Plain `fetch` with no
 * custom headers: a simple GET needs no CORS preflight, and none of the interceptors' headers
 * mean anything to a health check. It does not count as a request someone is waiting on, so it
 * never brings up the "waking up" notice by itself.
 */
let wakeSent = false;
export const wakeBackend = () => {
    if (wakeSent || typeof window === 'undefined') return;
    wakeSent = true;
    fetch(`${API_URL}/actuator/health`, { cache: 'no-store' })
        .then(res => { if (res.ok) markBackendAwake(); })
        .catch(() => {
            // Unreachable now; the first real request will say so in its own words.
        });
};

/**
 * Gives a failure with no response — a timeout, the backend down, the network gone — the same
 * `{error}` body a refusal from the backend has.
 *
 * Every call site reads `errorMessage(err)` and falls back to its own generic text, which for
 * these cases was all anyone ever saw ("Could not save the column") with no hint that the
 * problem was the connection rather than the column. A real response is passed through
 * untouched, so `isAuthRequired` and `isForeignWorkspace` see exactly what they did before.
 */
api.interceptors.response.use(undefined, (error) => {
    if (axios.isAxiosError(error) && !error.response && !axios.isCancel(error)) {
        const message = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
            ? 'The server took too long to answer. Try again in a moment.'
            : 'Could not reach the server. Check your connection, or whether the backend is running.';
        error.response = {
            status: 0,
            statusText: '',
            headers: {},
            config: error.config!,
            data: { error: message },
        };
    }
    return Promise.reject(error);
});

/**
 * Id of the SQL file the user is currently working in.
 *
 * Each open file is an independent backend workspace with its own database, so
 * two files can define tables of the same name. Every request carries the id in
 * the `X-Workspace-Id` header; browser-initiated downloads carry it as a
 * `workspaceId` query parameter instead, because a plain link cannot set headers.
 */
let activeWorkspaceId: string | null = null;

export const setActiveWorkspace = (workspaceId: string | null) => {
    activeWorkspaceId = workspaceId;
};

export const getActiveWorkspace = () => activeWorkspaceId;

api.interceptors.request.use((config) => {
    if (activeWorkspaceId) {
        config.headers.set('X-Workspace-Id', activeWorkspaceId);
    }
    // Identifies the browser so the backend can keep two signed-out sessions apart. Sent on
    // every request, not just workspace ones, because signing in is where it matters most:
    // that is when the backend moves this browser's anonymous files onto the new account.
    const clientId = getClientId();
    if (clientId) {
        config.headers.set('X-Client-Id', clientId);
    }
    return config;
});

/**
 * Session token for the signed-in user.
 *
 * Almost everything works anonymously; the token only matters for the two actions that take
 * data out of the app (export, share), which the backend refuses without it. Kept in
 * localStorage so a refresh does not sign the user out.
 */
const TOKEN_KEY = 'sql-visualizer.token';
let authToken: string | null = null;

const readStoredToken = (): string | null => {
    try {
        return typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
};

export const setAuthToken = (token: string | null) => {
    authToken = token;
    try {
        if (typeof window === 'undefined') return;
        if (token) window.localStorage.setItem(TOKEN_KEY, token);
        else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
        // Storage disabled - the token still works for this tab.
    }
};

export const getAuthToken = (): string | null => {
    if (authToken === null) authToken = readStoredToken();
    return authToken;
};

api.interceptors.request.use((config) => {
    const token = getAuthToken();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);
    return config;
});

/** Thrown-ish marker: the backend refused because the action needs an account. */
export const isAuthRequired = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'response' in error
    && (error as { response?: { status?: number } }).response?.status === 401;

/**
 * The workspace belongs to a different session.
 *
 * Distinct from a 401: the caller is identified perfectly well and simply does not own this
 * file, so prompting them to sign in would be the wrong thing to do. It happens legitimately
 * after signing out, when the files left open in the browser belong to the account that just
 * left.
 */
export const isForeignWorkspace = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'response' in error
    && (error as { response?: { status?: number } }).response?.status === 403;

/**
 * Saves a response body as a file.
 *
 * Downloads go through Axios rather than a plain link because a link cannot carry the
 * Authorization header the export endpoints now require.
 */
export const saveBlob = (data: BlobPart, fileName: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
