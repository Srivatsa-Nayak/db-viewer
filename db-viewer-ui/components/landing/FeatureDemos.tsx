"use client";

import React from 'react';
import {
    KeyRound, Link2, Check, X, Search, Trash2, StickyNote, Plus, Share2,
    FileCode2, GitBranch, Table2, Image as ImageIcon, Lock, Database,
} from 'lucide-react';

/**
 * A looping scene per feature, showing that action happening on a canvas.
 *
 * These replace the screen-recorded GIFs this section would conventionally use. A recording
 * would be three or four hundred kilobytes each, blurry on a retina screen, stuck in whichever
 * theme it was captured in, and quietly out of date the first time a button moves. These are
 * the app's own components and tokens, animated by the shared loop vocabulary in `globals.css`
 * — a few kilobytes for all of them, sharp at any size, correct in both themes, and impossible
 * to leave showing a build that no longer exists.
 *
 * Every scene is decorative: `aria-hidden`, and the card beside it carries the meaning in text.
 */

/* ── The kit ──────────────────────────────────────────────────────────────── */

/** The stage every scene is drawn on: a dotted canvas at a fixed aspect. */
const Stage = ({ children }: { children: React.ReactNode }) => (
    <div
        aria-hidden
        className="relative h-full w-full overflow-hidden rounded-xl border border-[var(--surface-line)] bg-canvas"
        style={{
            backgroundImage: 'radial-gradient(var(--color-canvas-dot) 1.1px, transparent 1.1px)',
            backgroundSize: '18px 18px',
        }}
    >
        {children}
    </div>
);

interface MiniColumn {
    name: string;
    type?: string;
    pk?: boolean;
    fk?: boolean;
    /** Classes applied to this row only — how a scene picks one column out. */
    className?: string;
    style?: React.CSSProperties;
}

/** A table, positioned absolutely so scenes can compose them freely. */
const MiniTable = ({ name, columns, className = '', style, headerExtra }: {
    name: string;
    columns: MiniColumn[];
    className?: string;
    style?: React.CSSProperties;
    headerExtra?: React.ReactNode;
}) => (
    <div
        className={`absolute overflow-hidden rounded-md border border-brand-200 bg-surface shadow-glow-sm ${className}`}
        style={style}
    >
        <div className="brand-gradient flex items-center gap-1 px-1.5 py-1">
            <Database size={7} className="shrink-0 text-white" />
            <span className="truncate font-mono text-[8px] font-bold leading-none text-white">{name}</span>
            {headerExtra}
        </div>
        <div className="bg-ink-50 py-px">
            {columns.map(column => (
                <div
                    key={column.name}
                    className={`flex items-center justify-between gap-2 px-1.5 py-[3px] ${column.className ?? ''}`}
                    style={column.style}
                >
                    <span className="flex items-center gap-0.5 overflow-hidden">
                        {column.pk && <KeyRound size={6} className="shrink-0 text-key-pk" />}
                        {column.fk && <Link2 size={6} className="shrink-0 text-key-fk" />}
                        <span className={`truncate font-mono text-[7.5px] leading-none ${
                            column.pk ? 'font-bold text-key-pk'
                                : column.fk ? 'font-semibold text-key-fk' : 'text-ink-700'
                        }`}>
                            {column.name}
                        </span>
                    </span>
                    {column.type && (
                        <span className="shrink-0 font-mono text-[6.5px] uppercase leading-none text-ink-400">
                            {column.type}
                        </span>
                    )}
                </div>
            ))}
        </div>
    </div>
);

/** A floating chip — the app's own callouts, badges and toasts. */
const Chip = ({ children, tone = 'plain', className = '', style }: {
    children: React.ReactNode;
    tone?: 'plain' | 'error' | 'success' | 'brand';
    className?: string;
    style?: React.CSSProperties;
}) => {
    const tones = {
        plain: 'border-[var(--surface-line)] bg-surface text-ink-700',
        error: 'tone-error',
        success: 'tone-success',
        brand: 'border-brand-300 bg-brand-50 text-brand-700',
    };
    return (
        <span
            className={`absolute flex items-center gap-1 rounded-md border px-1.5 py-1 text-[8px] font-medium shadow-glow-sm ${tones[tone]} ${className}`}
            style={style}
        >
            {children}
        </span>
    );
};

