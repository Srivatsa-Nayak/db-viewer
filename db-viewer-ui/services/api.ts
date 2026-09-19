import axios from 'axios';
import { getClientId } from './clientId';
import {
    ColumnInfo, ImportPlan, RawColumnInfo, RawRelationship, RawSchemaResponse, Relationship,
    RowData, SchemaResponse, SqlDialectId, TableDataResponse, TableInfo,
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
});

/** Drops a relationship that is missing an endpoint rather than drawing half an edge. */
export const normaliseRelationships = (raw: RawRelationship[] = []): Relationship[] =>
    raw.flatMap(r => {
        const sourceTable = r.sourceTable ?? r.source_table;
        const targetTable = r.targetTable ?? r.target_table;
        const sourceColumn = r.sourceColumn ?? r.source_column;
        const targetColumn = r.targetColumn ?? r.target_column ?? 'id';
        if (!sourceTable || !targetTable || !sourceColumn) return [];
        return [{ sourceTable, targetTable, sourceColumn, targetColumn }];
    });

export const normaliseSchema = (raw: RawSchemaResponse | undefined): SchemaResponse => ({
    tables: (raw?.tables ?? []).map((t): TableInfo => ({
        name: t.name,
        columns: (t.columns ?? []).map(normaliseColumn),
        rows: t.rows ?? [],
    })),
    relationships: normaliseRelationships(raw?.relationships),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const api = axios.create({
    baseURL: API_URL,
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
const saveBlob = (data: BlobPart, fileName: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

interface AddColumnParams {
    tableName: string;
    columnName: string;
    columnType: string;
    length?: number;   
    notNull?: boolean; 
}

interface UpdateColumnParams {
    tableName: string;
    columnName: string;
    /** Omit to keep the current name. */
    newColumnName?: string;
    /** Omit to keep the current type. */
    columnType?: string;
    length?: number;
    /** Omit (undefined) to keep the current nullability. */
    notNull?: boolean;
}

interface UpdateCellParams {
    tableName: string;
    recordId: string | number;
    columnName: string;
    newValue: string;
}

/** A file the signed-in user owns, as the backend reports it. */
export interface WorkspaceSummary {
    id: string;
    /** Null for a workspace claimed before names were stored server-side. */
    name: string | null;
}

/** What the backend reports after running an uploaded .sql / .csv file. */
export interface UploadReport {
    message?: string;
    type?: string;
    statementsExecuted?: number;
    statementsSkipped?: number;
    warnings?: string[];
    warningCount?: number;
    tableName?: string;
}

export interface NewTableColumn {
    name: string;
    type: string;
    length?: number;
    is_pk: boolean;
    not_null: boolean;
    ref_table?: string;
    ref_col?: string;
}

const toBackendColumn = (column: NewTableColumn) => ({
    name: column.name,
    type: column.type,
    length: column.length,
    isPk: column.is_pk,
    notNull: column.not_null,
    refTable: column.ref_table,
    refCol: column.ref_col,
});

export const dbService = {
    /**
     * Reports what importing a file would produce, without importing it.
     *
     * <p>The first half of a two-step import. Nothing on the backend is written, so the dialog
     * this feeds can be cancelled with nothing to undo — which is the only way a type the
     * inference got wrong can be corrected, because an `INT` postcode column has already dropped
     * its leading zeros by the time the canvas renders.
     */
    analyzeUpload: async (file: File): Promise<ImportPlan> => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await api.post<ImportPlan>('/import/analyze', formData);
        return res.data;
    },

    /**
     * Runs the import. Returns a report describing what actually ran.
     *
     * @param columnTypes the types the user corrected in the preview — keyed by column name for a
     *                    CSV, by `table.column` for a script. Omit to accept what was inferred.
     */
    uploadFile: async (file: File, columnTypes?: Record<string, string>): Promise<UploadReport> => {
        const formData = new FormData();
        formData.append("file", file);
        if (columnTypes && Object.keys(columnTypes).length > 0) {
            formData.append('columnTypes', JSON.stringify(columnTypes));
        }
        const res = await api.post<UploadReport>('/upload', formData);
        return res.data ?? {};
    },

    addColumn: async (params: AddColumnParams) => {
        return api.post('/alter-table', {
            tableName: params.tableName,
            columnName: params.columnName,
            columnType: params.columnType,
            length: params.length,   
            notNull: params.notNull   
        });
    },

    /** Rename a column and/or change its type or nullability. */
    updateColumn: async (params: UpdateColumnParams) => {
        return api.post('/update-column', {
            tableName: params.tableName,
            columnName: params.columnName,
            newColumnName: params.newColumnName,
            columnType: params.columnType,
            length: params.length,
            notNull: params.notNull,
        });
    },

    /** Drops a table. Rejected with 409 when another table's foreign key references it. */
    dropTable: async (tableName: string) => {
        const res = await api.delete(`/table/${encodeURIComponent(tableName)}`);
        return res.data;
    },

    /** Fills an empty file with the default (Online Store) template. */
    loadExampleSchema: async () => {
        const res = await api.post('/demo');
        return res.data;
    },

    // --- Starter templates (the catalogue lives entirely on the backend) ---

    /** Every bundled template, plus the distinct categories. Public - no account needed. */
    listTemplates: async (): Promise<{ templates: SchemaTemplate[]; categories: string[] }> => {
        const res = await api.get<{ templates?: SchemaTemplate[]; categories?: string[] }>('/templates');
        return { templates: res.data?.templates ?? [], categories: res.data?.categories ?? [] };
    },

    /** One template including its SQL body, for the preview. */
    getTemplate: async (id: string): Promise<SchemaTemplate> => {
        const res = await api.get<SchemaTemplate>(`/templates/${encodeURIComponent(id)}`);
        return res.data;
    },

    /** Creates the template's tables in the workspace the client is currently bound to. */
    applyTemplate: async (id: string) => {
        const res = await api.post(`/templates/${encodeURIComponent(id)}/apply`);
        return res.data;
    },

    // --- Table notes (a to-do list per table) ---

    getAllTableNotes: async (): Promise<TableNote[]> => {
        const res = await api.get<{ notes?: TableNote[] }>(`/table-notes?_t=${new Date().getTime()}`);
        return res.data?.notes ?? [];
    },

    getTableNotes: async (tableName: string): Promise<TableNote[]> => {
        const res = await api.get<{ notes?: TableNote[] }>(
            `/table-notes/${encodeURIComponent(tableName)}?_t=${new Date().getTime()}`);
        return res.data?.notes ?? [];
    },

    addTableNote: async (tableName: string, note: string) => {
        return api.post(`/table-notes/${encodeURIComponent(tableName)}`, { note });
    },

    setTableNoteDone: async (noteId: number, done: boolean) => {
        return api.post(`/table-notes/${noteId}/done`, { done });
    },

    deleteTableNote: async (noteId: number) => {
        return api.delete(`/table-notes/${noteId}`);
    },

    /**
     * The caller's files, with the name each was saved under.
     *
     * This is the authority on what a signed-in user owns. The browser's own copy in
     * localStorage is a cache of layout, not a record of existence — signing out clears it — so
     * a file list rebuilt only from storage loses every file the moment somebody logs out.
     *
     * Tolerates the old `string[]` shape so a new UI against an old backend degrades to
     * unnamed files rather than an empty explorer.
     */
    listWorkspaces: async (): Promise<WorkspaceSummary[]> => {
        const res = await api.get<{ workspaces?: (string | { id?: string; name?: string | null })[] }>(
            `/workspaces?_t=${new Date().getTime()}`);
        return (res.data?.workspaces ?? []).flatMap(entry => {
            if (typeof entry === 'string') return [{ id: entry, name: null }];
            return entry?.id ? [{ id: entry.id, name: entry.name ?? null }] : [];
        });
    },

    /**
     * Records what the user called this file, against the active workspace.
     *
     * Fire-and-forget on purpose: a file without a stored name still opens, and failing the
     * creation of a file because its label did not save would be the worse outcome.
     */
    setWorkspaceName: async (name: string): Promise<void> => {
        try {
            await api.post('/workspace/name', { name });
        } catch (e) {
            console.error('Could not record the file name', e);
        }
    },

    /** Version declared in the backend's pom.xml; shown in the info modal. */
    getVersion: async (): Promise<string | null> => {
        try {
            const res = await api.get<{ version?: string }>('/version');
            return res.data?.version ?? null;
        } catch {
            // The version is decoration - never let it break the modal it appears in.
            return null;
        }
    },

    // Get Schema & Relationships
    getSchema: async (): Promise<SchemaResponse> => {
        const res = await api.get<RawSchemaResponse>(`/db-info?_t=${new Date().getTime()}`);
        return normaliseSchema(res.data);
    },

    /** Downloads one table as CSV. Requires an account. */
    downloadTableCsv: async (tableName: string) => {
        const res = await api.get(`/export/${encodeURIComponent(tableName)}?t=${new Date().getTime()}`, {
            responseType: 'blob',
        });
        saveBlob(res.data, `${tableName}.csv`, 'text/csv');
    },

    // Get fresh data for a single table
    getTableData: async (tableName: string): Promise<TableDataResponse | RowData[]> => {
        const res = await api.get<{ columns?: (RawColumnInfo | string)[]; rows?: RowData[] } | RowData[]>(
            `/table-data/${encodeURIComponent(tableName)}?_t=${new Date().getTime()}`);
        const body = res.data;
        if (Array.isArray(body)) return body;
        const rawCols = body?.columns ?? [];
        return {
            columns: rawCols.every((c): c is string => typeof c === 'string')
                ? rawCols
                : (rawCols as RawColumnInfo[]).map(normaliseColumn),
            rows: body?.rows ?? [],
        };
    },

    // Update a specific cell
    updateCell: async (params: UpdateCellParams) => {
        return api.post('/update-cell', {
            tableName: params.tableName,
            recordId: String(params.recordId),
            columnName: params.columnName,
            newValue: params.newValue
        });
    },

    // insert a new cell 
    insertRow: async (tableName: string, rowData?: RowData) => {
        return api.post('/insert-row', { 
            tableName,
            data: rowData || {} // Send data if present
        });
    },

    deleteRow: async (tableName: string, recordId: string | number) => {
        return api.post('/delete-row', { 
            tableName, 
            recordId: String(recordId) 
        });
    },

    /**
     * Discards the active workspace's database entirely (file on SQLite, schema on
     * MySQL). Used when a file is closed so its tables cannot resurface later.
     */
    async deleteWorkspace() {
        const response = await api.delete('/workspace');
        return response.data;
    },

    /**
     * Downloads the whole file as a SQL dump. Requires an account.
     *
     * @param dialect the engine the script has to run on. Not a formatting preference:
     *                `AUTOINCREMENT`, `SERIAL`, `IDENTITY(1,1)` and `AUTO_INCREMENT` are four
     *                spellings of one idea and no engine accepts another's, so an untargeted
     *                export is only ever nearly runnable.
     */
    downloadDatabaseSql: async (fileName: string, dialect: SqlDialectId = 'generic') => {
        const res = await api.get(
            `/export-sql?filename=${encodeURIComponent(fileName)}`
            + `&dialect=${encodeURIComponent(dialect)}&t=${new Date().getTime()}`,
            { responseType: 'blob' });
        saveBlob(res.data, fileName, 'application/sql');
    },

    createTable: async (tableName: string, columns: NewTableColumn[]) => {
        return api.post('/create-table', {
            tableName,
            columns: columns.map(toBackendColumn)
        });
    },
};

/**
 * The engines an export can target.
 *
 * Held here rather than fetched from `GET /dialects` because the ids are a wire contract this
 * file already owns, and the export dialog should not have a loading state for six fixed rows.
 * The backend endpoint exists for anyone driving the API directly.
 */
export interface DialectOption {
    id: SqlDialectId;
    label: string;
    /** The one line that says what actually changes in the generated script. */
    hint: string;
}

export const SQL_DIALECTS: DialectOption[] = [
    { id: 'postgres', label: 'PostgreSQL', hint: 'SERIAL keys, "double-quoted" names' },
    { id: 'mysql', label: 'MySQL', hint: 'AUTO_INCREMENT keys, `backticked` names' },
    { id: 'mariadb', label: 'MariaDB', hint: 'As MySQL — same syntax for schema DDL' },
    { id: 'sqlserver', label: 'SQL Server', hint: 'IDENTITY(1,1) keys, [bracketed] names, GO batches' },
    { id: 'sqlite', label: 'SQLite', hint: 'AUTOINCREMENT keys — what this workspace runs on' },
    { id: 'generic', label: 'Standard SQL', hint: 'ANSI types only; runs almost anywhere' },
];

/** A to-do note attached to a table. */
export interface TableNote {
    id: number;
    table_name: string;
    note: string;
    done: number;
    created_at: string;
}

export interface AuthUser {
    email: string;
    displayName: string;
}

export interface ShareLink {
    token: string;
    fileName?: string | null;
    sharedBy?: string;
}

export const authService = {
    signup: async (email: string, password: string, displayName?: string): Promise<AuthUser> => {
        const res = await api.post<{ token: string; email: string; displayName: string }>(
            '/auth/signup', { email, password, displayName });
        setAuthToken(res.data.token);
        return { email: res.data.email, displayName: res.data.displayName };
    },

    login: async (email: string, password: string): Promise<AuthUser> => {
        const res = await api.post<{ token: string; email: string; displayName: string }>(
            '/auth/login', { email, password });
        setAuthToken(res.data.token);
        return { email: res.data.email, displayName: res.data.displayName };
    },

    logout: () => setAuthToken(null),

    /** Changes the display name and/or password. Send only what is changing. */
    updateProfile: async (changes: {
        displayName?: string;
        currentPassword?: string;
        newPassword?: string;
    }): Promise<AuthUser> => {
        const res = await api.patch<Partial<AuthUser>>('/auth/profile', changes);
        return {
            email: res.data?.email ?? '',
            displayName: res.data?.displayName ?? res.data?.email ?? '',
        };
    },

    /** Resolves the stored token to a user, or null if there is none / it expired. */
    me: async (): Promise<AuthUser | null> => {
        if (!getAuthToken()) return null;
        try {
            const res = await api.get<Partial<AuthUser>>('/auth/me');
            if (!res.data?.email) {
                setAuthToken(null);
                return null;
            }
            return { email: res.data.email, displayName: res.data.displayName ?? res.data.email };
        } catch {
            setAuthToken(null);
            return null;
        }
    },
};

export const shareService = {
    /** Creates (or returns the existing) read-only link for the active file. */
    create: async (fileName: string): Promise<ShareLink> => {
        const res = await api.post<ShareLink>('/share', { fileName });
        return res.data;
    },

    revoke: async (token: string) => api.delete(`/share/${token}`),

    /** Public read of a shared file. No account needed - the token is the credential. */
    view: async (token: string) => {
        const res = await api.get(`/share/${token}?_t=${new Date().getTime()}`);
        return res.data;
    },

    /** The URL to hand out, built from where the app is actually running. */
    linkFor: (token: string) =>
        `${typeof window === 'undefined' ? '' : window.location.origin}/share/${token}`,
};

/**
 * A bundled starter schema.
 *
 * Authored on the backend (a .sql file plus a manifest entry) and only rendered here, so a new
 * template needs no frontend change. `sql` is present only on the detail endpoint.
 */
export interface TemplateColumn {
    name: string;
    type: string;
    pk: boolean;
}

export interface TemplateRelationship {
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
}

export interface TemplateTable {
    name: string;
    columns: TemplateColumn[];
}

/** Enough structure to draw the diagram without the frontend parsing any SQL. */
export interface TemplateSchema {
    tables: TemplateTable[];
    relationships: TemplateRelationship[];
}

export interface SchemaTemplate {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    featured: boolean;
    tables: string[];
    tableCount: number;
    relationshipCount: number;
    /**
     * Detail endpoint only — omitted from the list so the catalogue stays small.
     *
     * Nothing renders this any more. The preview used to show it beside the diagram, which
     * spent half the dialog on DDL nobody was choosing a template by; anyone who wants the SQL
     * can open the template and export it, and get their own edits with it.
     */
    sql?: string | null;
    /** Detail endpoint only. */
    schema?: TemplateSchema | null;
}
