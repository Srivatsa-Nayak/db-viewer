"use client";

import React, { memo, useCallback, useMemo, useState } from 'react';
import ReactFlow, {
    applyNodeChanges, Background, BackgroundVariant, Edge, Handle, MarkerType, Node, NodeChange,
    Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Database, KeyRound, Link2 } from 'lucide-react';
import { OrthogonalEdge } from '@/components/canvas/OrthogonalEdge';

/**
 * A real, draggable schema canvas for the marketing and documentation pages.
 *
 * Not a picture of one. The previous hero was an SVG mock-up, which is the conventional choice
 * and the wrong one for this product: the whole claim is "your file becomes a diagram you can
 * move around", and a drawing of that asks the reader to take it on faith for the length of a
 * sign-up. This is the same React Flow canvas the editor runs, with the same orthogonal edge
 * router, so the first thing anyone does — grab a table and drag it — works before they have
 * clicked anything.
 *
 * What it is *not* is connected to a backend. There is no workspace, no upload and no account:
 * the schema is a literal in the caller's file. That keeps the landing page fast and means a
 * documentation example cannot break because a server is down.
 */

export interface DemoColumn {
    name: string;
    type: string;
    pk?: boolean;
    fk?: boolean;
}

export interface DemoTable {
    name: string;
    columns: DemoColumn[];
    position: { x: number; y: number };
}

export interface DemoRelationship {
    /** The table holding the foreign key. */
    from: string;
    fromColumn: string;
    /** The table it points at. */
    to: string;
    toColumn: string;
}

interface DemoNodeData {
    label: string;
    columns: DemoColumn[];
    /** Milliseconds to wait before this table blooms in. */
    delay?: number;
}

/**
 * A compact read-only table.
 *
 * Deliberately a separate component from the editor's `TableNode` rather than a prop-flagged
 * version of it: that one carries five action buttons, three lazy-loaded dialogs and a refresh
 * callback, none of which mean anything without a workspace behind them.
 *
 * The bloom animation is on the inner element, never on the React Flow node wrapper — the
 * wrapper's `transform` is how React Flow positions the node, and an animation on it would
 * detach every table from its coordinates.
 */
const DemoTableNode = memo(({ data }: { data: DemoNodeData }) => (
    <div
        className="demo-node rounded-md border border-brand-200 bg-surface shadow-glow-md"
        style={data.delay ? { animationDelay: `${data.delay}ms` } : undefined}
    >
        <div className="brand-gradient flex items-center gap-1.5 rounded-t-md px-2 py-1.5">
            <Database size={10} className="shrink-0 text-white" />
            <span className="truncate text-[10px] font-bold leading-tight text-white">{data.label}</span>
        </div>

        <div className="flex flex-col rounded-b-md bg-ink-50 py-0.5">
            {data.columns.map(column => (
                <div key={column.name} className="relative flex h-[22px] items-center justify-between gap-3 px-2">
                    {column.fk && (
                        <Handle
                            type="target"
                            position={Position.Left}
                            id={`${column.name}-left`}
                            isConnectable={false}
                            className="!h-2 !w-2 !border-2 !bg-key-fk"
                        />
                    )}

                    <span className="flex items-center gap-1 overflow-hidden">
                        {column.pk
                            ? <KeyRound size={8} className="shrink-0 text-key-pk" />
                            : column.fk
                                ? <Link2 size={8} className="shrink-0 text-key-fk" />
                                : null}
                        <span className={`truncate font-mono text-[9px] leading-none ${
                            column.pk ? 'font-bold text-key-pk'
                                : column.fk ? 'font-semibold text-key-fk' : 'font-medium text-ink-700'
                        }`}>
                            {column.name}
                        </span>
                    </span>

                    <span className="shrink-0 font-mono text-[8px] uppercase leading-none text-ink-400">
                        {column.type}
                    </span>

                    {(column.pk || column.fk) && (
                        <Handle
                            type="source"
                            position={Position.Right}
                            id={`${column.name}-right`}
                            isConnectable={false}
                            className={`!h-2 !w-2 !border-2 ${column.pk ? '!bg-key-pk' : '!bg-key-fk'}`}
                        />
                    )}
                </div>
            ))}
        </div>
    </div>
));
DemoTableNode.displayName = 'DemoTableNode';

/** The starting layout. Built once — see the note on `nodes` below for why that matters. */
const buildNodes = (tables: DemoTable[], bloomStep: number): Node[] => tables.map((table, index) => ({
    id: table.name,
    type: 'demoTable',
    position: table.position,
    data: {
        label: table.name,
        columns: table.columns,
        delay: bloomStep ? index * bloomStep : undefined,
    } satisfies DemoNodeData,
}));

// Module scope: React Flow rebuilds its internal registry when either is a new object.
const nodeTypes = { demoTable: DemoTableNode };
const edgeTypes = { orthogonal: OrthogonalEdge };
const proOptions = { hideAttribution: true };