/** The pointer that presses a control, so the scene reads as someone doing something. */
const Pointer = ({ className = '', style }: { className?: string; style?: React.CSSProperties }) => (
    <svg viewBox="0 0 16 16" className={`absolute h-3.5 w-3.5 drop-shadow ${className}`} style={style}>
        <path d="M2 1 L2 12 L5 9.4 L7.2 14 L9.6 12.9 L7.4 8.5 L11.2 8.2 Z"
            fill="var(--color-ink-900)" stroke="var(--color-surface)" strokeWidth="1.1" />
    </svg>
);

const delay = (ms: number): React.CSSProperties => ({ '--fx-delay': `${ms}ms` } as React.CSSProperties);

/**
 * The design space every scene is drawn in: 260 x 150, expressed as percentages of the stage.
 *
 * Scenes that draw a *line between two boxes* have to position both in the same coordinate
 * system or the line stops touching the boxes the moment the panel is a different size from the
 * one they were authored at — which is exactly what happens between the desktop panel and the
 * inline one on a phone. The SVG overlays use `viewBox="0 0 260 150"` with a non-uniform
 * `preserveAspectRatio`, which maps those same numbers onto the same percentages, so the two
 * agree at every width.
 */
const DESIGN = { w: 260, h: 150 };
const px = (x: number) => `${(x / DESIGN.w) * 100}%`;
const py = (y: number) => `${(y / DESIGN.h) * 100}%`;
/** Position and size a box in design coordinates. */
const box = (x: number, y: number, w: number): React.CSSProperties =>
    ({ left: px(x), top: py(y), width: px(w) });

/* ── The scenes ───────────────────────────────────────────────────────────── */

/**
 * Every scene lays itself out in the 260 x 150 design space above, as percentages.
 *
 * Fixed pixel offsets were the obvious first cut and they only compose correctly at one size —
 * the panel is 390 wide on a desktop and the whole column width on a phone, and anything
 * positioned in px drifts away from the lines drawn between them. Percentages keep a scene
 * looking the way it was drawn at both.
 */

/** Relationships: an edge that goes *around* the table in its way. */
export const DemoRelationships = () => (
    <Stage>
        <MiniTable
            name="customers" style={box(8, 22, 76)}
            columns={[{ name: 'id', type: 'int', pk: true }, { name: 'email', type: 'varchar' }]}
        />
        {/* Squarely between the two it connects — which is the whole point being made. */}
        <MiniTable
            name="sessions" style={box(96, 34, 72)}
            columns={[{ name: 'id', type: 'int', pk: true }, { name: 'token', type: 'varchar' }]}
        />
        <MiniTable
            name="orders" style={box(178, 36, 74)}
            columns={[
                { name: 'id', type: 'int', pk: true },
                { name: 'customer_id', type: 'int', fk: true },
            ]}
        />

        <svg viewBox="0 0 260 150" className="absolute inset-0 h-full w-full" fill="none" preserveAspectRatio="none">
            {/* Over the top of `sessions` rather than through it — the thing a straight line
                cannot show, and the reason the router exists.

                `vector-effect` keeps the stroke an even weight: the viewBox is stretched to the
                panel non-uniformly so these coordinates line up with the boxes above, and without
                it the horizontal runs would come out thinner than the vertical ones. */}
            <path
                d="M84 40 H90 V16 H172 V52 H178"
                className="fx fx-draw"
                style={{ ...delay(200), '--len': 260 } as React.CSSProperties}
                stroke="var(--color-edge)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
            <path
                d="M173 48 L178 52 L173 56"
                className="fx fx-fade" style={delay(1000)}
                stroke="var(--color-edge)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>

        <Chip tone="brand" className="fx fx-in -translate-x-1/2 whitespace-nowrap" style={{ ...delay(1600), left: '50%', top: py(120) } as React.CSSProperties}>
            routed around, not through
        </Chip>
    </Stage>
);

