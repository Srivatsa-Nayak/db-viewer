import axios from 'axios';
import { RowData, SchemaResponse, TableDataResponse } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const api = axios.create({
    baseURL: API_URL,
});

interface AddColumnParams {
    tableName: string;
    columnName: string;
    columnType: string;
    length?: number;   
    notNull?: boolean; 
}

interface UpdateCellParams {
    tableName: string;
    recordId: string | number;
    columnName: string;
    newValue: string;
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
    // Upload CSV
    uploadFile: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        return api.post('/upload', formData);
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

    // Get Schema & Relationships
    getSchema: async (): Promise<SchemaResponse> => {
        const res = await api.get<SchemaResponse>(`/db-info?_t=${new Date().getTime()}`);
        console.log("Schema Response:", res.data);
        return res.data;
    },

    getDownloadUrl: (tableName: string) => {
        // We append ?t=TIMESTAMP to bust the cache
        return `${API_URL}/export/${tableName}?t=${new Date().getTime()}`;
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

    getDatabaseExportUrl: (fileName: string | null) => {
        const name = fileName || "database.sql";
        return `${API_URL}/export-sql?filename=${name}&t=${new Date().getTime()}`;
    },

    createTable: async (tableName: string, columns: NewTableColumn[]) => {
        return api.post('/create-table', {
            tableName,
            columns: columns.map(toBackendColumn)
        });
    },
};
