"use client";

import { memo, useMemo } from 'react';
import { EdgeProps, useStore, ReactFlowState } from 'reactflow';
import { Rect, routeEdge, toRoundedPath } from './edgeRouting';

/**
 * A relationship line that turns right angles and goes around the tables in its way.
 *
 * The obstacles come from React Flow's own store rather than from props, because they have to be
 * the *current* positions: an edge re-renders while a node is being dragged, and a route computed
 * from a stale layout snaps a frame behind the box it is avoiding.
 */

/**
 * Every node's measured rectangle, as a plain array.
 *
 * The selector returns a new array on every store change, which is exactly what is wanted here —
 * the route depends on the layout, so an edge that did not re-render when a node moved would be
 * wrong. `useStore`'s equality check keeps that to changes that actually move something.
 */
const selectNodeRects = (state: ReactFlowState): (Rect & { id: string })[] => {
    const rects: (Rect & { id: string })[] = [];
    state.nodeInternals.forEach(node => {
        // width/height are null until React Flow has measured the node; a zero-size obstacle is
        // worse than none, because it silently stops blocking anything.
        if (!node.width || !node.height) return;
        rects.push({
            id: node.id,
            x: node.positionAbsolute?.x ?? node.position.x,
            y: node.positionAbsolute?.y ?? node.position.y,
            width: node.width,
            height: node.height,
        });
    });
    return rects;
};

const areRectsEqual = (a: (Rect & { id: string })[], b: (Rect & { id: string })[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].x !== b[i].x || a[i].y !== b[i].y
            || a[i].width !== b[i].width || a[i].height !== b[i].height) {
            return false;
        }
    }
    return true;
};

export const OrthogonalEdge = memo(({
    id, source, target, sourceX, sourceY, targetX, targetY, style, markerEnd, interactionWidth,
}: EdgeProps) => {
    const rects = useStore(selectNodeRects, areRectsEqual);

    const path = useMemo(() => {
        // The two nodes this edge connects are not obstacles: it has to touch them.
        const obstacles = rects.filter(r => r.id !== source && r.id !== target);
        return toRoundedPath(routeEdge(
            { x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles));
    }, [rects, source, target, sourceX, sourceY, targetX, targetY]);

    return (
        <>
            <path
                id={id}
                d={path}
                fill="none"
                className="react-flow__edge-path"
                style={style}
                markerEnd={markerEnd}
            />
            {/* A 1.5px line is almost impossible to hover or tap. This invisible twin widens the
                target without widening the line. */}
            <path
                d={path}
                fill="none"
                strokeOpacity={0}
                strokeWidth={interactionWidth ?? 16}
                className="react-flow__edge-interaction"
            />
        </>
    );
});

OrthogonalEdge.displayName = 'OrthogonalEdge';