/** Import: the type inference being overruled before anything is created. */
export const DemoImport = () => (
    <Stage>
        <div
            className="absolute overflow-hidden rounded-lg border border-[var(--surface-line)] bg-surface shadow-glow-sm"
            style={{ left: px(10), top: py(10), width: px(240) }}
        >
            <div className="flex items-center gap-1 border-b border-[var(--surface-line)] px-2 py-1">
                <FileCode2 size={8} className="text-brand-600" />
                <span className="font-mono text-[7.5px] text-ink-700">people.csv</span>
                <span className="ml-auto text-[7px] text-ink-500">check before importing</span>
            </div>

            <div className="relative space-y-1 p-2">
                {/* A sweep while the file is read. */}
                <span className="shimmer-sweep pointer-events-none absolute inset-0" />

                {[
                    { name: 'name', type: 'VARCHAR(32)' },
                    { name: 'postcode', type: 'INTEGER' },
                    { name: 'joined', type: 'DATE' },
                    { name: 'active', type: 'BOOLEAN' },
                ].map((row, i) => (
                    <div key={row.name} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[7.5px] text-ink-700">{row.name}</span>
                        <span className="relative flex h-[13px] w-[62px] items-center justify-center rounded border border-ink-300 bg-surface">
                            {/* The second row is the one that matters: digits with a leading zero,
                                which the obvious guess would silently destroy. */}
                            {i === 1 ? (
                                // One delay for both halves of the swap: they are complements, and
                                // giving them separate delays is what used to print INTEGER and
                                // VARCHAR(16) on top of each other.
                                <>
                                    <span className="fx fx-swap-out absolute font-mono text-[7px] text-ink-500" style={delay(600)}>
                                        INTEGER
                                    </span>
                                    <span className="fx fx-swap-in absolute font-mono text-[7px] font-semibold text-brand-700" style={delay(600)}>
                                        VARCHAR(16)
                                    </span>
                                </>
                            ) : (
                                <span className="font-mono text-[7px] text-ink-500">{row.type}</span>
                            )}
                        </span>
                    </div>
                ))}
            </div>
        </div>

        {/* On the postcode row, and pressing *before* the value changes rather than after it. */}
        <Pointer className="fx fx-press" style={{ ...delay(200), left: px(210), top: py(36) } as React.CSSProperties} />
        <Chip tone="error" className="fx fx-in -translate-x-1/2 whitespace-nowrap" style={{ ...delay(1200), left: '50%', top: py(122) } as React.CSSProperties}>
            01234 would have lost its zero
        </Chip>
    </Stage>
);

/** Schema editing: a column arriving on a live table. */
export const DemoSchemaEdit = () => (
    <Stage>
        <MiniTable
            name="customers" style={box(75, 20, 110)}
            headerExtra={<Plus size={7} className="ml-auto shrink-0 text-white/80" />}
            columns={[
                { name: 'id', type: 'int', pk: true },
                { name: 'email', type: 'varchar' },
                { name: 'city', type: 'varchar' },
                { name: 'phone', type: 'varchar(20)', className: 'fx fx-in bg-brand-50', style: delay(900) },
            ]}
        />
        <Pointer className="fx fx-press" style={{ ...delay(200), left: px(176), top: py(18) } as React.CSSProperties} />
        <Chip tone="success" className="fx fx-in -translate-x-1/2 whitespace-nowrap" style={{ ...delay(1500), left: '50%', top: py(122) } as React.CSSProperties}>
            <Check size={8} /> ALTER TABLE ran
        </Chip>
    </Stage>
);

