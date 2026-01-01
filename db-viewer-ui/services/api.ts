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
        return `${API_URL}/export/${tableName}`;
    }
};