interface DemoCanvasProps {
    tables: DemoTable[];
    relationships: DemoRelationship[];
    /** Tables to strike through — the refused-delete demonstration. */
    blockedTables?: string[];
    /** Stagger, in ms, between each table blooming in. 0 shows them all at once. */
    bloomStep?: number;
    /** Delay before the first edge is drawn. */
    edgeDelay?: number;
    /** False for a purely decorative canvas; true lets the reader drag the tables. */
    interactive?: boolean;
    className?: string;
    ariaLabel: string;
}

export const DemoCanvas = ({
    tables, relationships, blockedTables = [], bloomStep = 0, edgeDelay = 0,
    interactive = true, className = '', ariaLabel,
}: DemoCanvasProps) => {
    /**
     * The nodes, owned here and changed only through React Flow's own change list.
     *
     * The first version of this kept a map of dragged positions and rebuilt the whole node array
     * from props on every frame. It dragged correctly and it strobed: handing React Flow a fresh
     * object for every node makes it rebuild all of its node internals, and for the frames where
     * the rebuilt internals have not been measured again, an edge cannot resolve the handles it
     * attaches to — so it renders nothing. Measured over a drag, *every* relationship line
     * disappeared on roughly a quarter of the frames while the tables stayed put, which is what
     * "the tables keep flickering" actually was.
     *
     * `applyNodeChanges` is the fix and the canonical pattern: it returns the same objects for
     * the nodes that did not change, so only the table under the cursor is ever replaced. The
     * editor canvas has always done this, which is why it never had the problem.
     *
     * The consequence is that `tables` is the *initial* layout. Both callers already remount the
     * canvas (`key`) when the schema itself changes, which is the honest way to express "this is
     * a different diagram now" and also resets the bloom.
     */
    const [nodes, setNodes] = useState<Node[]>(() => buildNodes(tables, bloomStep));

    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setNodes(current => applyNodeChanges(changes, current));
    }, []);

    /**
     * The refused-delete styling, applied as a class rather than through `data`.
     *
     * Same reasoning: touching `data` would mean a new object for that node, and this recomputes
     * on every drag frame. Comparing the class first means an unchanged node keeps its identity
     * and the whole array keeps its own.
     */
    const blockedKey = blockedTables.join('|');
    const renderedNodes = useMemo(() => {
        const blocked = new Set(blockedKey ? blockedKey.split('|') : []);
        let changed = false;
        const next = nodes.map(node => {
            const nodeClass = blocked.has(node.id) ? 'demo-node-blocked' : undefined;
            if (node.className === nodeClass) return node;
            changed = true;
            return { ...node, className: nodeClass };
        });
        return changed ? next : nodes;
    }, [nodes, blockedKey]);

    const edges: Edge[] = useMemo(() => relationships.map((rel, index) => ({
        id: `demo-${index}`,
        // Reversed on purpose: the arrow points from the table that is referenced towards the
        // table doing the referencing, which is the direction the editor draws it too.
        source: rel.to,
        target: rel.from,
        sourceHandle: `${rel.toColumn}-right`,
        targetHandle: `${rel.fromColumn}-left`,
        type: 'orthogonal',
        className: edgeDelay ? 'demo-edge-draw' : undefined,
        style: {
            stroke: 'var(--color-edge)',
            strokeWidth: 1.6,
            ...(edgeDelay ? { animationDelay: `${edgeDelay + index * 140}ms` } : {}),
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-edge)', width: 14, height: 14 },
    })), [relationships, edgeDelay]);

    return (
        <div className={`bg-canvas ${className}`} role="img" aria-label={ariaLabel}>
            <ReactFlow
                nodes={renderedNodes}
                edges={edges}
                onNodesChange={onNodesChange}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                proOptions={proOptions}
                fitView
                fitViewOptions={{ padding: 0.14 }}
                minZoom={0.4}
                maxZoom={1.6}
                nodesDraggable={interactive}
                // Off: React Flow pans the viewport when a dragged node nears the edge of the
                // pane, which on a canvas this small starts almost immediately and slides the
                // whole diagram out from under the cursor. Useful in an editor you are laying
                // out; disorienting in a panel you are just poking at.
                autoPanOnNodeDrag={false}
                nodesConnectable={false}
                elementsSelectable={false}
                panOnDrag={interactive}
                zoomOnDoubleClick={false}
                // The canvas sits in the middle of a page people are scrolling through. Capturing
                // the wheel to zoom would trap them in it, which is the classic embedded-map
                // mistake; pinch and the +/- controls in the app are the places for zoom.
                zoomOnScroll={false}
                zoomOnPinch={false}
                preventScrolling={false}
            >
                <Background color="#94a3b8" gap={22} size={1.2} variant={BackgroundVariant.Dots} />
            </ReactFlow>
        </div>
    );
};

export default DemoCanvas;