/** Data editing: one cell, changed in place. */
export const DemoDataEdit = () => (
    <Stage>
        <div
            className="absolute overflow-hidden rounded-lg border border-[var(--surface-line)] bg-surface shadow-glow-sm"
            style={{ left: px(18), top: py(16), width: px(224) }}
        >
            <div className="grid grid-cols-3 border-b border-[var(--surface-line)] bg-ink-50 px-2 py-1 text-[7px] font-semibold text-ink-500">
                <span>id</span><span>city</span><span>orders</span>
            </div>
            {[
                { id: '1', city: 'Bengaluru', orders: '7' },
                { id: '2', city: 'Lisbon', orders: '12' },
                { id: '3', city: 'Tallinn', orders: '4' },
            ].map((row, i) => (
                <div key={row.id} className="grid grid-cols-3 items-center px-2 py-1 font-mono text-[7.5px] text-ink-700">
                    <span>{row.id}</span>
                    {i === 1 ? (
                        <span className="relative -ml-1 flex h-[14px] items-center rounded border border-brand-400 bg-surface px-1">
                            <span className="fx fx-swap-out" style={delay(700)}>Lisbon</span>
                            <span className="fx fx-swap-in absolute left-1" style={delay(700)}>Porto</span>
                            <span className="fx fx-caret absolute right-1 h-2 w-px bg-brand-600" style={delay(300)} />
                        </span>
                    ) : (
                        <span>{row.city}</span>
                    )}
                    <span>{row.orders}</span>
                </div>
            ))}
        </div>
        <Chip tone="success" className="fx fx-in -translate-x-1/2 whitespace-nowrap" style={{ ...delay(1200), left: '50%', top: py(122) } as React.CSSProperties}>
            <Check size={8} /> UPDATE … WHERE id = 2
        </Chip>
    </Stage>
);

/** A delete that is refused, and says by what. */
export const DemoSafeDelete = () => (
    <Stage>
        <MiniTable
            name="customers"
            className="fx fx-shake"
            style={{ ...box(14, 22, 80), ...delay(400) } as React.CSSProperties}
            headerExtra={<Trash2 size={7} className="ml-auto shrink-0 text-white/80" />}
            columns={[{ name: 'id', type: 'int', pk: true }, { name: 'email', type: 'varchar' }]}
        />
        <MiniTable
            name="orders" style={box(166, 54, 80)}
            columns={[
                { name: 'id', type: 'int', pk: true },
                { name: 'customer_id', type: 'int', fk: true },
            ]}
        />
        <svg viewBox="0 0 260 150" className="absolute inset-0 h-full w-full" fill="none" preserveAspectRatio="none">
            <path d="M94 38 H130 V72 H166" stroke="var(--color-edge)" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" opacity="0.6"
                vectorEffect="non-scaling-stroke" />
        </svg>

        <Pointer className="fx fx-press" style={{ ...delay(0), left: px(86), top: py(20) } as React.CSSProperties} />
        <Chip tone="error" className="fx fx-in -translate-x-1/2 justify-center whitespace-nowrap" style={{ ...delay(900), left: '50%', top: py(122) } as React.CSSProperties}>
            <X size={8} /> refused — orders still points at it
        </Chip>
    </Stage>
);

/** Search: one table found, everything else turned down. */
export const DemoSearch = () => (
    <Stage>
        <div
            className="absolute z-10 flex items-center gap-1 rounded-md border border-[var(--surface-line)] bg-surface px-1.5 py-1 shadow-glow-sm"
            style={{ left: px(66), top: py(8), width: px(128) }}
        >
            <Search size={8} className="shrink-0 text-ink-400" />
            <span className="font-mono text-[7.5px] text-ink-800">order</span>
            <span className="fx fx-caret h-2 w-px bg-brand-600" style={delay(200)} />
            <span className="ml-auto text-[6.5px] text-ink-500">Ctrl+F</span>
        </div>

        {[
            { name: 'customers', x: 10, y: 44, dim: true },
            { name: 'products', x: 10, y: 100, dim: true },
            { name: 'orders', x: 100, y: 62, dim: false },
            { name: 'reviews', x: 190, y: 100, dim: true },
        ].map(table => (
            <MiniTable
                key={table.name}
                name={table.name}
                className={table.dim ? 'fx fx-out' : 'ring-2 ring-brand-500 ring-offset-1'}
                style={{
                    ...box(table.x, table.y, 62),
                    ...(table.dim ? delay(600) : {}),
                } as React.CSSProperties}
                columns={[{ name: 'id', type: 'int', pk: true }]}
            />
        ))}
    </Stage>
);

