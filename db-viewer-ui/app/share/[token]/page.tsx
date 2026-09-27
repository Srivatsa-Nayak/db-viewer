"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Database, Loader2, AlertCircle, KeyRound, Eye, ExternalLink } from "lucide-react";
import ReactFlow, {
    Background, BackgroundVariant, Controls, Edge, Handle, Node, Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { shareService } from "@/services/api";
import { ColumnInfo, Relationship, TableInfo } from "@/types";
import { OrthogonalEdge } from "@/components/canvas/OrthogonalEdge";
import GroupBox from "@/components/canvas/GroupBox";
import { CanvasGroup } from "@/types";

/**
 * Read-only view of a shared file.
 *
 * Deliberately not the main canvas: there is no editing here, so it uses its own lightweight
 * node rather than TableNode, whose buttons would all be dead ends.
 */

interface SharedSchema {
    fileName?: string | null;
    sharedBy?: string;
    tables: TableInfo[];
    relationships: Relationship[];
    /** Table colours and domain groups, as `{kind, ref, payload}` rows. Absent on older links. */
    canvasMeta?: { kind: string; ref: string; payload: string }[];
}

/** Clearance around the tables in a group, matching the editor so a shared diagram looks the same. */
const GROUP_PADDING = 28;
const GROUP_HEADER = 22;
const GROUP_NODE_PREFIX = 'group:';

/**
 * Splits the annotation rows into the two things the canvas needs.
 *
 * `payload` arrives as a JSON string, and a row that will not parse is dropped rather than
 * allowed to take the whole diagram down — a shared link is the one place where the reader can
 * do nothing about a bad row.
 */
const readCanvasMeta = (rows: SharedSchema['canvasMeta']) => {
    const colours: Record<string, string> = {};
    const groups: CanvasGroup[] = [];

    for (const row of rows ?? []) {
        let payload: Record<string, unknown>;
        try {
            payload = JSON.parse(row.payload ?? '{}');
        } catch {
            continue;
        }
        if (row.kind === 'table') {
            if (typeof payload.colour === 'string') colours[row.ref] = payload.colour;
        } else if (row.kind === 'group') {
            groups.push({
                id: row.ref,
                name: typeof payload.name === 'string' ? payload.name : 'Group',
                colour: payload.colour as CanvasGroup['colour'],
                tables: Array.isArray(payload.tables) ? payload.tables as string[] : [],
            });
        }
    }
    return { colours, groups };
};

interface ReadOnlyNodeData {
    label: string;
    columns: ColumnInfo[];
    /** Columns other tables point at — they need a source handle for the edge to start from. */
    sourceColumns: string[];
    /** Columns holding a foreign key — they need a target handle for the edge to land on. */
    targetColumns: string[];
}

/**
 * Read-only table node.
 *
 * React Flow can only draw an edge between two handles, so the handles below are what make the
 * relationship lines appear at all. They are derived from the schema's actual foreign keys
 * rather than from column naming, so a relationship on a column that is not called `*_id`
 * still gets drawn.
 */
const ReadOnlyTableNode = ({ data }: { data: ReadOnlyNodeData }) => (
    // `node-card` and `node-header` are the hooks the `.tag-*` rules in globals.css reach for.
    // Without them the colour class lands on the node and styles nothing, which is exactly what
    // happened: a shared link carried the colours in its payload and drew every table blue.
    <div className="node-card bg-surface border border-brand-200 rounded-md min-w-[180px] max-w-[220px] shadow-xl">
        <div className="node-header bg-brand-600 px-2 py-1.5 flex items-center gap-1.5 rounded-t-md">
            <Database size={10} className="text-white shrink-0" />
            <span className="font-bold text-white text-[10px] truncate" title={data.label}>
                {data.label}
            </span>
        </div>
        <div className="flex flex-col bg-ink-50 py-0.5 rounded-b-md">
            {data.columns.map((col, i) => {
                const isSource = data.sourceColumns.includes(col.name);
                const isTarget = data.targetColumns.includes(col.name);
                return (
                    <div key={i} className="relative flex justify-between items-center px-2 py-0.5 h-[22px]">
                        {isTarget && (
                            <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 z-50">
                                <Handle
                                    type="target"
                                    position={Position.Left}
                                    id={`${col.name}-left`}
                                    isConnectable={false}
                                    className="!w-2.5 !h-2.5 !bg-brand-500 !border-2 !border-white"
                                />
                            </div>
                        )}

                        <span className="flex items-center gap-1.5 overflow-hidden">
                            {(col.isPk || isSource || isTarget) && (
                                <KeyRound size={8} className="text-brand-500 shrink-0" />
                            )}
                            <span className="truncate font-mono text-[9px] text-ink-700 font-medium">{col.name}</span>
                        </span>
                        <span className="text-ink-400 font-mono uppercase text-[8px] shrink-0 ml-2">{col.type}</span>

                        {isSource && (
                            <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 z-50">
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={`${col.name}-right`}
                                    isConnectable={false}
                                    className="!w-2.5 !h-2.5 !bg-brand-500 !border-2 !border-white"
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
);

// The editor's own edge, so a shared link shows the same orthogonal routing and the same
// crow's-foot notation. This page used to draw built-in `smoothstep` diagonals, which meant the
// diagram someone shared did not look like the diagram they were looking at.
const edgeTypes = { orthogonal: OrthogonalEdge };
// The editor's own box, with its menu suppressed: a shared diagram should carry the boundaries
// the sender drew, and nothing a reader can change.
const nodeTypesWithGroups = { sharedTable: ReadOnlyTableNode, domainGroup: GroupBox };

export default function SharedFilePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);

    const [schema, setSchema] = useState<SharedSchema | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        shareService.view(token)
            .then(data => { if (!cancelled) setSchema(data as SharedSchema); })
            .catch((err: unknown) => {
                if (cancelled) return;
                const message = err && typeof err === "object" && "response" in err
                    ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                    : undefined;
                setError(message || "This share link could not be opened.");
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [token]);

    const { nodes, edges } = useMemo(() => {
        if (!schema) return { nodes: [] as Node[], edges: [] as Edge[] };

        // Work out which columns each edge needs to attach to before building the nodes:
        // a node rendered without the matching handle silently drops its edges.
        const sourceColumns: Record<string, string[]> = {};
        const targetColumns: Record<string, string[]> = {};
        const push = (map: Record<string, string[]>, table: string, column: string) => {
            if (!map[table]) map[table] = [];
            if (!map[table].includes(column)) map[table].push(column);
        };

        const edges: Edge[] = (schema.relationships || []).map((rel, index): Edge => {
            // The edge runs parent -> child, matching the main canvas.
            const parentTable = rel.targetTable;
            const parentColumn = rel.targetColumn;
            const childTable = rel.sourceTable;
            const childColumn = rel.sourceColumn;

            push(sourceColumns, parentTable, parentColumn);
            push(targetColumns, childTable, childColumn);

            const childColumnInfo = (schema.tables || [])
                .find(t => t.name === childTable)?.columns
                .find(c => c.name === childColumn);

            return {
                id: `e-${index}`,
                source: parentTable,
                target: childTable,
                sourceHandle: `${parentColumn}-right`,
                targetHandle: `${childColumn}-left`,
                type: "orthogonal",
                animated: false,
                data: {
                    // The shared view has the same schema the editor does, so it can infer the
                    // same cardinality.
                    childMany: !(childColumnInfo?.isUnique || childColumnInfo?.isPk),
                    childOptional: !childColumnInfo?.notNull,
                },
                // A variable, not a hex value, so a shared diagram follows the viewer's theme
                // rather than the one it was created in.
                style: { stroke: "var(--color-edge)", strokeWidth: 1.6 },
            };
        });

        const { colours, groups } = readCanvasMeta(schema.canvasMeta);

        const tableNodes: Node[] = (schema.tables || []).map((table, index) => ({
            id: table.name,
            type: "sharedTable",
            position: { x: 280 * (index % 3), y: 100 + Math.floor(index / 3) * 300 },
            // The colour rides on `className`, exactly as it does in the editor, so the same
            // `.tag-*` rules style it and the shared view needs no palette of its own.
            className: colours[table.name] ? `tag-${colours[table.name]}` : undefined,
            data: {
                label: table.name,
                columns: table.columns,
                sourceColumns: sourceColumns[table.name] ?? [],
                targetColumns: targetColumns[table.name] ?? [],
            },
        }));

        /*
         * Boxes derived from where the tables landed *here*.
         *
         * A shared link does not carry the sender's layout — positions live in their browser —
         * so this view lays the tables out on its own grid. Because a group stores members
         * rather than a rectangle, the boundary still lands correctly around them. That is the
         * property the design was chosen for, and this is where it pays.
         */
        const groupNodes: Node[] = groups.flatMap(group => {
            const members = tableNodes.filter(n => group.tables.includes(n.id));
            if (members.length === 0) return [];

            const left = Math.min(...members.map(n => n.position.x));
            const top = Math.min(...members.map(n => n.position.y));
            const right = Math.max(...members.map(n => n.position.x + 240));
            const bottom = Math.max(...members.map(n => n.position.y + 200));
            const width = right - left + GROUP_PADDING * 2;
            const height = bottom - top + GROUP_PADDING * 2 + GROUP_HEADER;

            return [{
                id: `${GROUP_NODE_PREFIX}${group.id}`,
                type: 'domainGroup',
                position: { x: left - GROUP_PADDING, y: top - GROUP_PADDING - GROUP_HEADER },
                style: { width, height },
                // Given rather than measured: React Flow hides a node until it knows its size,
                // and in controlled mode learns that from a change coming back through `nodes`.
                width,
                height,
                selectable: false,
                draggable: false,
                data: { group, memberCount: members.length, readOnly: true },
            }];
        });

        // Groups first, so they paint behind the tables they surround.
        return { nodes: [...groupNodes, ...tableNodes], edges };
    }, [schema]);

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-surface">
            <header className="app-header h-16 flex items-center justify-between px-3 sm:px-6 shadow-glow-md shrink-0 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0">
                        <Database size={18} className="text-brand-600" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-white font-semibold text-base sm:text-lg leading-tight truncate">
                            {schema?.fileName || "Shared schema"}
                        </h1>
                        {schema?.sharedBy && (
                            <p className="text-[11px] text-white/70 truncate">shared by {schema.sharedBy}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <span className="hidden sm:flex items-center gap-1.5 bg-black/20 border border-white/20 text-white/90 px-3 py-1 rounded-md text-xs font-medium">
                        <Eye size={13} /> Read-only
                    </span>
                    <Link
                        href="/app"
                        className="header-cta flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition-colors"
                    >
                        <ExternalLink size={15} /> <span className="hidden sm:inline">Open the app</span><span className="sm:hidden">Open</span>
                    </Link>
                </div>
            </header>

            <div className="flex-1 bg-canvas relative min-h-0">
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-400">
                        <Loader2 size={28} className="animate-spin text-brand-500" />
                        <p className="text-sm">Loading the shared schema...</p>
                    </div>
                )}

                {error && !isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                        <AlertCircle size={32} className="text-red-500" />
                        <p className="text-base font-semibold text-ink-800">Link unavailable</p>
                        <p className="text-sm text-ink-500 max-w-sm leading-relaxed">{error}</p>
                        <Link href="/" className="mt-2 px-4 py-2 brand-gradient brand-gradient-hover text-white rounded-md text-sm font-medium">
                            Go to SQL Visualizer
                        </Link>
                    </div>
                )}

                {!isLoading && !error && (
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypesWithGroups}
                        edgeTypes={edgeTypes}
                        fitView
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable={false}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background color="#94a3b8" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                )}
            </div>
        </div>
    );
}
