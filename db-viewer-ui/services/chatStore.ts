/**
 * One assistant conversation per open file, kept alive while the app is.
 *
 * <h2>Why this exists</h2>
 *
 * The assistant used to be remounted per workspace with nothing behind it, so switching files
 * destroyed the conversation outright and switching back gave you an empty panel. The reasoning
 * for clearing it was sound — the history talks about *a* schema, and replaying "the orders table
 * you mentioned" against a different file would have the model answer confidently about a table
 * that is not there — but the remedy was wrong. Throwing the conversation away solves the
 * cross-file problem by destroying something the user cannot get back; keeping one conversation
 * *per file* solves it by never mixing them in the first place, which is what was actually wanted.
 *
 * It is the same shape as the rest of the app: a file owns its tables, its notes, its colours and
 * its canvas layout, and now it owns the conversation about it too.
 *
 * <h2>Why a module singleton</h2>
 *
 * The same reason `services/history.ts` is one. It cannot live in `app/app/page.tsx`: a streaming
 * answer changes state on every token, and putting that in the page would re-render a 1,900-line
 * component tens of times a second. It cannot live in the chat component either, because that is
 * keyed by workspace and unmounts on the very switch this is meant to survive. So the component
 * keeps the live turns in local state — fast, and nothing else re-renders — and mirrors them here,
 * where the next mount can pick them up.
 *
 * The only subscriber is the launcher's "has a conversation" dot, and it is told when a
 * conversation starts or ends — never per token.
 *
 * <h2>Scope</h2>
 *
 * Memory only by default. A transcript can quote the user's schema back at them and is far
 * larger than the layout data in `localStorage`, so nothing is written anywhere unless the user
 * turns on **Keep conversations in this tab**. Then conversations go to `sessionStorage`: they
 * survive a reload, and die with the tab. The choice itself is a per-browser preference in
 * `localStorage`. Signing out clears both.
 */

/** One message, stored flat so the panel can rebuild itself without interpreting anything. */
export interface StoredTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** The failure shown beneath the text, if the answer did not finish cleanly. */
    error?: string;
    /** A caveat that is not a failure, e.g. the answer was cut off at the length limit. */
    notice?: string;
    /** Said once per answer when the schema was too big to send whole. */
    schemaNote?: string;
}

export interface StoredConversation {
    turns: StoredTurn[];
    /** The model that answered, so the footer still says so after a switch. */
    model: string | null;
    usingOwnKey: boolean;
}

const EMPTY: StoredConversation = { turns: [], model: null, usingOwnKey: false };

const PREFERENCE_KEY = 'sql-visualizer.chat.keep';
const SESSION_KEY = 'sql-visualizer.chat.conversations';

const conversations = new Map<string, StoredConversation>();
const listeners = new Set<() => void>();
let hydrated = false;

const readPreference = (): boolean => {
    try {
        return typeof window !== 'undefined' && window.localStorage.getItem(PREFERENCE_KEY) === '1';
    } catch {
        return false;
    }
};

/** Loads persisted conversations the first time anything asks — never during server rendering. */
const hydrate = () => {
    if (hydrated || typeof window === 'undefined') return;
    hydrated = true;
    if (!readPreference()) return;
    try {
        const raw = window.sessionStorage.getItem(SESSION_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, StoredConversation>;
        for (const [id, conversation] of Object.entries(parsed)) {
            if (conversation && Array.isArray(conversation.turns)) conversations.set(id, conversation);
        }
    } catch {
        // Unreadable or blocked storage: start empty, which is the default behaviour anyway.
    }
};

const persist = () => {
    if (typeof window === 'undefined' || !readPreference()) return;
    try {
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(Object.fromEntries(conversations)));
    } catch {
        // Full or blocked. The conversation is still in memory for this page's life.
    }
};

const notify = () => listeners.forEach(listener => listener());

export const chatStore = {
    /** The conversation for a file, or an empty one. Never null, so callers need no branch. */
    load(workspaceId: string): StoredConversation {
        hydrate();
        return conversations.get(workspaceId) ?? EMPTY;
    },

    save(workspaceId: string, conversation: StoredConversation) {
        hydrate();
        const had = conversations.has(workspaceId);
        if (conversation.turns.length === 0) {
            // Nothing worth remembering, and keeping an empty record would make `has` lie to the
            // launcher badge.
            conversations.delete(workspaceId);
        } else {
            conversations.set(workspaceId, conversation);
        }
        persist();
        if (had !== conversations.has(workspaceId)) notify();
    },

    /** True when this file has a conversation to come back to — what the badge is drawn from. */
    has(workspaceId: string | null | undefined): boolean {
        hydrate();
        return !!workspaceId && (conversations.get(workspaceId)?.turns.length ?? 0) > 0;
    },

    /** For `useSyncExternalStore`: told only when a conversation starts or ends. */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    },

    /** Whether conversations survive a reload of this tab. */
    keepsConversations(): boolean {
        return readPreference();
    },

    setKeepConversations(keep: boolean) {
        try {
            if (keep) {
                window.localStorage.setItem(PREFERENCE_KEY, '1');
                persist();
            } else {
                window.localStorage.removeItem(PREFERENCE_KEY);
                window.sessionStorage.removeItem(SESSION_KEY);
            }
        } catch {
            // Storage unavailable: the preference simply does not stick.
        }
    },

    /**
     * Drops one file's conversation. Called when the file is deleted — the schema it was about
     * no longer exists, so neither should the talk about it.
     */
    forget(workspaceId: string) {
        if (conversations.delete(workspaceId)) {
            persist();
            notify();
        }
    },

    /**
     * Drops everything. Used on sign-out, for the same reason the open-file list is cleared
     * there: those files are no longer the caller's, and a second user on a shared browser must
     * not find the first one's conversations waiting for them.
     */
    forgetAll() {
        conversations.clear();
        try {
            window.sessionStorage.removeItem(SESSION_KEY);
        } catch {
            // Nothing stored, or nothing reachable.
        }
        notify();
    },
};
