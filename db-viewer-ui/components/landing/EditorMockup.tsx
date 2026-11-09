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
 * **Every colour is a theme token, passed through `style`.** A CSS variable is not valid in an
 * SVG presentation attribute, which is why the first version used literal hex values and a
 * table of attribute selectors in globals.css to repaint them in the dark theme. Through
 * `style` the tokens apply directly, so this follows the theme — and any later change to the
 * palette — with nothing to keep in step. It draws the editor as it is now: a quiet app bar,
 * the Files panel, neutral table cards with the binding stripe, docked canvas controls.
 *
 * Decorative, so aria-hidden; the section's text carries the meaning.
 */

const W = 1140;
const H = 570;

const BAR_H = 44;
const PANEL_W = 200;

const CARD_W = 156;
const HEAD_H = 24;
const ROW_H = 18;

const v = (token: string) => `var(--color-${token})`;
const MONO = { fontFamily: 'var(--font-mono), ui-monospace, monospace' };

interface TableSpec {
    name: string;
    x: number;
    y: number;
    columns: [string, string][]; // name, type
    /** The stripe colour token, when the table carries a tag. Brand blue otherwise. */
    tag?: string;
    delay: number;
}

/** An online-store schema, dense enough to look like real work. */
const TABLES: TableSpec[] = [
    {
        name: 'customers', x: 236, y: 112, delay: 240,
        columns: [['id', 'int'], ['name', 'varchar'], ['email', 'varchar'], ['city', 'varchar']],
    },
    {
        name: 'categories', x: 236, y: 262, delay: 300,
        columns: [['id', 'int'], ['name', 'varchar'], ['slug', 'varchar']],
    },
    {
        name: 'suppliers', x: 236, y: 382, delay: 360,
        columns: [['id', 'int'], ['name', 'varchar'], ['country', 'varchar']],
    },
    {
        name: 'orders', x: 472, y: 124, delay: 420, tag: 'tag-amber',
        columns: [['id', 'int'], ['placed_on', 'date'], ['status', 'varchar'], ['customer_id', 'int']],
    },
    {
        name: 'products', x: 472, y: 306, delay: 480,
        columns: [['id', 'int'], ['name', 'varchar'], ['price', 'decimal'], ['category_id', 'int'], ['supplier_id', 'int']],
    },
    {
        name: 'order_items', x: 708, y: 150, delay: 540, tag: 'tag-amber',
        columns: [['id', 'int'], ['quantity', 'int'], ['order_id', 'int'], ['product_id', 'int']],
    },
    {
        name: 'reviews', x: 708, y: 340, delay: 600, tag: 'tag-violet',
        columns: [['id', 'int'], ['rating', 'int'], ['product_id', 'int'], ['customer_id', 'int']],
    },
    {
        name: 'payments', x: 944, y: 196, delay: 660, tag: 'tag-teal',
        columns: [['id', 'int'], ['amount', 'decimal'], ['order_id', 'int']],
    },
];

const cardHeight = (t: TableSpec) => HEAD_H + t.columns.length * ROW_H + 6;
const find = (name: string) => TABLES.find(t => t.name === name)!;

