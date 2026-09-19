"use client";

import React from 'react';

/**
 * The full editor, at size — the landing page's centrepiece.
 *
 * Built as one SVG with a viewBox rather than as scaled HTML: the composition is fixed, so a
 * viewBox gives pixel-crisp scaling at every width with no JavaScript, no measuring and no
 * layout thrash. Everything animates in CSS.
 *
 * It assembles itself on view — chrome, then tables, then the edges drawing between them —
 * which is the same claim the surrounding copy makes: the diagram is derived, not drawn.
 *
 * Decorative, so aria-hidden; the section's text carries the meaning.
 */

const W = 1140;
const H = 570;

const CARD_W = 156;
const HEAD_H = 24;
const ROW_H = 18;

interface TableSpec {
    name: string;
    x: number;
    y: number;
    columns: [string, string, boolean?][]; // name, type, isKey
    delay: number;
}

/** An online-store schema, dense enough to look like real work. */
const TABLES: TableSpec[] = [
    {
        name: 'customers', x: 232, y: 96, delay: 240,
        columns: [['id', 'int', true], ['name', 'varchar'], ['email', 'varchar'], ['city', 'varchar']],
    },
    {
        name: 'categories', x: 232, y: 258, delay: 300,
        columns: [['id', 'int', true], ['name', 'varchar'], ['slug', 'varchar']],
    },
    {
        name: 'suppliers', x: 232, y: 390, delay: 360,
        columns: [['id', 'int', true], ['name', 'varchar'], ['country', 'varchar']],
    },
    {
        name: 'orders', x: 468, y: 112, delay: 420,
        columns: [['id', 'int', true], ['placed_on', 'date'], ['status', 'varchar'], ['customer_id', 'int', true]],
    },
    {
        name: 'products', x: 468, y: 300, delay: 480,
        columns: [['id', 'int', true], ['name', 'varchar'], ['price', 'decimal'], ['category_id', 'int', true], ['supplier_id', 'int', true]],
    },
    {
        name: 'order_items', x: 704, y: 140, delay: 540,
        columns: [['id', 'int', true], ['quantity', 'int'], ['order_id', 'int', true], ['product_id', 'int', true]],
    },
    {
        name: 'reviews', x: 704, y: 338, delay: 600,
        columns: [['id', 'int', true], ['rating', 'int'], ['product_id', 'int', true], ['customer_id', 'int', true]],
    },
    {
        name: 'payments', x: 940, y: 188, delay: 660,
        columns: [['id', 'int', true], ['amount', 'decimal'], ['order_id', 'int', true]],
    },
];

const cardHeight = (t: TableSpec) => HEAD_H + t.columns.length * ROW_H + 8;
const find = (name: string) => TABLES.find(t => t.name === name)!;

/** Vertical centre of a named column, so an edge lands on the field it refers to. */
const rowY = (tableName: string, columnName: string) => {
    const t = find(tableName);
    const i = t.columns.findIndex(c => c[0] === columnName);
    return i < 0 ? t.y + cardHeight(t) / 2 : t.y + HEAD_H + i * ROW_H + ROW_H / 2;
};

const EDGES: { from: [string, string]; to: [string, string]; delay: number }[] = [
    { from: ['customers', 'id'], to: ['orders', 'customer_id'], delay: 820 },
    { from: ['categories', 'id'], to: ['products', 'category_id'], delay: 880 },
    { from: ['suppliers', 'id'], to: ['products', 'supplier_id'], delay: 940 },
    { from: ['orders', 'id'], to: ['order_items', 'order_id'], delay: 1000 },
    { from: ['products', 'id'], to: ['order_items', 'product_id'], delay: 1060 },
    { from: ['products', 'id'], to: ['reviews', 'product_id'], delay: 1120 },
    { from: ['customers', 'id'], to: ['reviews', 'customer_id'], delay: 1180 },
    { from: ['orders', 'id'], to: ['payments', 'order_id'], delay: 1240 },
];

