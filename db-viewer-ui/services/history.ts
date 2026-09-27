/**
 * Undo/redo for the editor.
 *
 * A stack of **commands**, not snapshots. A snapshot of the canvas can restore where the boxes
 * were; it cannot express "put the column back", and putting the column back means running the
 * inverse DDL against a real database. So each entry carries the two calls that reverse and replay
 * it, and the stack never holds schema state of its own.
 *
 * It is a module singleton rather than React state because the things that mutate the schema are
 * scattered — three dialogs call `dbService` directly and then ask the page to refresh — and
 * threading a callback down to each of them would put the same plumbing in five files. Components
 * import this and call `history.push(...)`; the page reads it through `useSyncExternalStore`.
 *
 * What is deliberately *not* in here:
 *
 * - **Dropping a table.** It is destructive and has no inverse short of restoring the rows, so it
 *   gets the deferred-delete safety net instead (see the plan's ghost nodes).
 * - **Cell edits.** They belong to the row editor's own undo, and a schema-level Ctrl+Z reaching
 *   into someone's half-finished typing is worse than no undo at all.
 * - **Anything arbitrary SQL did.** See {@link HistoryStore.pushBarrier}.
 */

export interface HistoryEntry {
    /** Shown in the toast: "Undid: add column orders.status". */
    label: string;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
    /**
     * The inverse cannot restore everything it destroys — retyping `VARCHAR` to `INT` drops
     * whatever did not parse, and retyping back leaves nulls. Undoing one of these asks first.
     */
    lossy?: boolean;
}

/**
 * A point the stack refuses to reverse past.
 *
 * Once arbitrary SQL has run, every earlier inverse is a guess: an entry that wants to drop a
 * column cannot know whether the column is still there, still that type, or now carries data
 * somebody cares about. Applying a stale inverse silently is far worse than declining to, so the
 * barrier stops undo and says why.
 */
interface Barrier {
    barrier: true;
    reason: string;
}

type StackItem = HistoryEntry | Barrier;

const isBarrier = (item: StackItem): item is Barrier => 'barrier' in item;

/** Deep enough to cover a working session, short enough that it cannot grow without bound. */
const CAPACITY = 50;

export interface HistorySnapshot {
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
    /** Set when the next undo would cross a barrier; carries the reason to show. */
    blockedBy: string | null;
}

export type HistoryResult =
    | { ok: true; label: string }
    | { ok: false; reason: string };

const EMPTY: HistorySnapshot = {
    canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, blockedBy: null,
};

class HistoryStore {
    private undoStack: StackItem[] = [];
    private redoStack: HistoryEntry[] = [];
    private workspaceId: string | null = null;
    private listeners = new Set<() => void>();
    /**
     * Cached because `useSyncExternalStore` compares snapshots by reference and would loop for
     * ever on a fresh object per call.
     */
    private snapshot: HistorySnapshot = EMPTY;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    getSnapshot = (): HistorySnapshot => this.snapshot;

    /** The server renders no history, so the server snapshot is always the empty one. */
    getServerSnapshot = (): HistorySnapshot => EMPTY;

    private publish() {
        const top = this.undoStack[this.undoStack.length - 1];
        const blocked = top && isBarrier(top) ? top.reason : null;
        const redoTop = this.redoStack[this.redoStack.length - 1];

        this.snapshot = {
            canUndo: !!top && !blocked,
            canRedo: !!redoTop,
            undoLabel: top && !isBarrier(top) ? top.label : null,
            redoLabel: redoTop ? redoTop.label : null,
            blockedBy: blocked,
        };
        this.listeners.forEach(l => l());
    }

    /**
     * Binds the stack to a file, clearing it when that changes.
     *
     * History is per-file: an entry that drops a column names a table in one workspace, and every
     * workspace has its own database, so replaying it anywhere else is meaningless.
     */
    reset(workspaceId: string | null) {
        if (this.workspaceId === workspaceId) return;
        this.workspaceId = workspaceId;
        this.undoStack = [];
        this.redoStack = [];
        this.publish();
    }

    push(entry: HistoryEntry) {
        // A new action makes the redo branch unreachable, which is what every editor does.
        this.undoStack = [...this.undoStack, entry].slice(-CAPACITY);
        this.redoStack = [];
        this.publish();
    }

    pushBarrier(reason: string) {
        const top = this.undoStack[this.undoStack.length - 1];
        // Consecutive barriers say the same thing; one is enough.
        if (top && isBarrier(top)) return;
        const marker: Barrier = { barrier: true, reason };
        this.undoStack = [...this.undoStack, marker].slice(-CAPACITY);
        this.redoStack = [];
        this.publish();
    }

    /** The next thing undo would do, so the caller can confirm a lossy one before committing. */
    peekUndo(): HistoryEntry | null {
        const top = this.undoStack[this.undoStack.length - 1];
        return top && !isBarrier(top) ? top : null;
    }

    async undo(): Promise<HistoryResult> {
        const top = this.undoStack[this.undoStack.length - 1];
        if (!top) return { ok: false, reason: 'Nothing to undo.' };
        if (isBarrier(top)) return { ok: false, reason: top.reason };

        this.undoStack = this.undoStack.slice(0, -1);
        this.publish();
        try {
            await top.undo();
            this.redoStack = [...this.redoStack, top].slice(-CAPACITY);
            this.publish();
            return { ok: true, label: top.label };
        } catch (e) {
            // The entry is left off the stack rather than put back. It has just demonstrated that
            // it cannot be reversed — usually because something changed underneath it — and a
            // retry would fail the same way while blocking everything beneath it for ever.
            this.publish();
            return { ok: false, reason: describe(e) };
        }
    }

    async redo(): Promise<HistoryResult> {
        const top = this.redoStack[this.redoStack.length - 1];
        if (!top) return { ok: false, reason: 'Nothing to redo.' };

        this.redoStack = this.redoStack.slice(0, -1);
        this.publish();
        try {
            await top.redo();
            this.undoStack = [...this.undoStack, top].slice(-CAPACITY);
            this.publish();
            return { ok: true, label: top.label };
        } catch (e) {
            this.publish();
            return { ok: false, reason: describe(e) };
        }
    }
}

const describe = (e: unknown): string => {
    const message = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
    return message || 'That could not be reversed.';
};

export const history = new HistoryStore();
