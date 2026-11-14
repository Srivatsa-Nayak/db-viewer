import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { dbService } from '@/services/api';
import { history } from '@/services/history';
import type { ToastState } from '@/components/ui/ActionToast';
import type { CanvasGroup, TagColour } from '@/types';
import type { Workspace } from '@/types/workspace';

type WriteGroup = (id: string, group: CanvasGroup | null, label: string, record?: boolean) => Promise<void>;

/**
 * Domain groups — the labelled boxes around a set of tables — and their four operations.
 *
 * A group stores members, not geometry (see `GroupBox`), so every operation is the same write
 * with a different payload. Each handler is stable, because the group nodes carry them.
 */
export const useDomainGroups = (
    activeWorkspaceIdRef: MutableRefObject<string | null>,
    activeWorkspaceRef: MutableRefObject<Workspace | null>,
    setWorkspaces: Dispatch<SetStateAction<Workspace[]>>,
    showToast: (toast: ToastState) => void,
) => {
    /**
     * Writes a group, or removes it when `group` is null, and keeps the canvas in step.
     *
     * One function for create, rename, recolour and ungroup, which makes each one's inverse
     * another call to this with the previous value. `record: false` is how an undo avoids
     * pushing an entry of its own and leaving Ctrl+Z toggling for ever.
     */
    /** The function reaching itself for its undo entries; filled in an effect, as lint requires. */
    const writeGroupRef = useRef<WriteGroup | null>(null);

    const writeGroup: WriteGroup = useCallback(async (
        id: string, group: CanvasGroup | null, label: string, record = true,
    ) => {
        const workspaceId = activeWorkspaceIdRef.current;
        if (!workspaceId) return;

        let previous: CanvasGroup | undefined;
        setWorkspaces(prev => prev.map(w => {
            if (w.id !== workspaceId) return w;
            previous = w.groups.find(g => g.id === id);
            const others = w.groups.filter(g => g.id !== id);
            return { ...w, groups: group ? [...others, group] : others };
        }));

        try {
            if (group) await dbService.setCanvasMeta('group', id, group);
            else await dbService.deleteCanvasMeta('group', id);

            if (record) {
                const before = previous;
                history.push({
                    label,
                    undo: async () => { await writeGroupRef.current?.(id, before ?? null, label, false); },
                    redo: async () => { await writeGroupRef.current?.(id, group, label, false); },
                });
            }
        } catch (e) {
            console.error('Could not save the group', e);
            setWorkspaces(prev => prev.map(w => {
                if (w.id !== workspaceId) return w;
                const others = w.groups.filter(g => g.id !== id);
                return { ...w, groups: previous ? [...others, previous] : others };
            }));
        }
    }, [activeWorkspaceIdRef, setWorkspaces]);

    useEffect(() => { writeGroupRef.current = writeGroup; }, [writeGroup]);

    const handleCreateGroup = useCallback((tables: string[]) => {
        // Pressing the toolbar button with nothing selected is how most people will first meet
        // this, so it answers rather than doing nothing: the gesture that selects tables is
        // invisible, and a button that silently ignores you teaches nothing.
        if (tables.length < 2) {
            showToast({
                message: 'Select two or more tables first — hold Shift and drag a box around them, '
                    + 'or Ctrl-click each one.',
                tone: 'error',
            });
            return;
        }
        // Letters, digits and underscores only: the backend validates the reference as an
        // identifier and would rewrite a hyphen, leaving the two sides naming different groups.
        const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const existing = activeWorkspaceRef.current?.groups.length ?? 0;
        void writeGroup(id, { id, name: `Group ${existing + 1}`, tables }, `Group ${tables.length} tables`);
        showToast({ message: `Grouped ${tables.length} tables`, tone: 'ok' });
    }, [writeGroup, showToast, activeWorkspaceRef]);

    const handleRenameGroup = useCallback((id: string, name: string) => {
        const group = activeWorkspaceRef.current?.groups.find(g => g.id === id);
        if (!group) return;
        void writeGroup(id, { ...group, name }, `Rename group to ${name}`);
    }, [writeGroup, activeWorkspaceRef]);

    const handleGroupColour = useCallback((id: string, colour: TagColour | undefined) => {
        const group = activeWorkspaceRef.current?.groups.find(g => g.id === id);
        if (!group) return;
        void writeGroup(id, { ...group, colour }, `Colour group ${group.name}`);
    }, [writeGroup, activeWorkspaceRef]);

    const handleUngroup = useCallback((id: string) => {
        const group = activeWorkspaceRef.current?.groups.find(g => g.id === id);
        if (!group) return;
        void writeGroup(id, null, `Ungroup ${group.name}`);
        showToast({ message: `Removed the ${group.name} box. The tables are untouched.`, tone: 'ok' });
    }, [writeGroup, showToast, activeWorkspaceRef]);

    return { handleCreateGroup, handleRenameGroup, handleGroupColour, handleUngroup };
};
