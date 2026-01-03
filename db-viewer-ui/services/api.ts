import axios from 'axios';
import { SchemaResponse, QueryResponse } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const api = axios.create({
    baseURL: API_URL,
});

interface AddColumnParams {
    tableName: string;
    columnName: string;
    columnType: string;
}

interface UpdateCellParams {
    tableName: string;
    recordId: string | number;
    columnName: string;
    newValue: string;
}

export const dbService = {
    // Upload CSV
    uploadFile: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        return api.post('/upload', formData);
    },

    addColumn: async (params: AddColumnParams) => {
        return api.post('/alter-table', {
            table_name: params.tableName,
            column_name: params.columnName,
            column_type: params.columnType
        });
    },

    // Get Schema & Relationships
    getSchema: async (): Promise<SchemaResponse> => {
        const res = await api.get<SchemaResponse>(`/db-info?_t=${new Date().getTime()}`);
        return res.data;
    },

    // Run SQL Query
    runQuery: async (query: string): Promise<QueryResponse> => {
        const res = await api.post<QueryResponse>('/query', { query });
        return res.data;
    },

    getDownloadUrl: (tableName: string) => {
        // We append ?t=TIMESTAMP to bust the cache
        return `${API_URL}/export/${tableName}?t=${new Date().getTime()}`;
    },

    // Get fresh data for a single table
    getTableData: async (tableName: string) => {
        const res = await api.get<any[]>(`/table-data/${tableName}?_t=${new Date().getTime()}`);
        return res.data;
    },

    // Update a specific cell
    updateCell: async (params: UpdateCellParams) => {
        return api.post('/update-cell', {
            table_name: params.tableName,
            record_id: String(params.recordId),
            column_name: params.columnName,
            new_value: params.newValue
        });
    },

    // insert a new cell 
    insertRow: async (tableName: string) => {
        return api.post('/insert-row', { table_name: tableName });
    },

    deleteRow: async (tableName: string, recordId: string | number) => {
        return api.post('/delete-row', { 
            table_name: tableName, 
            record_id: String(recordId) 
        });
    },
};