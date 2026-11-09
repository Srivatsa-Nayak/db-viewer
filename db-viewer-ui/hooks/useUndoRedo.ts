"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ToastState } from '@/components/ui/ActionToast';
import { history, HistorySnapshot } from '@/services/history';

/**
 * The editor's side of `services/history.ts`: reading the stack, the toasts that report each
 * step, the confirmation for a lossy undo, and the keyboard shortcuts.
 *
 * The stack itself stays a module singleton (see `history.ts` for why); this hook is what the
 * page used to do with it inline.
 */
export const useUndoRedo = (
    activeWorkspaceId: string | null,
    showToast: (toast: ToastState) => void,
) => {
    /** Set when Ctrl+Z lands on a lossy entry: the confirmation shows before anything runs. */
    const [pendingLossyUndo, setPendingLossyUndo] = useState<string | null>(null);

    const historyState: HistorySnapshot = useSyncExternalStore(
        history.subscribe, history.getSnapshot, history.getServerSnapshot);

    const runUndo = useCallback(async () => {
        const result = await history.undo();
        if (result.ok) {
            showToast({
                message: `Undid: ${result.label}`,
                tone: 'ok',
                action: { label: 'Redo', onClick: () => { void history.redo(); } },
            });
        } else {
            showToast({ message: result.reason, tone: 'error' });
        }
    }, [showToast]);

    const requestUndo = useCallback(() => {
        const next = history.peekUndo();
        if (!next) {
            const { blockedBy } = history.getSnapshot();
            if (blockedBy) showToast({ message: blockedBy, tone: 'error' });
            return;
        }
        // A lossy inverse cannot put back what the forward change destroyed, so it asks first
        // rather than quietly doing something irreversible in the name of reversing something.
        if (next.lossy) { setPendingLossyUndo(next.label); return; }
        void runUndo();
    }, [runUndo, showToast]);

    const requestRedo = useCallback(async () => {
        const result = await history.redo();
        showToast(result.ok
            ? { message: `Redid: ${result.label}`, tone: 'ok' }
            : { message: result.reason, tone: 'error' });
    }, [showToast]);

    const confirmLossyUndo = useCallback(() => {
        setPendingLossyUndo(null);
        void runUndo();
    }, [runUndo]);

    const cancelLossyUndo = useCallback(() => setPendingLossyUndo(null), []);

    /**
     * Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y), following the Ctrl+F precedent in `Visualizer` — with
     * two guards it does not need.
     *
     * A dialog on top means the canvas is not what is being read. And an editable element means
     * the keystroke belongs to whoever is typing: stealing it there would undo a *schema change*
     * while somebody is halfway through a cell, which is both surprising and unrecoverable.
     */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key !== 'z' && key !== 'y') return;
            if (document.body.dataset.dialogOpen === 'true') return;

            const target = event.target as HTMLElement | null;
            if (target?.isContentEditable) return;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            event.preventDefault();
            if (key === 'y' || event.shiftKey) void requestRedo();
            else requestUndo();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [requestUndo, requestRedo]);

    /** History is per-file: an entry naming a table in one workspace means nothing in another. */
    useEffect(() => { history.reset(activeWorkspaceId); }, [activeWorkspaceId]);

    return {
        historyState, requestUndo, requestRedo, pendingLossyUndo, confirmLossyUndo, cancelLossyUndo,
    };
};
