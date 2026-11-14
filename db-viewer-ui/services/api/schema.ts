/** The schema and data endpoints: everything `dbService` does against a workspace. */
import {
    ImportPlan, RawColumnInfo, RawSchemaResponse, RowData, SchemaResponse, ScratchpadResult,
    SqlDialectId, TableDataResponse,
} from '@/types';
import { api, IMPORT_TIMEOUT_MS, saveBlob, normaliseColumn, normaliseSchema } from './client';
import type { SchemaTemplate } from './templates';

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

/** Annotations the canvas keeps about a workspace: `table` colours/tags, `group` domain boxes. */
export type CanvasAnnotationKind = 'table' | 'group';

interface RawCanvasAnnotation {
    kind?: CanvasAnnotationKind;
    ref?: string;
    payload?: string;
}

export interface CanvasAnnotation {
    kind: CanvasAnnotationKind;
    /** Table name for `table`, the group's own id for `group`. */
    ref: string;
    payload: Record<string, unknown>;
}

export interface ForeignKeyParams {
    /** The table that will hold the foreign key. */
    tableName: string;
    columnName: string;
    /** The table being pointed at. Its column must be a primary key or uniquely indexed. */
    refTable: string;
    refColumn: string;
    onDelete?: string;
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
        const res = await api.post<ImportPlan>('/import/analyze', formData, { timeout: IMPORT_TIMEOUT_MS });
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
        const res = await api.post<UploadReport>('/upload', formData, { timeout: IMPORT_TIMEOUT_MS });
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
    /**
     * Removes a column. The inverse of `addColumn`, which is how undo reverses one.
     *
     * Refused by the backend for a primary key, the last remaining column, and a column another
     * table's foreign key points at.
     */
    dropColumn: async (tableName: string, columnName: string) => {
        const response = await api.post('/drop-column', { tableName, columnName });
        return response.data;
    },

    /**
     * Declares a relationship between two existing tables — what dragging a line does.
     *
     * The backend validates before it writes (unique target, matching types, no orphan rows) and
     * rebuilds the table on SQLite, which cannot add a constraint in place.
     */
    addForeignKey: async (params: ForeignKeyParams) => {
        const response = await api.post('/add-foreign-key', params);
        return response.data;
    },

    /** Removes a relationship, identified by the two columns it joins. The inverse of adding one. */
    dropForeignKey: async (params: ForeignKeyParams) => {
        const response = await api.post('/drop-foreign-key', params);
        return response.data;
    },

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
     * Downloads a published schema file (a GitHub gist or repository file) through the backend,
     * which only fetches from GitHub. Imports nothing: the caller previews the text first.
     */
    fetchImport: async (url: string): Promise<{ fileName: string; content: string }> => {
        const res = await api.post<{ fileName: string; content: string }>('/import/fetch', { url });
        return res.data;
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

    /**
     * Every canvas annotation in the active workspace — table colours and tags, and groups.
     *
     * One call, because the canvas needs all of them before it can draw once. The payload is
     * JSON the backend stores verbatim, so parsing it is this layer's job.
     */
    getCanvasMeta: async (): Promise<CanvasAnnotation[]> => {
        const res = await api.get<{ meta?: RawCanvasAnnotation[] }>(
            `/canvas-meta?_t=${new Date().getTime()}`);
        return (res.data?.meta ?? []).flatMap(row => {
            if (!row?.kind || !row?.ref) return [];
            try {
                return [{ kind: row.kind, ref: row.ref, payload: JSON.parse(row.payload ?? '{}') }];
            } catch {
                // A payload we cannot read is a bad row, not a reason to lose the other colours.
                console.error('Ignoring an unreadable canvas annotation', row.ref);
                return [];
            }
        });
    },

    setCanvasMeta: async (kind: CanvasAnnotationKind, ref: string, payload: unknown): Promise<void> => {
        await api.put(`/canvas-meta/${kind}/${encodeURIComponent(ref)}`,
            { payload: JSON.stringify(payload) });
    },

    deleteCanvasMeta: async (kind: CanvasAnnotationKind, ref: string): Promise<void> => {
        await api.delete(`/canvas-meta/${kind}/${encodeURIComponent(ref)}`);
    },

    /**
     * Runs a script from the scratchpad. Requires an account, like export and sharing.
     *
     * Returns a result per statement rather than one for the whole script, because the useful
     * question when a script fails is which statement did it.
     */
    runScratchpad: async (script: string): Promise<ScratchpadResult> => {
        const res = await api.post<ScratchpadResult>('/scratchpad', { script });
        return {
            statements: res.data?.statements ?? [],
            schemaChanged: !!res.data?.schemaChanged,
            failed: !!res.data?.failed,
        };
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

    /** Another open file's schema, without switching to it. */
    getSchemaOf: async (workspaceId: string): Promise<SchemaResponse> => {
        const res = await api.get<RawSchemaResponse>(`/db-info?_t=${new Date().getTime()}`,
            { headers: { 'X-Workspace-Id': workspaceId } });
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
    getTableData: async (
        tableName: string,
        page: { limit?: number; offset?: number } = {},
    ): Promise<TableDataResponse | RowData[]> => {
        const params = new URLSearchParams({ _t: String(Date.now()) });
        if (page.limit !== undefined) params.set('limit', String(page.limit));
        if (page.offset !== undefined) params.set('offset', String(page.offset));
        const res = await api.get<
            { columns?: (RawColumnInfo | string)[]; rows?: RowData[]; total?: number; keyColumn?: string }
            | RowData[]>(`/table-data/${encodeURIComponent(tableName)}?${params}`);
        const body = res.data;
        if (Array.isArray(body)) return body;
        const rawCols = body?.columns ?? [];
        return {
            columns: rawCols.every((c): c is string => typeof c === 'string')
                ? rawCols
                : (rawCols as RawColumnInfo[]).map(normaliseColumn),
            rows: body?.rows ?? [],
            total: typeof body?.total === 'number' ? body.total : undefined,
            keyColumn: typeof body?.keyColumn === 'string' ? body.keyColumn : undefined,
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
