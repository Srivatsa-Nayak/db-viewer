/** Accounts: sign-up, sign-in, the current user and the profile. */
import { api, getAuthToken, setAuthToken } from './client';

export interface AuthUser {
    email: string;
    displayName: string;
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
        const res = await api.patch<Partial<AuthUser> & { token?: string }>('/auth/profile', changes);
        // A password change signs out every other device by refusing tokens issued before it,
        // this tab's included — so it comes back with a fresh one, which has to replace the old.
        if (res.data?.token) setAuthToken(res.data.token);
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