/** Vertical centre of a named column, so an edge lands on the field it refers to. */
const rowY = (tableName: string, columnName: string) => {
    const t = find(tableName);
    const i = t.columns.findIndex(c => c[0] === columnName);
    return i < 0 ? t.y + cardHeight(t) / 2 : t.y + HEAD_H + 3 + i * ROW_H + ROW_H / 2;
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

/** Right-angled, like the editor's edges: out, along a channel between the columns, in. */
const edgePath = (x1: number, y1: number, x2: number, y2: number, index: number) => {
    const channel = Math.round(x1 + (x2 - x1) / 2 + ((index % 3) - 1) * 6);
    return `M ${x1} ${y1} H ${channel} V ${y2} H ${x2}`;
};

/**
 * lucide's `Database` icon — the logo mark and every card header in the real UI — drawn from
 * its own 24-unit paths, so the picture uses the same glyph rather than a look-alike.
 */
const DatabaseGlyph = ({ x, y, size, colour }: { x: number; y: number; size: number; colour: string }) => (
    <g transform={`translate(${x}, ${y}) scale(${size / 24})`} fill="none" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" style={{ stroke: colour }}>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
    </g>
);

/** A key glyph: a ring and a bit. Gold for a primary key. */
const KeyGlyph = ({ x, y }: { x: number; y: number }) => (
    <g transform={`translate(${x}, ${y})`} style={{ stroke: v('key-pk') }} fill="none" strokeWidth="1.3" strokeLinecap="round">
        <circle cx="0" cy="0" r="2.4" />
        <path d="M2.2 0 h3.8 M4.8 0 v2" />
    </g>
);

/** A link glyph: two offset rings. Blue for a foreign key. */
const LinkGlyph = ({ x, y }: { x: number; y: number }) => (
    <g transform={`translate(${x}, ${y})`} style={{ stroke: v('key-fk') }} fill="none" strokeWidth="1.3">
        <rect x="-3.6" y="-1.8" width="4.4" height="3.6" rx="1.8" />
        <rect x="-0.8" y="-1.8" width="4.4" height="3.6" rx="1.8" />
    </g>
);

const TableCard = ({ table, playing }: { table: TableSpec; playing: boolean }) => {
    const h = cardHeight(table);
    const clipId = `mockCard-${table.name}`;
    return (
        <g className={playing ? 'mock-card' : undefined} style={{ animationDelay: `${table.delay}ms` }}>
            <defs>
                <clipPath id={clipId}>
                    <rect x={table.x} y={table.y} width={CARD_W} height={h} rx="7" />
                </clipPath>
            </defs>
            <rect x={table.x} y={table.y} width={CARD_W} height={h} rx="7"
                strokeWidth="1" style={{ fill: v('surface'), stroke: v('line') }} />
            {/* The binding stripe, clipped to the card's rounded corners. */}
            <rect x={table.x} y={table.y} width="3" height={h} clipPath={`url(#${clipId})`}
                style={{ fill: v(table.tag ?? 'brand-500') }} />

            {/* Header: a hairline under it, a table glyph, the name in mono */}
            <line x1={table.x} y1={table.y + HEAD_H} x2={table.x + CARD_W} y2={table.y + HEAD_H}
                strokeWidth="1" style={{ stroke: v('line') }} />
            <DatabaseGlyph x={table.x + 11} y={table.y + HEAD_H / 2 - 5} size={10} colour={v('ink-400')} />
            <text x={table.x + 26} y={table.y + HEAD_H / 2 + 3.6} fontSize="10.5" fontWeight="600"
                style={{ ...MONO, fill: v('ink-900') }}>
                {table.name}
            </text>
            {/* The node menu's three dots */}
            {[0, 1, 2].map(i => (
                <circle key={i} cx={table.x + CARD_W - 10} cy={table.y + HEAD_H / 2 - 3 + i * 3} r="0.9"
                    style={{ fill: v('ink-400') }} />
            ))}

            {table.columns.map(([name, type], i) => {
                const y = table.y + HEAD_H + 3 + i * ROW_H;
                const pk = name === 'id';
                const fk = name.endsWith('_id');
                return (
                    <g key={name}>
                        {pk && <KeyGlyph x={table.x + 13} y={y + ROW_H / 2} />}
                        {fk && <LinkGlyph x={table.x + 13} y={y + ROW_H / 2} />}
                        <text x={table.x + (pk || fk ? 23 : 12)} y={y + ROW_H / 2 + 3.2} fontSize="9.5"
                            fontWeight={pk ? 700 : fk ? 600 : 500}
                            style={{ ...MONO, fill: v(pk ? 'key-pk' : fk ? 'key-fk' : 'ink-700') }}>
                            {name}
                        </text>
                        <text x={table.x + CARD_W - 9} y={y + ROW_H / 2 + 3.2} textAnchor="end" fontSize="8"
                            style={{ ...MONO, fill: v('ink-400') }}>
                            {type.toUpperCase()}
                        </text>
                    </g>
                );
            })}
        </g>
    );
};

/** A docked control on the canvas: surface, hairline, small radius — the editor's DOCK. */
const Dock = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => (
    <rect x={x} y={y} width={w} height={h} rx="8" strokeWidth="1" style={{ fill: v('surface'), stroke: v('line') }} />
);

export const EditorMockup = ({ playing = true }: { playing?: boolean }) => (
    <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="The editor showing an online-store schema of eight linked tables"
    >
        <defs>
            {/* The same two variables `.brand-gradient` uses, so the mark matches the real logo.
                Not `--color-brand-violet`: no utility uses it, so Tailwind never emits it and
                the stop fell back to black. */}
            <linearGradient id="mockLogo" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" style={{ stopColor: 'var(--brand-600)' }} />
                <stop offset="100%" style={{ stopColor: 'var(--brand-violet)' }} />
            </linearGradient>
            <pattern id="mockDots" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="1.2" cy="1.2" r="1.2" style={{ fill: v('canvas-dot') }} />
            </pattern>
            <marker id="mockArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0.8 L7.4,4 L0,7.2 Z" style={{ fill: v('edge') }} />
            </marker>
            <clipPath id="mockClip">
                <rect x="0" y="0" width={W} height={H} rx="14" />
            </clipPath>
        </defs>

        <g clipPath="url(#mockClip)">
            {/* Canvas */}
            <rect x="0" y="0" width={W} height={H} style={{ fill: v('canvas') }} />
            <rect x={PANEL_W} y={BAR_H} width={W - PANEL_W} height={H - BAR_H} fill="url(#mockDots)" />

            {/* App bar: a plain surface and a hairline. The gradient is only in the logo mark. */}
            <g className={playing ? 'mock-chrome' : undefined} style={{ animationDelay: '0ms' }}>
                <rect x="0" y="0" width={W} height={BAR_H} style={{ fill: v('surface') }} />
                <line x1="0" y1={BAR_H} x2={W} y2={BAR_H} strokeWidth="1" style={{ stroke: v('line') }} />

                <rect x="14" y="11" width="22" height="22" rx="6" fill="url(#mockLogo)" />
                <DatabaseGlyph x={18.5} y={15.5} size={13} colour="#ffffff" />
                <text x="44" y="26.5" fontSize="12.5" fontWeight="600" style={{ fill: v('ink-900') }}>SQL Visualizer</text>
                <text x="152" y="26.5" fontSize="12.5" style={{ fill: v('ink-300') }}>/</text>
                <text x="164" y="26.5" fontSize="11.5" style={{ ...MONO, fill: v('ink-800') }}>shop.sql</text>

                <line x1="236" y1="14" x2="236" y2="30" strokeWidth="1" style={{ stroke: v('line') }} />
                <text x="252" y="26.5" fontSize="11.5" fontWeight="500" style={{ fill: v('ink-600') }}>File</text>
                <path d="M279 21 l3 3 l3 -3" fill="none" strokeWidth="1.2" strokeLinecap="round" style={{ stroke: v('ink-400') }} />
                <text x="302" y="26.5" fontSize="11.5" fontWeight="500" style={{ fill: v('ink-600') }}>Share</text>

                {/* Theme switch, account, help */}
                <rect x={W - 196} y="10" width="74" height="24" rx="6" strokeWidth="1"
                    style={{ fill: v('surface-tint'), stroke: v('line') }} />
                <rect x={W - 193} y="13" width="22" height="18" rx="4" style={{ fill: v('surface') }} />
                {[0, 1, 2].map(i => (
                    <circle key={i} cx={W - 182 + i * 24} cy="22" r="3.4" fill="none" strokeWidth="1.2"
                        style={{ stroke: v(i === 0 ? 'ink-700' : 'ink-400') }} />
                ))}
                <circle cx={W - 96} cy="22" r="11" style={{ fill: v('brand-50') }} />
                <text x={W - 96} y="26" fontSize="9.5" fontWeight="700" textAnchor="middle" style={{ fill: v('brand-700') }}>SN</text>
                <circle cx={W - 30} cy="22" r="7.5" fill="none" strokeWidth="1.3" style={{ stroke: v('ink-400') }} />
                <text x={W - 30} y="25.5" fontSize="9" fontWeight="600" textAnchor="middle" style={{ fill: v('ink-500') }}>?</text>
            </g>

            {/* Files panel */}
            <g className={playing ? 'mock-chrome' : undefined} style={{ animationDelay: '120ms' }}>
                <rect x="0" y={BAR_H} width={PANEL_W} height={H - BAR_H} style={{ fill: v('surface') }} />
                <line x1={PANEL_W} y1={BAR_H} x2={PANEL_W} y2={H} strokeWidth="1" style={{ stroke: v('line') }} />

                <text x="16" y={BAR_H + 26} fontSize="12" fontWeight="600" style={{ fill: v('ink-800') }}>Files</text>
                <path d={`M${PANEL_W - 44} ${BAR_H + 22} h8 M${PANEL_W - 40} ${BAR_H + 18} v8`}
                    strokeWidth="1.3" strokeLinecap="round" style={{ stroke: v('ink-500') }} />
                <rect x={PANEL_W - 24} y={BAR_H + 17} width="10" height="10" rx="2" fill="none" strokeWidth="1.2"
                    style={{ stroke: v('ink-400') }} />
                <line x1="0" y1={BAR_H + 40} x2={PANEL_W} y2={BAR_H + 40} strokeWidth="1" style={{ stroke: v('line') }} />

                <rect x="9" y={BAR_H + 49} width={PANEL_W - 18} height="26" rx="6" strokeWidth="1"
                    style={{ fill: v('surface-tint'), stroke: v('line') }} />
                <text x="20" y={BAR_H + 66} fontSize="10" style={{ fill: v('ink-400') }}>Search files and tables…</text>

                <rect x="8" y={BAR_H + 84} width={PANEL_W - 16} height="26" rx="6" style={{ fill: v('brand-50') }} />
                <path d={`M18 ${BAR_H + 94} l3 3 l-3 3`} fill="none" strokeWidth="1.2" strokeLinecap="round"
                    style={{ stroke: v('brand-700') }} transform={`rotate(90 19.5 ${BAR_H + 97})`} />
                <text x="30" y={BAR_H + 101} fontSize="11" fontWeight="500" style={{ ...MONO, fill: v('brand-700') }}>shop.sql</text>

                <line x1="21" y1={BAR_H + 116} x2="21" y2={BAR_H + 116 + TABLES.length * 24}
                    strokeWidth="1" style={{ stroke: v('line') }} />
                {TABLES.map((t, i) => (
                    <g key={t.name}>
                        <text x="32" y={BAR_H + 132 + i * 24} fontSize="10" style={{ ...MONO, fill: v('ink-600') }}>
                            {t.name}
                        </text>
                        <text x={PANEL_W - 18} y={BAR_H + 132 + i * 24} fontSize="9" textAnchor="end"
                            style={{ fill: v('ink-400') }}>
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
                // The path's real length, so the draw animation covers the whole line.
                const dash = Math.round((x2 - x1) + Math.abs(y2 - y1) + 40);

                return (
                    <path
                        key={i}
                        className={playing ? 'mock-edge' : undefined}
                        d={edgePath(x1, y1, x2, y2, i)}
                        strokeWidth="1.35"
                        strokeLinejoin="round"
                        fill="none"
                        markerEnd="url(#mockArrow)"
                        style={{ stroke: v('edge'), ['--dash' as string]: dash, animationDelay: `${edge.delay}ms` }}
                    />
                );
            })}

            {TABLES.map(table => <TableCard key={table.name} table={table} playing={playing} />)}

            {/* Canvas controls: the toolbar dock, zoom and the assistant, the zoom buttons, the map */}
            <g className={playing ? 'mock-chrome' : undefined} style={{ animationDelay: '1400ms' }}>
                <Dock x={PANEL_W + 16} y={BAR_H + 14} w={224} h={34} />
                <rect x={PANEL_W + 21} y={BAR_H + 19} width="80" height="24" rx="6" style={{ fill: v('brand-600') }} />
                <path d={`M${PANEL_W + 30} ${BAR_H + 31} h7 M${PANEL_W + 33.5} ${BAR_H + 27.5} v7`}
                    stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" />
                <text x={PANEL_W + 42} y={BAR_H + 34.5} fontSize="10.5" fontWeight="600" fill="#ffffff">New table</text>
                <line x1={PANEL_W + 108} y1={BAR_H + 23} x2={PANEL_W + 108} y2={BAR_H + 39} strokeWidth="1"
                    style={{ stroke: v('line') }} />
                {[0, 1, 2, 3, 4].map(i => (
                    <rect key={i} x={PANEL_W + 118 + i * 24} y={BAR_H + 26} width="10" height="10" rx="2.5"
                        fill="none" strokeWidth="1.2" style={{ stroke: v(i === 1 ? 'brand-600' : 'ink-400') }} />
                ))}

                <Dock x={W - 158} y={BAR_H + 14} w={70} h={34} />
                <text x={W - 123} y={BAR_H + 35} fontSize="10.5" textAnchor="middle" style={{ ...MONO, fill: v('ink-800') }}>78%</text>
                <Dock x={W - 80} y={BAR_H + 14} w={62} h={34} />
                <path
                    d={`M${W - 66} ${BAR_H + 25} l1.6 4.4 l4.4 1.6 l-4.4 1.6 l-1.6 4.4 l-1.6 -4.4 l-4.4 -1.6 l4.4 -1.6 z`}
                    style={{ fill: v('brand-600') }}
                />
                <text x={W - 54} y={BAR_H + 35} fontSize="11" fontWeight="500" style={{ fill: v('ink-700') }}>Ask</text>

                <Dock x={PANEL_W + 16} y={H - 98} w={30} h={84} />
                {[1, 2].map(i => (
                    <line key={i} x1={PANEL_W + 16} y1={H - 98 + i * 28} x2={PANEL_W + 46} y2={H - 98 + i * 28}
                        strokeWidth="1" style={{ stroke: v('line') }} />
                ))}
                <path
                    d={`M${PANEL_W + 27} ${H - 84} h8 M${PANEL_W + 31} ${H - 88} v8 M${PANEL_W + 27} ${H - 56} h8`
                        + ` M${PANEL_W + 26} ${H - 29} v-3 h3 M${PANEL_W + 36} ${H - 29} v-3 h-3`
                        + ` M${PANEL_W + 26} ${H - 24} v3 h3 M${PANEL_W + 36} ${H - 24} v3 h-3`}
                    fill="none" strokeWidth="1.3" strokeLinecap="round" style={{ stroke: v('ink-500') }}
                />

                {/* The minimap: the canvas in miniature, tables in a neutral ink, the view outlined */}
                <rect x={W - 196} y={H - 126} width="178" height="110" rx="8" strokeWidth="1"
                    style={{ fill: v('canvas'), stroke: v('line') }} />
                {TABLES.map(t => (
                    <rect key={t.name}
                        x={W - 190 + (t.x - 236) * 0.19} y={H - 116 + (t.y - 112) * 0.22}
                        width={CARD_W * 0.19} height={cardHeight(t) * 0.22} rx="1.5"
                        style={{ fill: v('ink-300') }} />
                ))}
                <rect x={W - 193} y={H - 120} width="124" height="96" rx="2" fill="none" strokeWidth="1.2"
                    style={{ stroke: v('brand-500') }} />
            </g>
        </g>

        {/* Frame on top, so the clip edge reads as a window rim */}
        <rect x="0.6" y="0.6" width={W - 1.2} height={H - 1.2} rx="14"
            fill="none" strokeWidth="1.2" style={{ stroke: v('line') }} />
    </svg>
);
