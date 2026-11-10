import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { dbService } from '@/services/api';
import type { Notice } from '@/components/modal/NoticeModal';
import type { Workspace } from '@/types/workspace';

/**
 * How long a dropped table lingers as a ghost before the delete is really sent.
 *
 * Long enough to notice the mistake and reach the button, short enough that the canvas is not
 * lying about what the database contains for any length of time. The same number drives the
 * drain bar on the node, passed down rather than duplicated in CSS.
 */
export const GHOST_MS = 7000;

export interface Ghost {
    table: string;
    workspaceId: string;
}

/**
 * Deleting a table defers the drop; it does not undo one.
 *
 * Confirming leaves a greyed ghost on the canvas with an Undo button, and `DELETE /table/{name}`
 * is only sent when `GHOST_MS` runs out. Nothing is snapshotted and nothing is restored, because
 * until then nothing has happened — which also means closing the tab, navigating away or losing
 * the network all fail in the direction of *not* dropping the table.
 *
 * @param afterDropRef what to run once a drop has gone through (re-read the schema and the
 *                     notes). A ref, because those callbacks are built after this hook and carry
 *                     its `requestTableDelete` in node data.
 */
export const useTableGhosts = (
    activeWorkspaceIdRef: MutableRefObject<string | null>,
    activeWorkspaceRef: MutableRefObject<Workspace | null>,
    setNotice: (notice: Notice) => void,
    afterDropRef: MutableRefObject<() => Promise<void>>,
) => {
    /** The table the confirm dialog is asking about. */
    const [tableToDelete, setTableToDelete] = useState<string | null>(null);
    /**
     * Tables whose delete has been agreed to but not yet sent. Keyed by table name and carrying
     * the workspace it belongs to, because the delete is workspace-scoped through a request
     * header: a timer that fired after the user switched files would otherwise drop a
     * same-named table in the wrong database.
     */
    const [ghosts, setGhosts] = useState<Ghost[]>([]);
    /** The pending `setTimeout` per ghost. A ref: nothing renders from it. */
    const ghostTimers = useRef<Map<string, number>>(new Map());

    // Leaving the page cancels every pending drop — the fail-safe direction. A table that is
    // still there can be deleted again; one that is gone cannot be brought back.
    useEffect(() => {
        const timers = ghostTimers.current;
        return () => {
            timers.forEach(id => window.clearTimeout(id));
            timers.clear();
        };
    }, []);

    /** Stable: stored in every node's `data`. */
    const requestTableDelete = useCallback((tableName: string) => setTableToDelete(tableName), []);
    const cancelTableDelete = useCallback(() => setTableToDelete(null), []);

    /** Cancels the countdown. Nothing to restore — the drop was never sent. */
    const handleUndoDelete = useCallback((tableName: string) => {
        const timer = ghostTimers.current.get(tableName);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            ghostTimers.current.delete(tableName);
        }
        setGhosts(prev => prev.filter(g => g.table !== tableName));
    }, []);

    /**
     * The delete, finally sent. Re-checks which file is open first: abandoning is right when the
     * user has moved on, and not deleting is the recoverable half of the two mistakes.
     */
    const commitTableDelete = useCallback(async (tableName: string, workspaceId: string) => {
        if (activeWorkspaceIdRef.current !== workspaceId) {
            setGhosts(prev => prev.filter(g => g.table !== tableName));
            return;
        }
        try {
            await dbService.dropTable(tableName);
            setGhosts(prev => prev.filter(g => g.table !== tableName));
            await afterDropRef.current();
        } catch (err: unknown) {
            const response = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { status?: number; data?: { error?: string; referencedBy?: string[] } } }).response
                : undefined;
            // The node comes back to life rather than staying a ghost over a table that is
            // still there — the canvas must not go on claiming something the database denies.
            setGhosts(prev => prev.filter(g => g.table !== tableName));
            setNotice({
                isOpen: true,
                // 409 is the expected, meaningful case: another table depends on this one.
                severity: response?.status === 409 ? 'warning' : 'error',
                title: response?.status === 409 ? 'Table is still referenced' : 'Could not delete the table',
                message: response?.data?.error || `${tableName} could not be deleted.`,
                details: response?.data?.referencedBy?.map(t => `${t} has a foreign key pointing at this table`),
            });
        }
    }, [activeWorkspaceIdRef, afterDropRef, setNotice]);

    /** Confirming starts a countdown; it does not call the backend. */
    const confirmTableDelete = useCallback(() => {
        const tableName = tableToDelete;
        const workspaceId = activeWorkspaceIdRef.current;
        if (!tableName || !workspaceId) return;
        setTableToDelete(null);

        // Refused here rather than seven seconds from here. The backend still answers 409, but
        // only after the countdown — the user would watch a table fade out and then be told it
        // was never going anywhere. Everything needed to know is already on screen.
        const referencedBy = Array.from(new Set(
            (activeWorkspaceRef.current?.relationships ?? [])
                .filter(rel => rel.targetTable === tableName && rel.sourceTable !== tableName)
                .map(rel => rel.sourceTable)
        ));
        if (referencedBy.length > 0) {
            setNotice({
                isOpen: true,
                severity: 'warning',
                title: 'Table is still referenced',
                message: `${tableName} cannot be deleted while other tables point at it. `
                    + 'Remove those foreign keys first, or delete those tables.',
                details: referencedBy.map(t => `${t} has a foreign key pointing at this table`),
            });
            return;
        }

        setGhosts(prev => prev.some(g => g.table === tableName && g.workspaceId === workspaceId)
            ? prev
            : [...prev, { table: tableName, workspaceId }]);

        const timer = window.setTimeout(() => {
            ghostTimers.current.delete(tableName);
            void commitTableDelete(tableName, workspaceId);
        }, GHOST_MS);
        ghostTimers.current.set(tableName, timer);
    }, [tableToDelete, activeWorkspaceIdRef, activeWorkspaceRef, setNotice, commitTableDelete]);

    return {
        ghosts, tableToDelete,
        requestTableDelete, cancelTableDelete, confirmTableDelete, handleUndoDelete,
    };
};
