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

const workspaceParam = () => (activeWorkspaceId ? `&workspaceId=${encodeURIComponent(activeWorkspaceId)}` : '');

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

    getDownloadUrl: (tableName: string) => {
        // We append ?t=TIMESTAMP to bust the cache
        return `${API_URL}/export/${tableName}?t=${new Date().getTime()}${workspaceParam()}`;
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

    getDatabaseExportUrl: (fileName: string | null) => {
        const name = fileName || "database.sql";
        return `${API_URL}/export-sql?filename=${encodeURIComponent(name)}&t=${new Date().getTime()}${workspaceParam()}`;
    },

    createTable: async (tableName: string, columns: NewTableColumn[]) => {
        return api.post('/create-table', {
            tableName,
            columns: columns.map(toBackendColumn)
        });
    },
};
