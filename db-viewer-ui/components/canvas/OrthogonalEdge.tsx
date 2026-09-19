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

/**
 * Crow's-foot notation.
 *
 * Drawn inline rather than as SVG `<marker>` elements, for two reasons: React Flow's `MarkerType`
 * only offers `Arrow` and `ArrowClosed`, and a marker inherits the path's stroke width, which at
 * 1.6px makes the foot invisible. Inline paths also let both ends be drawn from one component.
 *
 * No rotation maths is needed. `edgeRouting` guarantees every route leaves the source heading
 * right and enters the target heading right, so the source foot always opens to the left (back
 * into its table) and the target foot to the right.
 */
const GAP = 8;       // clearance from the table edge — the connection handle is 10px wide and
                     // sits on the border, so anything closer than this is drawn underneath it
const FOOT = 8;      // how far the notation extends along the line
const SPREAD = 4.5;  // half-height of the crow's foot
const BAR = 4.5;     // half-height of the "exactly one" bar
const RING = 3;      // radius of the "optional" circle

/**
 * One end's notation, as SVG path data.
 *
 * Everything is drawn *outside* the table, along the line. `dir` therefore points away from the
 * table the notation belongs to: +1 at the parent end (the line leaves heading right) and -1 at
 * the child end (it arrives from the left).
 *
 * @param x    where the line meets the table
 * @param dir  which way is "away from this table"
 * @param many a crow's foot rather than a single bar
 */
const footPath = (x: number, y: number, dir: number, many: boolean): string => {
    const base = x + dir * GAP;
    const tip = base + dir * FOOT;

    if (many) {
        // Three lines converging at the far point and fanning out towards the table, so the
        // "many" fans into the entity it describes.
        return `M ${tip} ${y} L ${base} ${y - SPREAD} M ${tip} ${y} L ${base} ${y} `
            + `M ${tip} ${y} L ${base} ${y + SPREAD}`;
    }
    // A single crossbar across the line.
    const at = base + dir * (FOOT / 2);
    return `M ${at} ${y - BAR} L ${at} ${y + BAR}`;
};

/** The optional-end circle, just beyond the foot so the two never overlap. */
const ringCentre = (x: number, dir: number): number => x + dir * (GAP + FOOT + RING + 1);

export interface EdgeCardinality {
    /** The foreign-key end can have many rows per parent. */
    childMany?: boolean;
    /** The foreign key is nullable, so the child may have no parent at all. */
    childOptional?: boolean;
    onDelete?: string;
    parentTable?: string;
    parentColumn?: string;
    childTable?: string;
    childColumn?: string;
}

/**
 * The relationship in a sentence.
 *
 * Crow's-foot notation is a convention, and a convention only communicates to people who already
 * know it. Everyone else sees a line with a fork on the end. This is the fallback that does not
 * assume anything — rendered as an SVG `<title>`, so hovering any part of the line explains it.
 */
const describeRelationship = (d: EdgeCardinality): string => {
    const parent = d.parentTable ?? 'the parent table';
    const child = d.childTable ?? 'the child table';
    const many = d.childMany ?? true;

    const sentence = many
        ? `One ${parent} row can have many ${child} rows.`
        : `One ${parent} row has at most one ${child} row.`;
    const optional = d.childOptional
        ? ` A ${child} row does not have to have one — the key allows nulls.`
        : ` Every ${child} row must have one.`;
    const join = d.childColumn && d.parentColumn
        ? ` Joined on ${child}.${d.childColumn} → ${parent}.${d.parentColumn}.`
        : '';
    const cascade = d.onDelete
        ? ` Deleting a ${parent} row: ON DELETE ${d.onDelete}.`
        : '';

    return sentence + optional + join + cascade;
};

/** How the two ends read as text: the "1" and "N" printed beside the notation. */
const endLabels = (many: boolean): { parent: string; child: string } =>
    ({ parent: '1', child: many ? 'N' : '1' });

export const OrthogonalEdge = memo(({
    id, source, target, sourceX, sourceY, targetX, targetY, style, markerEnd, interactionWidth, data,
}: EdgeProps<EdgeCardinality>) => {
    const rects = useStore(selectNodeRects, areRectsEqual);

    const path = useMemo(() => {
        // The two nodes this edge connects are not obstacles: it has to touch them.
        const obstacles = rects.filter(r => r.id !== source && r.id !== target);
        return toRoundedPath(routeEdge(
            { x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles));
    }, [rects, source, target, sourceX, sourceY, targetX, targetY]);

    // `source` is the referenced (parent) table and `target` holds the foreign key — see
    // `transformRelationshipsToEdges`. So the parent end is always "exactly one".
    const notation = data ? {
        // Parent end: exactly one, always — a foreign key must point at a unique column.
        parent: footPath(sourceX, sourceY, 1, false),
        child: footPath(targetX, targetY, -1, data.childMany ?? true),
        childOptional: data.childOptional ?? false,
        labels: endLabels(data.childMany ?? true),
        description: describeRelationship(data),
    } : null;

    const stroke = (style?.stroke as string) ?? 'var(--color-edge)';

    return (
        <>
            <path
                id={id}
                d={path}
                fill="none"
                className="react-flow__edge-path"
                style={style}
                // The arrowhead and the crow's foot say the same thing in two notations, and
                // drawn together they collide. Notation wins where we have it.
                markerEnd={notation ? undefined : markerEnd}
            />

            {notation && (
                <g className="react-flow__edge-cardinality" style={{ opacity: style?.opacity }}>
                    {/* Hovering anywhere on the line says what the relationship is, in words.
                        A native <title> rather than a styled tooltip: it costs nothing, works on
                        an SVG path where an HTML tooltip would need its own positioning, and the
                        notation is not supposed to depend on it anyway. */}
                    <title>{notation.description}</title>

                    <path d={notation.parent} fill="none" stroke={stroke} strokeWidth={1.6}
                          strokeLinecap="round" />
                    <path d={notation.child} fill="none" stroke={stroke} strokeWidth={1.6}
                          strokeLinecap="round" />

                    {/* "1" and "N" beside each foot. Redundant if you read crow's foot fluently,
                        and the whole point if you do not. */}
                    <text
                        x={sourceX + GAP + FOOT + 4} y={sourceY - 5}
                        className="react-flow__edge-endlabel"
                        fill={stroke} fontSize={9} fontWeight={700} textAnchor="start"
                    >
                        {notation.labels.parent}
                    </text>
                    <text
                        x={targetX - (GAP + FOOT + (notation.childOptional ? RING * 2 + 2 : 0)) - 4}
                        y={targetY - 5}
                        className="react-flow__edge-endlabel"
                        fill={stroke} fontSize={9} fontWeight={700} textAnchor="end"
                    >
                        {notation.labels.child}
                    </text>
                    {notation.childOptional && (
                        // Filled with the canvas colour, not "none": the line runs underneath, and
                        // an unfilled ring reads as a bead on a wire rather than "zero or one".
                        <circle cx={ringCentre(targetX, -1)} cy={targetY} r={RING}
                                fill="var(--color-canvas)" stroke={stroke} strokeWidth={1.4} />
                    )}
                </g>
            )}
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