const TableCard = ({ table, playing }: { table: TableSpec; playing: boolean }) => {
    const h = cardHeight(table);
    return (
        <g className={playing ? 'mock-card' : undefined} style={{ animationDelay: `${table.delay}ms` }}>
            {/* Body */}
            <rect x={table.x} y={table.y} width={CARD_W} height={h} rx="7"
                fill="#ffffff" stroke="#c7d7f7" strokeWidth="1.2" />
            {/* Header: rounded at the top, squared where it meets the rows */}
            <path
                d={`M${table.x} ${table.y + 7} a7 7 0 0 1 7 -7 h${CARD_W - 14} a7 7 0 0 1 7 7 v${HEAD_H - 7} h${-CARD_W} z`}
                fill="url(#mockHeader)"
            />
            <circle cx={table.x + 12} cy={table.y + HEAD_H / 2} r="3.6" fill="#ffffff" fillOpacity="0.9" />
            <text x={table.x + 22} y={table.y + HEAD_H / 2 + 3.6}
                fontSize="10.5" fontWeight="700" fill="#ffffff" fontFamily="ui-monospace, monospace">
                {table.name}
            </text>

            {table.columns.map(([name, type, isKey], i) => {
                const y = table.y + HEAD_H + i * ROW_H;
                return (
                    <g key={name}>
                        {i % 2 === 1 && (
                            <rect x={table.x + 1} y={y} width={CARD_W - 2} height={ROW_H} fill="#f8fafc" />
                        )}
                        {isKey && (
                            <g transform={`translate(${table.x + 9}, ${y + ROW_H / 2})`}>
                                <circle cx="0" cy="0" r="2.6" fill="none" stroke="#2563eb" strokeWidth="1.3" />
                                <path d="M2.2 0 h4 M5 0 v2.2" stroke="#2563eb" strokeWidth="1.3" strokeLinecap="round" />
                            </g>
                        )}
                        <text x={table.x + (isKey ? 19 : 11)} y={y + ROW_H / 2 + 3.2}
                            fontSize="9.5" fill="#334155" fontFamily="ui-monospace, monospace">
                            {name}
                        </text>
                        <text x={table.x + CARD_W - 9} y={y + ROW_H / 2 + 3.2} textAnchor="end"
                            fontSize="8.5" fill="#94a3b8" fontFamily="ui-monospace, monospace">
                            {type}
                        </text>
                    </g>
                );
            })}
        </g>
    );
};

