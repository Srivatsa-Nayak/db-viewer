"use client";

import { Dispatch, MutableRefObject, SetStateAction, useCallback, useRef } from 'react';
import type { Node } from 'reactflow';
import type { GroupBoxData } from '@/components/canvas/GroupBox';
import { history } from '@/services/history';
import { GROUP_NODE_PREFIX } from '@/services/schemaGraph';
import type { Workspace } from '@/types/workspace';

type Point = { x: number; y: number };

/**
 * Node drags as undoable steps, and group boxes that move their tables.
 *
 * Moved out of `page.tsx` unchanged. It writes positions through the page's `setWorkspaces`,
 * because the layout lives on the workspace; the refs are read rather than closed over, so the
 * handlers stay stable for React Flow.
 */
export const useNodeDragHistory = (
    activeWorkspaceIdRef: MutableRefObject<string | null>,
    activeWorkspaceRef: MutableRefObject<Workspace | null>,
    setWorkspaces: Dispatch<SetStateAction<Workspace[]>>,
) => {
    /** Moves named nodes outright. The undo and redo of a drag are both just this. */
    const placeNodes = useCallback((positions: Record<string, Point>) => {
        setWorkspaces(prev => prev.map(w => w.id !== activeWorkspaceIdRef.current ? w : {
            ...w,
            nodes: w.nodes.map(n => positions[n.id] ? { ...n, position: positions[n.id] } : n),
        }));
    }, [activeWorkspaceIdRef, setWorkspaces]);

    /**
     * Where the dragged nodes were when the gesture began.
     *
     * Taken from React Flow's drag *callbacks* rather than from `onNodesChange`: a drag emits a
     * position change on every mouse move, so reading those would put a hundred entries on the
     * stack for one gesture — and the bookkeeping would have to happen inside the
     * `setWorkspaces` updater, which React is free to run twice. Start and stop fire once each.
     */
    const dragOriginRef = useRef<Record<string, Point>>({});

    /**
     * Where a group box was when its drag began, and where each of its tables was. A group's
     * position is derived from its members, so the box's movement is read as an instruction and
     * applied to the tables instead — which moves the box, because the box *is* the tables.
     */
    const groupDragRef = useRef<{ id: string; from: Point; members: Record<string, Point> } | null>(null);

    const handleNodeDragStart = useCallback((_: unknown, node: Node, dragged: Node[]) => {
        if (node.id.startsWith(GROUP_NODE_PREFIX)) {
            const group = (node.data as GroupBoxData | undefined)?.group;
            const nodes = activeWorkspaceRef.current?.nodes ?? [];
            groupDragRef.current = {
                id: node.id,
                from: { ...node.position },
                members: Object.fromEntries(nodes
                    .filter(n => group?.tables.includes(n.id))
                    .map(n => [n.id, { ...n.position }])),
            };
            return;
        }
        dragOriginRef.current = Object.fromEntries(dragged.map(n => [n.id, { ...n.position }]));
    }, [activeWorkspaceRef]);

    /** Translates a group's tables as its box is dragged. */
    const handleNodeDrag = useCallback((_: unknown, node: Node) => {
        const drag = groupDragRef.current;
        if (!drag || drag.id !== node.id) return;
        const dx = node.position.x - drag.from.x;
        const dy = node.position.y - drag.from.y;
        placeNodes(Object.fromEntries(Object.entries(drag.members)
            .map(([id, at]) => [id, { x: at.x + dx, y: at.y + dy }])));
    }, [placeNodes]);

    const handleNodeDragStop = useCallback((_: unknown, node: Node, dragged: Node[]) => {
        const groupDrag = groupDragRef.current;
        if (groupDrag && groupDrag.id === node.id) {
            groupDragRef.current = null;
            const dx = node.position.x - groupDrag.from.x;
            const dy = node.position.y - groupDrag.from.y;
            if (dx === 0 && dy === 0) return;

            const before = groupDrag.members;
            const after = Object.fromEntries(Object.entries(before)
                .map(([id, at]) => [id, { x: at.x + dx, y: at.y + dy }]));
            history.push({
                label: `Move ${Object.keys(before).length} tables`,
                undo: async () => placeNodes(before),
                redo: async () => placeNodes(after),
            });
            return;
        }

        const from = dragOriginRef.current;
        dragOriginRef.current = {};

        const to: Record<string, Point> = {};
        let moved = false;
        for (const n of dragged) {
            const origin = from[n.id];
            if (!origin) continue;
            to[n.id] = { ...n.position };
            if (origin.x !== n.position.x || origin.y !== n.position.y) moved = true;
        }
        // A click that shifted nothing is not a step worth undoing.
        if (!moved) return;

        const before = Object.fromEntries(Object.keys(to).map(id => [id, from[id]]));
        history.push({
            label: dragged.length > 1 ? `Move ${dragged.length} tables` : `Move ${dragged[0].id}`,
            undo: async () => placeNodes(before),
            redo: async () => placeNodes(to),
        });
    }, [placeNodes]);

    return { handleNodeDragStart, handleNodeDrag, handleNodeDragStop };
};