const ISOLATION_FILES = ['billing.sql', 'analytics.sql'];

/** The file tabs, with one of them open. Module scope, so hovering never remounts them. */
const IsolationTabs = ({ active, className, style }: {
    active: number; className: string; style: React.CSSProperties;
}) => (
    <div className={`absolute flex gap-1 ${className}`} style={style}>
        {ISOLATION_FILES.map((file, i) => (
            <span
                key={file}
                className={`flex-1 rounded-t-md border-x border-t px-1.5 py-1 text-center font-mono text-[7px] ${
                    i === active
                        ? 'border-[var(--surface-line)] bg-surface text-ink-800'
                        : 'border-transparent bg-ink-100 text-ink-500'
                }`}
            >
                {file}
            </span>
        ))}
    </div>
);

const ISOLATION_TABS_AT: React.CSSProperties = { left: px(40), top: py(10), width: px(180) };

/**
 * Isolation: the same table name in two files, never colliding.
 *
 * Both halves of the scene switch together. The tab strip used to be static while the table
 * under it changed, so for half of every loop the scene showed `billing.sql` above the analytics
 * table's columns — which argues the opposite of the point being made.
 */
export const DemoIsolation = () => (
    <Stage>
        <IsolationTabs active={0} className="fx fx-swap-out" style={{ ...ISOLATION_TABS_AT, ...delay(400) } as React.CSSProperties} />
        <IsolationTabs active={1} className="fx fx-swap-in" style={{ ...ISOLATION_TABS_AT, ...delay(400) } as React.CSSProperties} />

        {/* Two tables called `users`, in the same place, one per file. */}
        <MiniTable
            name="users"
            className="fx fx-swap-out"
            style={{ ...box(78, 40, 104), ...delay(400) } as React.CSSProperties}
            columns={[
                { name: 'id', type: 'int', pk: true },
                { name: 'plan', type: 'varchar' },
                { name: 'renews_on', type: 'date' },
            ]}
        />
        <MiniTable
            name="users"
            className="fx fx-swap-in"
            style={{ ...box(78, 40, 104), ...delay(400) } as React.CSSProperties}
            columns={[
                { name: 'id', type: 'int', pk: true },
                { name: 'event', type: 'varchar' },
                { name: 'seen_at', type: 'timestamp' },
            ]}
        />

        <Chip tone="brand" className="fx fx-in -translate-x-1/2 whitespace-nowrap" style={{ ...delay(1200), left: '50%', top: py(124) } as React.CSSProperties}>
            same name, different database
        </Chip>
    </Stage>
);

/** Notes: a to-do stuck to a table, ticked off later. */
export const DemoNotes = () => (
    <Stage>
        <MiniTable
            name="invoices" style={box(12, 34, 86)}
            headerExtra={<StickyNote size={7} className="ml-auto shrink-0 text-white/80" />}
            columns={[{ name: 'id', type: 'int', pk: true }, { name: 'total', type: 'decimal' }]}
        />
        <div className="absolute space-y-1.5" style={{ left: px(126), top: py(26), width: px(120) }}>
            <div className="flex items-start gap-1 rounded border border-[var(--surface-line)] bg-surface p-1.5 shadow-glow-sm">
                <span className="fx fx-fade mt-px flex h-2 w-2 shrink-0 items-center justify-center rounded-[2px] border border-ink-300 bg-brand-600" style={delay(1300)}>
                    <Check size={5} strokeWidth={4} className="text-white" />
                </span>
                <span className="text-[7px] leading-tight text-ink-600">add a tax column</span>
            </div>
            <div className="flex items-start gap-1 rounded border border-[var(--surface-line)] bg-surface p-1.5 shadow-glow-sm">
                <span className="mt-px h-2 w-2 shrink-0 rounded-[2px] border border-ink-300" />
                <span className="text-[7px] leading-tight text-ink-600">confirm the currency column</span>
            </div>
        </div>
        <Pointer className="fx fx-press" style={{ ...delay(700), left: px(128), top: py(30) } as React.CSSProperties} />
    </Stage>
);

