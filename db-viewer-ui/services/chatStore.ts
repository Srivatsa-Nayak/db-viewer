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
 * answer changes state on every token, and putting that in the page would re-render a 1,700-line
 * component tens of times a second. It cannot live in the chat component either, because that is
 * keyed by workspace and unmounts on the very switch this is meant to survive. So the component
 * keeps the live turns in local state — fast, and nothing else re-renders — and mirrors them here,
 * where the next mount can pick them up.
 *
 * Unlike `history.ts` there is no `useSyncExternalStore`: nothing outside the chat panel reads a
 * conversation while it is being written, so a subscription would buy nothing and cost a render
 * per token.
 *
 * <h2>Scope</h2>
 *
 * Memory only, and deliberately. These are not written to `localStorage`: a conversation is far
 * larger than the layout data that lives there, it can quote the user's schema back at them, and
 * `sessionStorage.ts` is explicitly layout-only. A reload starts fresh, which is what every chat
 * of this shape does. Switching files — the thing people actually do dozens of times an hour — is
 * what had to stop losing work, and does.
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
}

export interface StoredConversation {
    turns: StoredTurn[];
    /** The model that answered, so the footer still says so after a switch. */
    model: string | null;
    usingOwnKey: boolean;
}

const EMPTY: StoredConversation = { turns: [], model: null, usingOwnKey: false };

const conversations = new Map<string, StoredConversation>();

export const chatStore = {
    /** The conversation for a file, or an empty one. Never null, so callers need no branch. */
    load(workspaceId: string): StoredConversation {
        return conversations.get(workspaceId) ?? EMPTY;
    },

    save(workspaceId: string, conversation: StoredConversation) {
        if (conversation.turns.length === 0) {
            // Nothing worth remembering, and keeping an empty record would make `has` lie to the
            // launcher badge.
            conversations.delete(workspaceId);
            return;
        }
        conversations.set(workspaceId, conversation);
    },

    /** True when this file has a conversation to come back to — what the badge is drawn from. */
    has(workspaceId: string | null | undefined): boolean {
        return !!workspaceId && (conversations.get(workspaceId)?.turns.length ?? 0) > 0;
    },

    /**
     * Drops one file's conversation. Called when the file is deleted — the schema it was about
     * no longer exists, so neither should the talk about it.
     */
    forget(workspaceId: string) {
        conversations.delete(workspaceId);
    },

    /**
     * Drops everything. Used on sign-out, for the same reason the open-file list is cleared
     * there: those files are no longer the caller's, and a second user on a shared browser must
     * not find the first one's conversations waiting for them.
     */
    forgetAll() {
        conversations.clear();
    },
};
