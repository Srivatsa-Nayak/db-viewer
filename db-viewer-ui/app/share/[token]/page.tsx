"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Database, Loader2, AlertCircle, KeyRound, Eye, ExternalLink } from "lucide-react";
import ReactFlow, {
    Background, BackgroundVariant, Controls, Edge, Handle, MarkerType, Node, Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { shareService } from "@/services/api";
import { ColumnInfo, Relationship, TableInfo } from "@/types";

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
}

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
    <div className="bg-white border border-brand-200 rounded-md min-w-[180px] max-w-[220px] shadow-xl">
        <div className="bg-brand-600 px-2 py-1.5 flex items-center gap-1.5 rounded-t-md">
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

const nodeTypes = { sharedTable: ReadOnlyTableNode };

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

            return {
                id: `e-${index}`,
                source: parentTable,
                target: childTable,
                sourceHandle: `${parentColumn}-right`,
                targetHandle: `${childColumn}-left`,
                type: "smoothstep",
                animated: true,
                style: { stroke: "#2563eb", strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: "#2563eb" },
            };
        });

        const nodes: Node[] = (schema.tables || []).map((table, index) => ({
            id: table.name,
            type: "sharedTable",
            position: { x: 280 * (index % 3), y: 100 + Math.floor(index / 3) * 300 },
            data: {
                label: table.name,
                columns: table.columns,
                sourceColumns: sourceColumns[table.name] ?? [],
                targetColumns: targetColumns[table.name] ?? [],
            },
        }));

        return { nodes, edges };
    }, [schema]);

    return (
        <div className="h-[100dvh] w-full flex flex-col bg-white">
            <header className="h-16 brand-gradient flex items-center justify-between px-3 sm:px-6 shadow-glow-md shrink-0 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shrink-0">
                        <Database size={18} className="text-brand-600" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-white font-semibold text-base sm:text-lg leading-tight truncate">
                            {schema?.fileName || "Shared schema"}
                        </h1>
                        {schema?.sharedBy && (
                            <p className="text-[11px] text-brand-100 truncate">shared by {schema.sharedBy}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <span className="hidden sm:flex items-center gap-1.5 bg-black/15 border border-white/25 text-brand-50 px-3 py-1 rounded-md text-xs font-medium">
                        <Eye size={13} /> Read-only
                    </span>
                    <Link
                        href="/app"
                        className="flex items-center gap-2 bg-white hover:bg-brand-50 text-brand-700 px-3 py-2 rounded-md text-sm font-semibold transition-colors"
                    >
                        <ExternalLink size={15} /> <span className="hidden sm:inline">Open the app</span><span className="sm:hidden">Open</span>
                    </Link>
                </div>
            </header>

            <div className="flex-1 bg-ink-50 relative min-h-0">
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
                        nodeTypes={nodeTypes}
                        fitView
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable={false}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background color="#94a3b8" gap={24} size={1.5} variant={BackgroundVariant.Dots} />
                        <Controls showInteractive={false} className="bg-white border-line fill-ink-700" />
                    </ReactFlow>
                )}
            </div>
        </div>
    );
}
