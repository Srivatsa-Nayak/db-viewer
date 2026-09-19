"use client";

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { FileCode2, RotateCcw, MousePointer2 } from 'lucide-react';
import { DemoRelationship, DemoTable } from './DemoCanvas';
import { HeroDiagram } from './HeroDiagram';

/**
 * The hero: a .sql file becoming a diagram, then handing you the diagram.
 *
 * A developer tool has about three seconds to prove itself, and a paragraph describing
 * drag-and-drop spends all three asking to be believed. So the hero performs the product
 * instead — the script types itself out, the tables bloom in the order the file declares them,
 * the foreign keys draw themselves, and then the canvas is simply yours: the tables are
 * draggable, on the landing page, before any sign-up.
 *
 * The whole sequence is the first ten seconds of actually using the app, which is the only
 * honest demo. Everything is client-side; no upload and no workspace is involved.
 */

/**
 * React Flow is ~50KB that the landing page has no other use for, so it arrives after paint.
 * The placeholder is the old CSS mock-up at the same dimensions — the reader sees a schema
 * immediately and it is replaced by the live one, rather than a spinner sitting in the hero.
 */
const DemoCanvas = dynamic(() => import('./DemoCanvas').then(m => m.DemoCanvas), {
    ssr: false,
    loading: () => <HeroDiagram />,
});

const TABLES: DemoTable[] = [
    {
        name: 'customers',
        position: { x: 0, y: 0 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'email', type: 'VARCHAR' },
            { name: 'city', type: 'VARCHAR' },
        ],
    },
    {
        name: 'products',
        position: { x: 0, y: 150 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'title', type: 'VARCHAR' },
            { name: 'price', type: 'DECIMAL' },
        ],
    },
    {
        name: 'orders',
        position: { x: 250, y: 20 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'customer_id', type: 'INT', fk: true },
            { name: 'placed_on', type: 'DATE' },
        ],
    },
    {
        name: 'order_items',
        position: { x: 250, y: 155 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'order_id', type: 'INT', fk: true },
            { name: 'product_id', type: 'INT', fk: true },
        ],
    },
];

const RELATIONSHIPS: DemoRelationship[] = [
    { from: 'orders', fromColumn: 'customer_id', to: 'customers', toColumn: 'id' },
    { from: 'order_items', fromColumn: 'order_id', to: 'orders', toColumn: 'id' },
    { from: 'order_items', fromColumn: 'product_id', to: 'products', toColumn: 'id' },
];

/** The script, as the reader watches it arrive. Kept short enough to read in the time it plays. */
const SQL_LINES = [
    'CREATE TABLE customers (',
    '  id    INT PRIMARY KEY,',
    '  email VARCHAR(255)',
    ');',
    'CREATE TABLE orders (',
    '  id          INT PRIMARY KEY,',
    '  customer_id INT REFERENCES customers(id)',
    ');',
];

/** Milliseconds between each line of the script appearing. */
const LINE_STEP = 110;
/** When the script has been read and the canvas takes over. */
const SCRIPT_HOLD = SQL_LINES.length * LINE_STEP + 480;
/** Stagger between tables blooming, and when the edges start drawing. */
const BLOOM_STEP = 150;
const EDGE_DELAY = SCRIPT_HOLD + TABLES.length * BLOOM_STEP;

export const HeroCanvas = () => {
    /**
     * Bumping this remounts the canvas, which restarts every CSS animation inside it.
     *
     * Replaying by toggling classes means chasing animation state across a dozen elements;
     * remounting is one line and cannot get out of step with itself.
     */
    const [run, setRun] = useState(0);
    /**
     * Where the sequence has got to. One value rather than two booleans, and advanced only by
     * the timers below — an effect that opened by setting state back to the start would be a
     * cascading render, and the reset belongs to the event that asked for it anyway.
     */
    const [phase, setPhase] = useState<'script' | 'bloom' | 'ready'>('script');

    useEffect(() => {
        const hide = window.setTimeout(() => setPhase('bloom'), SCRIPT_HOLD);
        const done = window.setTimeout(() => setPhase('ready'), EDGE_DELAY + 1100);
        return () => {
            window.clearTimeout(hide);
            window.clearTimeout(done);
        };
    }, [run]);

    const replay = useCallback(() => {
        setPhase('script');
        setRun(value => value + 1);
    }, []);

    return (
        <div className="relative">
            {/* The frame. A tab bar and a status line are enough to say "this is the editor"
                without drawing a fake editor around it. */}
            <div className="surface-card overflow-hidden rounded-2xl border shadow-glow-lg">
                <div className="flex items-center gap-2 border-b border-[var(--surface-line)] bg-[var(--surface-tint)] px-3 py-2">
                    <span className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-[11px] font-medium text-ink-700 shadow-sm">
                        <FileCode2 size={11} className="text-brand-600" />
                        <span className="font-mono">example-store.sql</span>
                    </span>
                    <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-ink-500">
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        </span>
                        read from a live database
                    </span>
                </div>

                <div className="demo-canvas relative h-[300px] sm:h-[330px]">
                    <DemoCanvas
                        key={run}
                        tables={TABLES}
                        relationships={RELATIONSHIPS}
                        bloomStep={BLOOM_STEP}
                        edgeDelay={EDGE_DELAY}
                        className="h-full w-full"
                        ariaLabel="An example schema: customers, orders, order items and products, with the foreign keys between them"
                    />

                    {/* The script, laid over the canvas it is about to become. Pointer-events off
                        so it never stands between the reader and a table. */}
                    <div
                        aria-hidden
                        className={`pointer-events-none absolute inset-0 flex items-center justify-center p-4 transition-opacity duration-500 ${
                            phase === 'script' ? 'opacity-100' : 'opacity-0'
                        }`}
                    >
                        <pre className="max-w-full overflow-hidden rounded-xl border border-[var(--surface-line)] bg-surface/95 p-3 text-[10.5px] leading-[1.55] shadow-glow-md backdrop-blur-sm">
                            {/* Keyed by position: the script legitimately contains the same line
                                twice (`);` closes both tables), and keying by content silently
                                drops the duplicate. */}
                            {SQL_LINES.map((line, index) => (
                                <span
                                    key={index}
                                    className="hero-label block whitespace-pre font-mono text-ink-700"
                                    style={{ animationDelay: `${index * LINE_STEP}ms` }}
                                >
                                    {line}
                                </span>
                            ))}
                        </pre>
                    </div>

                    {/* Only once the diagram has settled, and only then: an invitation to touch it
                        while it is still assembling would be an invitation to interrupt it. */}
                    <div
                        className={`pointer-events-none absolute inset-x-0 bottom-2 flex justify-center transition-opacity duration-500 ${
                            phase === 'ready' ? 'opacity-100' : 'opacity-0'
                        }`}
                    >
                        <span className="flex items-center gap-1.5 rounded-full border border-[var(--surface-line)] bg-surface/90 px-3 py-1 text-[10.5px] font-medium text-ink-600 shadow-sm backdrop-blur-sm">
                            <MousePointer2 size={11} className="text-brand-600" />
                            Drag a table — this canvas is real
                        </span>
                    </div>
                </div>
            </div>

            <button
                type="button"
                onClick={replay}
                className="absolute -bottom-3 right-3 flex items-center gap-1.5 rounded-full border border-[var(--surface-line)] bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-600 shadow-glow-sm transition-colors hover:border-brand-300 hover:text-brand-700"
            >
                <RotateCcw size={11} /> Replay
            </button>
        </div>
    );
};
