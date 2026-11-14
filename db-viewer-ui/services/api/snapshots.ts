/** Saved versions of the open file (`/snapshots`). Account-only, enforced by the backend. */
import { api, normaliseSchema } from './client';
import type { RawSchemaResponse, SchemaResponse } from '@/types';

export interface SnapshotSummary {
    id: number;
    name: string;
    createdAt: string;
    sizeBytes: number;
    tableCount: number;
}

export const snapshotService = {
    list: async (): Promise<SnapshotSummary[]> => {
        const res = await api.get<{ snapshots?: SnapshotSummary[] }>(`/snapshots?_t=${Date.now()}`);
        return res.data?.snapshots ?? [];
    },

    create: async (name: string): Promise<void> => {
        await api.post('/snapshots', { name });
    },

    /** The tables and relationships the version recorded, in the same shape `/db-info` has. */
    schema: async (id: number): Promise<SchemaResponse> => {
        const res = await api.get<RawSchemaResponse>(`/snapshots/${id}/schema`);
        return normaliseSchema(res.data);
    },

    restore: async (id: number): Promise<void> => {
        await api.post(`/snapshots/${id}/restore`);
    },

    remove: async (id: number): Promise<void> => {
        await api.delete(`/snapshots/${id}`);
    },
};
