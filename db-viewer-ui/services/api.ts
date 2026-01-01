import axios from 'axios';
import { SchemaResponse, QueryResponse } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const api = axios.create({
    baseURL: API_URL,
});

export const dbService = {
    // Upload CSV
    uploadFile: async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        return api.post('/upload', formData);
    },

    // Get Schema & Relationships
    getSchema: async (): Promise<SchemaResponse> => {
        const res = await api.get<SchemaResponse>('/db-info');
        return res.data;
    },

    // Run SQL Query
    runQuery: async (query: string): Promise<QueryResponse> => {
        const res = await api.post<QueryResponse>('/query', { query });
        return res.data;
    }
};