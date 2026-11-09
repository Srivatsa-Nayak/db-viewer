/** The schema assistant: the user's own model key, and the streamed chat. */
import { getClientId } from '../clientId';
import { api, API_URL, getActiveWorkspace, getAuthToken } from './client';

/* ── The schema assistant ─────────────────────────────────────────────────
   Two services, because they answer to two different people: `apiKeyService`
   is the account holder deciding whose key pays, `chatService` is the panel on
   the canvas asking a question. */

/** A model vendor the app can talk to, as the backend enumerates them. */
export interface LlmProviderOption {
    id: 'OPENROUTER' | 'ANTHROPIC' | 'OPENAI';
    label: string;
    defaultModel: string;
}

/**
 * The state of the signed-in user's own API key.
 *
 * There is deliberately no field for the key itself. The backend stores it encrypted and never
 * returns it, so the UI can show which key is in use (`hint`) but can never re-display one —
 * which is why the form is a paste-to-replace field rather than an editable value.
 */
export interface ApiKeyStatus {
    usingOwnKey: boolean;
    provider: LlmProviderOption['id'] | null;
    providerLabel: string | null;
    model: string | null;
    /** `sk-ant-…4f2a` — enough to recognise a key, not enough to be one. */
    hint: string | null;
    /**
     * True when a key is stored but can no longer be decrypted (the server's secret changed).
     * The assistant refuses rather than quietly billing the app's key, so the user has to
     * paste it again or remove it. `usingOwnKey` is false in this state.
     */
    keyUnreadable: boolean;
    /** False when the deployment has no key of its own, so bringing one is the only way in. */
    defaultAvailable: boolean;
    defaultProviderLabel: string;
    defaultModel: string;
    /** False when AUTH_SECRET is unset, in which case a stored key dies with the process. */
    keysSurviveRestart: boolean;
    providers: LlmProviderOption[];
}

export const apiKeyService = {
    get: async (): Promise<ApiKeyStatus> => {
        const res = await api.get<ApiKeyStatus>('/auth/api-key');
        return res.data;
    },

    /**
     * Stores a key. The backend does **not** call the provider to check it — that would bill
     * the user for every paste — so a rejection here means the request was malformed (an empty
     * key, or one of no recognisable shape). A key that is well-formed but wrong says so on the
     * first question instead.
     *
     * @param provider omit to let the backend infer it from the key's prefix
     */
    save: async (apiKey: string, provider?: string, model?: string): Promise<ApiKeyStatus> => {
        const res = await api.put<ApiKeyStatus>('/auth/api-key', { apiKey, provider, model });
        return res.data;
    },

    /** Changes the model for the saved key, without sending the key again. Blank = default. */
    updateModel: async (model: string): Promise<ApiKeyStatus> => {
        const res = await api.patch<ApiKeyStatus>('/auth/api-key', { model });
        return res.data;
    },

    clear: async (): Promise<ApiKeyStatus> => {
        const res = await api.delete<ApiKeyStatus>('/auth/api-key');
        return res.data;
    },
};

/** Whether the assistant can answer at all, and whose key it would spend doing so. */
export interface ChatConfig {
    requiresAccount: boolean;
    signedIn: boolean;
    available: boolean;
    usingOwnKey?: boolean;
    providerLabel?: string;
    model?: string;
    error?: string;
    /** Questions left today on the app's own key; absent when the user's own key is in use. */
    quota?: { limit: number; remaining: number };
}

/** The first frame of an answer: what is about to write it, and what it was shown. */
export interface ChatMeta {
    provider: string;
    model: string;
    usingOwnKey: boolean;
    tables: number;
    schemaTruncated: boolean;
    /** How many tables were left out of the prompt because the schema was too large. */
    omittedTables?: number;
}

export interface ChatTurnPayload {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatHandlers {
    onMeta?: (meta: ChatMeta) => void;
    onDelta: (text: string) => void;
    /** Called at most once. After it, no more deltas arrive. */
    onError: (message: string) => void;
    /**
     * Called when the answer finished because it hit the output-token limit. The text that
     * arrived is real and stays in the conversation; the user just needs to know it is not all
     * there, especially when it ends inside a SQL block.
     */
    onTruncated?: () => void;
    /**
     * The session is no longer signed in (an expired token). Called in addition to `onError`,
     * so the caller can open the same sign-in prompt the rest of the app uses.
     */
    onUnauthorized?: () => void;
}

export const chatService = {
    config: async (): Promise<ChatConfig> => {
        const res = await api.get<ChatConfig>(`/chat/config?_t=${new Date().getTime()}`);
        return res.data;
    },

    /**
     * Streams an answer, calling `onDelta` for each fragment as it arrives.
     *
     * **Not Axios**, and not `EventSource` either — the one place in this file that reaches for
     * `fetch` directly, so the reason is worth stating. Axios in the browser buffers the whole
     * response before resolving, which would turn a stream back into a twenty-second wait;
     * `EventSource` streams but can only issue a GET and cannot set headers, and this request
     * needs a POST body and three of them. `fetch` is the only option that does both, so the
     * interceptors above are replicated by hand here.
     *
     * Errors arrive by two routes and both are real: a failure before the first byte is an
     * ordinary JSON response with a status code, while one that happens mid-answer can only be
     * an `error` frame inside a stream that has already returned 200.
     */
    stream: async (
        message: string,
        history: ChatTurnPayload[],
        handlers: ChatHandlers,
        signal?: AbortSignal,
    ): Promise<void> => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const workspaceId = getActiveWorkspace();
        if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
        const clientId = getClientId();
        if (clientId) headers['X-Client-Id'] = clientId;
        const token = getAuthToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message, history }),
            signal,
        });

        if (!response.ok || !response.body) {
            // The body is JSON on this path, not a stream — prepare() failed before any frame
            // was written.
            let detail = `The assistant is unavailable (${response.status}).`;
            try {
                const parsed = await response.json();
                if (parsed?.error) detail = parsed.error;
            } catch {
                // Not JSON either. The status is all there is.
            }
            handlers.onError(detail);
            if (response.status === 401) handlers.onUnauthorized?.();
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // Whether `done` or `error` arrived. A stream that just stops — a proxy timeout, the
        // server restarting — would otherwise look exactly like a finished answer.
        let finished = false;

        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Frames are separated by a blank line; the trailing partial one stays buffered.
            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';

            for (const frame of frames) {
                let event = 'message';
                let data = '';
                for (const line of frame.split('\n')) {
                    if (line.startsWith('event:')) event = line.slice(6).trim();
                    else if (line.startsWith('data:')) data += line.slice(5).trim();
                }
                if (!data) continue;

                let parsed: Record<string, unknown>;
                try {
                    parsed = JSON.parse(data);
                } catch {
                    continue; // a malformed frame is not worth failing the answer over
                }

                if (event === 'delta' && typeof parsed.text === 'string') {
                    handlers.onDelta(parsed.text);
                } else if (event === 'meta') {
                    handlers.onMeta?.(parsed as unknown as ChatMeta);
                } else if (event === 'done') {
                    finished = true;
                    if (parsed.truncated === true) handlers.onTruncated?.();
                } else if (event === 'error') {
                    handlers.onError(String(parsed.message ?? 'The assistant failed.'));
                    return;
                }
            }
        }
        if (!finished && !signal?.aborted) {
            handlers.onError('The connection ended before the answer finished. Ask again to retry.');
        }
    },
};
