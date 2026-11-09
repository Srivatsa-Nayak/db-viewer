/** Read-only share links. */
import { api } from './client';

export interface ShareLink {
    token: string;
    fileName?: string | null;
    sharedBy?: string;
}


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