/** Export: one schema, four files. */
export const DemoExport = () => {
    /**
     * Deliberately still.
     *
     * This scene used to cycle a code sample through four formats in the same box. Every part of
     * that was working and the whole was unreadable: the fade windows overlap, so two or three
     * formats were lit at once and their sample lines sat on top of each other. The point was
     * never *how* each format looks — the export dialog shows that — it is that one schema leaves
     * as four different files. So the files simply arrive, one after another, and stay.
     */
    const outputs = [
        { icon: FileCode2, label: 'SQL', ext: '.sql', note: 'for Postgres' },
        { icon: GitBranch, label: 'Mermaid', ext: '.md', note: 'for a README' },
        { icon: Table2, label: 'DBML', ext: '.dbml', note: 'for dbdiagram' },
        { icon: ImageIcon, label: 'Image', ext: '.png', note: 'for a doc' },
    ];
    return (
        <Stage>
            <MiniTable
                name="customers" style={box(8, 42, 76)}
                columns={[
                    { name: 'id', type: 'int', pk: true },
                    { name: 'email', type: 'varchar' },
                ]}
            />

            <svg viewBox="0 0 260 150" className="absolute inset-0 h-full w-full" fill="none" preserveAspectRatio="none">
                <path
                    d="M84 64 H104"
                    stroke="var(--color-edge)" strokeWidth="2" strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                />
                <path
                    d="M99 60 L104 64 L99 68"
                    stroke="var(--color-edge)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>

            {/* One animation for the whole group, not one per row. Four fades with four delays
                is how the old version of this scene went wrong: each has its own loop boundary,
                so they arrive in order and then leave raggedly, and at any moment some subset is
                mid-transition. A single fade can never fall out of step with itself. */}
            <div
                className="fx fx-in absolute space-y-1.5"
                style={{ ...delay(400), left: px(112), top: py(14), width: px(136) } as React.CSSProperties}
            >
                {outputs.map(({ icon: Icon, label, ext, note }) => (
                    <span
                        key={ext}
                        className="flex items-center gap-1.5 rounded border border-[var(--surface-line)] bg-surface px-1.5 py-1.5 shadow-glow-sm"
                    >
                        <Icon size={9} className="shrink-0 text-brand-600" />
                        <span className="text-[7.5px] font-semibold text-ink-800">{label}</span>
                        <span className="font-mono text-[7px] text-ink-500">{ext}</span>
                        <span className="ml-auto text-[6.5px] text-ink-400">{note}</span>
                    </span>
                ))}
            </div>
        </Stage>
    );
};

/** Sharing: a link that only ever reads. */
export const DemoShare = () => (
    <Stage>
        <MiniTable
            name="schema" style={box(78, 46, 104)}
            columns={[{ name: 'id', type: 'int', pk: true }, { name: 'name', type: 'varchar' }]}
        />
        <Chip className="fx fx-in -translate-x-1/2 whitespace-nowrap font-mono" style={{ ...delay(400), left: '50%', top: py(14) } as React.CSSProperties}>
            <Share2 size={8} className="text-brand-600" /> /share/9f3c…
        </Chip>
        <Chip tone="brand" className="fx fx-in -translate-x-1/2 whitespace-nowrap" style={{ ...delay(1400), left: '50%', top: py(122) } as React.CSSProperties}>
            <Lock size={8} /> read-only, no account needed
        </Chip>
    </Stage>
);

/** Every scene, in one place, so the section and the docs cannot drift apart. */
export const FEATURE_DEMOS = {
    relationships: DemoRelationships,
    import: DemoImport,
    schemaEdit: DemoSchemaEdit,
    dataEdit: DemoDataEdit,
    safeDelete: DemoSafeDelete,
    search: DemoSearch,
    isolation: DemoIsolation,
    notes: DemoNotes,
    export: DemoExport,
    share: DemoShare,
} as const;

export type FeatureDemoId = keyof typeof FEATURE_DEMOS;
