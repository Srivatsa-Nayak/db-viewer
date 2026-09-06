import axios from 'axios';
import { RowData, SchemaResponse, TableDataResponse } from '@/types';

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
    // Upload a .csv or .sql file. Returns a report describing what actually ran.
    uploadFile: async (file: File): Promise<UploadReport> => {
        const formData = new FormData();
        formData.append("file", file);
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

    /** Fills an empty file with the bundled eight-table example. */
    loadExampleSchema: async () => {
        const res = await api.post('/demo');
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

    /** Ids of workspaces that still have a database, used to restore a session after a refresh. */
    listWorkspaces: async (): Promise<string[]> => {
        const res = await api.get<{ workspaces?: string[] }>(`/workspaces?_t=${new Date().getTime()}`);
        return res.data?.workspaces ?? [];
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
        const res = await api.get<SchemaResponse>(`/db-info?_t=${new Date().getTime()}`);
        console.log("Schema Response:", res.data);
        return res.data;
    },

    /** Downloads one table as CSV. Requires an account. */
    downloadTableCsv: async (tableName: string) => {
        const res = await api.get(`/export/${tableName}?t=${new Date().getTime()}`, {
            responseType: 'blob',
        });
        saveBlob(res.data, `${tableName}.csv`, 'text/csv');
    },

    // Get fresh data for a single table
    getTableData: async (tableName: string): Promise<TableDataResponse | RowData[]> => {
        const res = await api.get<TableDataResponse | RowData[]>(`/table-data/${tableName}?_t=${new Date().getTime()}`);
        return res.data;
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

    async clearDatabase() {
        const response = await api.delete('/clear');
        return response.data;
    },

    /**
     * Discards the active workspace's database entirely (file on SQLite, schema on
     * MySQL). Used when a file is closed so its tables cannot resurface later.
     */
    async deleteWorkspace() {
        const response = await api.delete('/workspace');
        return response.data;
    },

    /** Downloads the whole file as a SQL dump. Requires an account. */
    downloadDatabaseSql: async (fileName: string) => {
        const res = await api.get(
            `/export-sql?filename=${encodeURIComponent(fileName)}&t=${new Date().getTime()}`,
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
