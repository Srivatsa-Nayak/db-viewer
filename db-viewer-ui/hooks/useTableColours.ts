import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { dbService } from '@/services/api';
import { history } from '@/services/history';
import type { TagColour } from '@/types';
import type { NodeDecoration, Workspace } from '@/types/workspace';

type ColourChange = (tableName: string, colour: TagColour | undefined, record?: boolean) => Promise<void>;

/**
 * Setting and clearing a table's colour, optimistically, with an undo entry.
 *
 * Optimistic because the alternative is a visible lag on what reads as a pure UI gesture, and
 * the cost of being wrong is one wrong colour until the next refresh — not lost work. On
 * failure the previous decoration goes back, so the canvas never disagrees with the server for
 * longer than the round trip. Returns a stable callback: it is stored in every node's `data`.
 */
export const useTableColours = (
    activeWorkspaceIdRef: MutableRefObject<string | null>,
    setWorkspaces: Dispatch<SetStateAction<Workspace[]>>,
) => {
    /**
     * The handler reaching itself, for the undo it registers. A `useCallback` cannot close over
     * itself; the ref is filled in an effect, because writing one during render is what
     * `react-hooks/refs` forbids.
     */
    const selfRef = useRef<ColourChange | null>(null);

    const handleColourChange: ColourChange = useCallback(async (
        tableName: string, colour: TagColour | undefined, record = true,
    ) => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;

        let previous: NodeDecoration | undefined;
        setWorkspaces(prev => prev.map(w => {
            if (w.id !== workspaceId) return w;
            previous = w.decorations[tableName];
            const next = { ...w.decorations };
            const decoration = { ...next[tableName], colour };
            if (!decoration.colour && !decoration.tag) delete next[tableName];
            else next[tableName] = decoration;
            return { ...w, decorations: next };
        }));

        try {
            const decoration = { ...previous, colour };
            if (!decoration.colour && !decoration.tag) {
                await dbService.deleteCanvasMeta('table', tableName);
            } else {
                await dbService.setCanvasMeta('table', tableName, decoration);
            }
            // `record` is false when the call *is* an undo, so reversing a colour does not push
            // a fresh entry and leave Ctrl+Z toggling between two colours for ever.
            if (record) {
                const before = previous?.colour;
                history.push({
                    label: colour ? `Colour ${tableName}` : `Clear colour on ${tableName}`,
                    undo: async () => { await selfRef.current?.(tableName, before, false); },
                    redo: async () => { await selfRef.current?.(tableName, colour, false); },
                });
            }
        } catch (e) {
            console.error('Could not save the table colour', e);
            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;
                const next = { ...w.decorations };
                if (previous) next[tableName] = previous;
                else delete next[tableName];
                return { ...w, decorations: next };
            }));
        }
    }, [activeWorkspaceIdRef, setWorkspaces]);

    useEffect(() => { selfRef.current = handleColourChange; }, [handleColourChange]);

    return handleColourChange;
};
