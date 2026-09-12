"use client";

import React from 'react';
import { Database, KeyRound } from 'lucide-react';

/**
 * A schema that builds itself.
 *
 * Rather than a screenshot, the hero performs what the product does: table cards pop in one
 * by one, the foreign-key edges draw themselves, and a dot then travels each edge to suggest
 * the relationship being live rather than drawn on. Once settled the cards drift slightly out
 * of phase, so the panel never reads as a static image.
 *
 * Hand-built instead of mounting React Flow: the hero must paint immediately, and pulling the
 * whole canvas into the landing bundle for a decorative panel would be a poor trade. Marked
 * aria-hidden — the surrounding copy carries the meaning.
 */

interface TableSpec {
    name: string;
    columns: [string, string][];
    /** Absolute placement inside the 480x340 stage. */
    style: React.CSSProperties;
    /** Entrance order; edges wait until the tables they join have landed. */
    delay: number;
}

const TABLES: TableSpec[] = [
    {
        name: 'customers',
        columns: [['id', 'INT'], ['name', 'VARCHAR'], ['email', 'VARCHAR']],
        style: { left: 18, top: 30 },
        delay: 120,
    },
    {
        name: 'products',
        columns: [['id', 'INT'], ['title', 'VARCHAR'], ['price', 'DECIMAL']],
        style: { left: 18, top: 196 },
        delay: 260,
    },
    {
        name: 'orders',
        columns: [['id', 'INT'], ['customer_id', 'INT'], ['product_id', 'INT'], ['total', 'DECIMAL']],
        style: { right: 22, top: 104 },
        delay: 400,
    },
];

/** Edge geometry, matched to the card positions above. */
const EDGES = [
    { d: 'M 186 96 C 236 96, 236 168, 286 168', dash: 200, delay: 620 },
    { d: 'M 186 262 C 236 262, 236 190, 286 190', dash: 200, delay: 760 },
];

const TableCard = ({ table }: { table: TableSpec }) => (
    <div
        className="hero-card absolute w-[168px] rounded-lg border border-blue-200 bg-white shadow-xl shadow-blue-900/5"
        style={{ ...table.style, animationDelay: `${table.delay}ms` }}
    >
        {/* The float lives on an inner element so it does not fight the pop-in transform. */}
        <div
            className="hero-card-float"
            style={{ animationDelay: `${1200 + table.delay * 3}ms` }}
        >
            <div className="flex items-center gap-1.5 rounded-t-lg bg-blue-600 px-2.5 py-1.5">
                <Database size={10} className="shrink-0 text-white" />
                <span className="truncate text-[11px] font-bold text-white">{table.name}</span>
            </div>
            <div className="rounded-b-lg bg-zinc-50 py-1">
                {table.columns.map(([column, type]) => (
                    <div key={column} className="flex h-[21px] items-center justify-between px-2.5">
                        <span className="flex items-center gap-1 overflow-hidden">
                            {(column === 'id' || column.endsWith('_id')) && (
                                <KeyRound size={8} className="shrink-0 text-blue-500" />
                            )}
                            <span className="truncate font-mono text-[9px] font-medium text-zinc-700">
                                {column}
                            </span>
                        </span>
                        <span className="ml-2 shrink-0 font-mono text-[8px] uppercase text-zinc-400">
                            {type}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

export const HeroDiagram = () => (
    <div aria-hidden className="relative mx-auto h-[340px] w-full max-w-[480px] select-none">
        {/* Dotted canvas, matching the editor's own backdrop. */}
        <div
            className="absolute inset-0 rounded-2xl border border-zinc-200 bg-white/70 shadow-sm backdrop-blur-sm"
            style={{
                backgroundImage: 'radial-gradient(#d4d4d8 1.1px, transparent 1.1px)',
                backgroundSize: '20px 20px',
            }}
        />

        <svg className="absolute inset-0 h-full w-full overflow-visible" fill="none">
            <defs>
                <marker id="hero-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 Z" fill="#2563eb" />
                </marker>
            </defs>

            {EDGES.map((edge, i) => (
                <g key={i}>
                    <path
                        className="hero-edge"
                        d={edge.d}
                        stroke="#2563eb"
                        strokeWidth="1.6"
                        markerEnd="url(#hero-arrow)"
                        style={{ ['--dash' as string]: edge.dash, animationDelay: `${edge.delay}ms` }}
                    />
                    {/* A pulse travels the edge after it has drawn — the relationship reading as
                        live rather than painted on. SMIL keeps it off the main thread. */}
                    <circle r="2.6" fill="#2563eb" opacity="0.85">
                        <animateMotion
                            dur="2.6s"
                            begin={`${(edge.delay + 900) / 1000}s; ${(edge.delay + 900) / 1000 + 5}s`}
                            repeatCount="indefinite"
                            path={edge.d}
                            keyPoints="0;1"
                            keyTimes="0;1"
                            calcMode="spline"
                            keySplines="0.4 0 0.2 1"
                        />
                        <animate
                            attributeName="opacity"
                            values="0;0.85;0.85;0"
                            dur="2.6s"
                            begin={`${(edge.delay + 900) / 1000}s; ${(edge.delay + 900) / 1000 + 5}s`}
                            repeatCount="indefinite"
                        />
                    </circle>
                </g>
            ))}
        </svg>

        {TABLES.map(table => <TableCard key={table.name} table={table} />)}

        {/* Lands last, once the schema is complete. */}
        <div
            className="hero-label absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-200 bg-white/90 px-3 py-1 text-[11px] font-medium text-zinc-500 shadow-sm backdrop-blur-sm"
            style={{ animationDelay: '1500ms' }}
        >
            <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            read from a live database
        </div>
    </div>
);