export const EditorMockup = ({ playing = true }: { playing?: boolean }) => (
    <svg
        viewBox={`0 0 ${W} ${H}`}
        className="themed-art h-auto w-full"
        role="img"
        aria-label="The editor showing an online-store schema of eight linked tables"
    >
        <defs>
            <linearGradient id="mockHeader" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
            <linearGradient id="mockChrome" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1d4ed8" />
                <stop offset="55%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
            <pattern id="mockDots" width="19" height="19" patternUnits="userSpaceOnUse">
                <circle cx="1.4" cy="1.4" r="1.4" fill="#cbd5e1" />
            </pattern>
            <marker id="mockArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0.6 L8,4 L0,7.4 Z" fill="#2563eb" />
            </marker>
            <clipPath id="mockClip">
                <rect x="0" y="0" width={W} height={H} rx="14" />
            </clipPath>
        </defs>

        <g clipPath="url(#mockClip)">
            {/* Canvas */}
            <rect x="0" y="0" width={W} height={H} fill="#fbfcfe" />
            <rect x="190" y="46" width={W - 190} height={H - 46} fill="url(#mockDots)" opacity="0.85" />

            {/* App header */}
            <g className={playing ? 'mock-chrome' : undefined} style={{ animationDelay: '0ms' }}>
                <rect x="0" y="0" width={W} height="46" fill="url(#mockChrome)" />
                <rect x="16" y="12" width="22" height="22" rx="6" fill="#ffffff" />
                <circle cx="27" cy="23" r="5" fill="none" stroke="#2563eb" strokeWidth="1.6" />
                <text x="48" y="27" fontSize="13" fontWeight="600" fill="#ffffff">SQL Visualizer</text>

                {['File', 'Share'].map((label, i) => (
                    <g key={label}>
                        <rect x={168 + i * 74} y="12" width="66" height="22" rx="11" fill="#ffffff" fillOpacity="0.16" />
                        <text x={201 + i * 74} y="27" fontSize="10.5" fill="#ffffff" textAnchor="middle">{label}</text>
                    </g>
                ))}

                <rect x={W - 178} y="12" width="94" height="22" rx="11" fill="#ffffff" fillOpacity="0.16" />
                <text x={W - 131} y="27" fontSize="10" fill="#e0e7ff" textAnchor="middle" fontFamily="ui-monospace, monospace">
                    shop.sql
                </text>
                <circle cx={W - 60} cy="23" r="11" fill="#ffffff" fillOpacity="0.9" />
                <text x={W - 60} y="27" fontSize="10" fontWeight="700" fill="#2563eb" textAnchor="middle">SN</text>
            </g>

            {/* Explorer */}
            <g className={playing ? 'mock-chrome' : undefined} style={{ animationDelay: '120ms' }}>
                <rect x="0" y="46" width="190" height={H - 46} fill="#ffffff" />
                <line x1="190" y1="46" x2="190" y2={H} stroke="#e2e8f5" strokeWidth="1.2" />
                <text x="18" y="76" fontSize="10" fontWeight="700" fill="#94a3b8" letterSpacing="0.6">EXPLORER</text>
                <rect x="14" y="88" width="162" height="24" rx="6" fill="#eef2ff" stroke="#c7d2fe" strokeWidth="1" />
                <text x="26" y="104" fontSize="10.5" fill="#4338ca" fontFamily="ui-monospace, monospace">shop.sql</text>

                {TABLES.map((t, i) => (
                    <g key={t.name}>
                        <rect x="22" y={122 + i * 26} width="154" height="21" rx="5"
                            fill={i === 0 ? '#f1f5f9' : 'transparent'} />
                        <rect x="32" y={130 + i * 26} width="7" height="6" rx="1.4" fill="#93a8c8" />
                        <text x="46" y={137 + i * 26} fontSize="10" fill="#64748b" fontFamily="ui-monospace, monospace">
                            {t.name}
                        </text>
                        <text x="168" y={137 + i * 26} fontSize="8.5" fill="#b6c2d4" textAnchor="end">
                            {t.columns.length}
                        </text>
                    </g>
                ))}
            </g>

            {/* Edges, beneath the cards so they tuck under the borders */}
            {EDGES.map((edge, i) => {
                const [fromTable, fromCol] = edge.from;
                const [toTable, toCol] = edge.to;
                const x1 = find(fromTable).x + CARD_W;
                const y1 = rowY(fromTable, fromCol);
                const x2 = find(toTable).x;
                const y2 = rowY(toTable, toCol);
                const bend = Math.max(34, (x2 - x1) / 2);
                const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
                // Rough path length, so the draw animation covers the whole line.
                const dash = Math.round(Math.hypot(x2 - x1, y2 - y1) * 1.45 + 60);

                return (
                    <path
                        key={i}
                        className={playing ? 'mock-edge' : undefined}
                        d={d}
                        stroke="#2563eb"
                        strokeOpacity="0.75"
                        strokeWidth="1.5"
                        fill="none"
                        markerEnd="url(#mockArrow)"
                        style={{ ['--dash' as string]: dash, animationDelay: `${edge.delay}ms` }}
                    />
                );
            })}

            {TABLES.map(table => <TableCard key={table.name} table={table} playing={playing} />)}

            {/* Canvas controls, to finish the illusion */}
            <g className={playing ? 'mock-chrome' : undefined} style={{ animationDelay: '1400ms' }}>
                <rect x="208" y={H - 46} width="92" height="28" rx="8" fill="#ffffff" stroke="#e2e8f5" strokeWidth="1" />
                {[0, 1, 2].map(i => (
                    <g key={i}>
                        <rect x={218 + i * 28} y={H - 39} width="14" height="14" rx="4" fill="#f1f5f9" />
                        <path
                            d={i === 0 ? `M${222 + i * 28} ${H - 32} h6 M${225 + i * 28} ${H - 35} v6`
                                : i === 1 ? `M${222 + i * 28} ${H - 32} h6`
                                : `M${222 + i * 28} ${H - 34} h6 M${222 + i * 28} ${H - 30} h6`}
                            stroke="#64748b" strokeWidth="1.3" strokeLinecap="round"
                        />
                    </g>
                ))}
                <rect x={W - 132} y={H - 46} width="112" height="28" rx="8" fill="#ffffff" stroke="#e2e8f5" strokeWidth="1" />
                <circle cx={W - 118} cy={H - 32} r="3.4" fill="#10b981" />
                <text x={W - 108} y={H - 28} fontSize="9.5" fill="#64748b">8 tables linked</text>
            </g>
        </g>

        {/* Frame on top, so the clip edge reads as a window rim */}
        <rect x="0.6" y="0.6" width={W - 1.2} height={H - 1.2} rx="14"
            fill="none" stroke="#d7e0f4" strokeWidth="1.2" />
    </svg>
);
