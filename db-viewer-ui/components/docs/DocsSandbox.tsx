"use client";

import React, { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
    AlertTriangle, Check, Copy, Loader2, PlayCircle, RotateCcw, Trash2, Info,
} from 'lucide-react';
import { DemoRelationship, DemoTable } from '@/components/landing/DemoCanvas';
import { copyText, toDbml, toMermaid } from '@/services/exportDiagram';
import { ColumnInfo, Relationship } from '@/types';

/**
 * Live examples, embedded in the prose that describes them.
 *
 * Documentation that says "the delete is refused, and it names the tables that depend on the one
 * you tried to drop" is asking to be believed. One that lets you press the button and read the
 * actual refusal is not. Every sandbox here is the real thing as far as it can be without an
 * account: the canvas is the app's canvas, and the export panel calls the *production* exporter
 * (`services/exportDiagram`), so what it prints is byte-for-byte what the Export dialog produces.
 *
 * What they deliberately are not is an iframe of the app. An embedded editor would need a
 * workspace on the server, which means an upload, an owner and something to clean up — for a
 * paragraph in a manual. These are client-side and cannot break because a backend is down.
 */

/** The canvas is ~50KB of React Flow; documentation should not pay for it before it scrolls there. */
const DemoCanvas = dynamic(() => import('@/components/landing/DemoCanvas').then(m => m.DemoCanvas), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-400">
            <Loader2 size={15} className="animate-spin" /> loading the canvas…
        </div>
    ),
});

/** The shared frame: a titled panel that says plainly that it is live. */
const Sandbox = ({ title, hint, children, controls }: {
    title: string;
    hint: string;
    children: React.ReactNode;
    controls?: React.ReactNode;
}) => (
    <section className="my-6 overflow-hidden rounded-xl border border-[var(--surface-line)] bg-surface shadow-glow-sm">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--surface-line)] bg-ink-50 px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
                <PlayCircle size={14} className="text-brand-600" />
                {title}
            </span>
            <span className="text-xs text-ink-500">{hint}</span>
            {controls && <span className="ml-auto flex flex-wrap items-center gap-2">{controls}</span>}
        </header>
        {children}
    </section>
);

const Button = ({ children, onClick, tone = 'plain', disabled }: {
    children: React.ReactNode;
    onClick: () => void;
    tone?: 'plain' | 'danger';
    disabled?: boolean;
}) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            tone === 'danger'
                ? 'border-[var(--color-tone-error-line)] bg-[var(--color-tone-error-bg)] text-[var(--color-tone-error-ink)] hover:brightness-110'
                : 'border-[var(--surface-line)] bg-surface text-ink-700 hover:border-brand-300 hover:text-brand-700'
        }`}
    >
        {children}
    </button>
);

/* ── The shared sample schema ─────────────────────────────────────────────── */

const TABLES: DemoTable[] = [
    {
        name: 'customers',
        position: { x: 0, y: 0 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'email', type: 'VARCHAR' },
        ],
    },
    {
        name: 'orders',
        position: { x: 235, y: 20 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'customer_id', type: 'INT', fk: true },
            { name: 'total', type: 'DECIMAL' },
        ],
    },
    {
        name: 'order_items',
        position: { x: 235, y: 155 },
        columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'order_id', type: 'INT', fk: true },
            { name: 'quantity', type: 'INT' },
        ],
    },
];

const RELATIONSHIPS: DemoRelationship[] = [
    { from: 'orders', fromColumn: 'customer_id', to: 'customers', toColumn: 'id' },
    { from: 'order_items', fromColumn: 'order_id', to: 'orders', toColumn: 'id' },
];

/* ── Sandbox: a delete that is refused ────────────────────────────────────── */

/** Tables that still have something pointing at them cannot go. */
const dependentsOf = (table: string, present: string[]) =>
    RELATIONSHIPS.filter(r => r.to === table && present.includes(r.from)).map(r => r.from);

export const DeleteSandbox = () => {
    const [dropped, setDropped] = useState<string[]>([]);
    const [refused, setRefused] = useState<{ table: string; by: string[] } | null>(null);

    const present = useMemo(
        () => TABLES.filter(t => !dropped.includes(t.name)), [dropped]
    );
    const presentNames = present.map(t => t.name);

    const attemptDelete = useCallback((table: string) => {
        const blockers = dependentsOf(table, presentNames);
        if (blockers.length > 0) {
            setRefused({ table, by: blockers });
            return;
        }
        setRefused(null);
        setDropped(previous => [...previous, table]);
    }, [presentNames]);

    const reset = useCallback(() => {
        setDropped([]);
        setRefused(null);
    }, []);

    const relationships = RELATIONSHIPS.filter(
        r => presentNames.includes(r.from) && presentNames.includes(r.to)
    );

    return (
        <Sandbox
            title="Try it: delete a table that something points at"
            hint="This runs the same rule the app does."
            controls={
                <>
                    <Button tone="danger" onClick={() => attemptDelete('customers')} disabled={dropped.includes('customers')}>
                        <Trash2 size={12} /> Delete customers
                    </Button>
                    <Button tone="danger" onClick={() => attemptDelete('order_items')} disabled={dropped.includes('order_items')}>
                        <Trash2 size={12} /> Delete order_items
                    </Button>
                    <Button onClick={reset} disabled={dropped.length === 0 && !refused}>
                        <RotateCcw size={12} /> Reset
                    </Button>
                </>
            }
        >
            <div className="demo-canvas h-[260px]">
                <DemoCanvas
                    // Remounted when the schema changes so the remaining tables settle into the
                    // space the dropped one left, exactly as the canvas does after a real delete.
                    key={presentNames.join('|')}
                    tables={present}
                    relationships={relationships}
                    blockedTables={refused ? [refused.table] : []}
                    className="h-full w-full"
                    ariaLabel="A sample schema of customers, orders and order items"
                />
            </div>

            <div className="border-t border-[var(--surface-line)] px-4 py-3">
                {refused ? (
                    <p className="tone-error flex items-start gap-2 rounded-md p-3 text-[13px] leading-relaxed">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>
                            <strong className="font-mono">{refused.table}</strong> was not deleted.{' '}
                            {refused.by.map(t => <strong key={t} className="font-mono">{t}</strong>)}{' '}
                            {refused.by.length === 1 ? 'has' : 'have'} a foreign key pointing at it.
                            Drop the dependent table first, or remove the key.
                        </span>
                    </p>
                ) : dropped.length > 0 ? (
                    <p className="tone-success flex items-start gap-2 rounded-md p-3 text-[13px] leading-relaxed">
                        <Check size={14} className="mt-0.5 shrink-0" />
                        <span>
                            <strong className="font-mono">{dropped.join(', ')}</strong> dropped — nothing
                            depended on it. Now try <strong className="font-mono">customers</strong>{' '}
                            again: with <strong className="font-mono">order_items</strong> gone,{' '}
                            <strong className="font-mono">orders</strong> still points at it, so it is
                            still refused.
                        </span>
                    </p>
                ) : (
                    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-500">
                        <Info size={14} className="mt-0.5 shrink-0 text-ink-400" />
                        Press either button. One of them works and one of them does not, and the
                        difference is whether anything still refers to the table.
                    </p>
                )}
            </div>
        </Sandbox>
    );
};

/* ── Sandbox: the export formats, generated live ──────────────────────────── */

/** The sample schema in the shape the real exporter takes. */
const EXPORT_SOURCE = {
    tables: TABLES.map(table => ({
        name: table.name,
        columns: table.columns.map((column): ColumnInfo => ({
            name: column.name,
            type: column.type,
            isPk: column.pk,
            notNull: column.pk,
        })),
    })),
    relationships: RELATIONSHIPS.map((r): Relationship => ({
        sourceTable: r.from,
        sourceColumn: r.fromColumn,
        targetTable: r.to,
        targetColumn: r.toColumn,
    })),
};

const FORMATS = [
    {
        id: 'mermaid' as const,
        label: 'Mermaid',
        blurb: 'Paste into a GitHub README, a Jira ticket or a Notion page — all three render it.',
        render: () => toMermaid(EXPORT_SOURCE),
    },
    {
        id: 'dbml' as const,
        label: 'DBML',
        blurb: 'Paste into dbdiagram.io for an editable diagram, or commit it beside the code.',
        render: () => toDbml(EXPORT_SOURCE),
    },
];

export const ExportSandbox = () => {
    const [format, setFormat] = useState<'mermaid' | 'dbml'>('mermaid');
    const [copied, setCopied] = useState(false);

    const active = FORMATS.find(f => f.id === format)!;
    // Generated on demand by the same functions the Export dialog calls, so this cannot show
    // something the app would not actually produce.
    const output = useMemo(() => active.render(), [active]);

    const copy = useCallback(async () => {
        const ok = await copyText(output);
        setCopied(ok);
        if (ok) window.setTimeout(() => setCopied(false), 1800);
    }, [output]);

    return (
        <Sandbox
            title="Try it: the text exports, generated now"
            hint="Produced by the same code the Export dialog runs."
            controls={
                <>
                    <span className="flex rounded-md border border-[var(--surface-line)] p-0.5">
                        {FORMATS.map(option => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => setFormat(option.id)}
                                aria-pressed={format === option.id}
                                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    format === option.id
                                        ? 'bg-brand-50 text-brand-700'
                                        : 'text-ink-500 hover:text-ink-800'
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </span>
                    <Button onClick={copy}>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                </>
            }
        >
            <p className="border-b border-[var(--surface-line)] px-4 py-2.5 text-[13px] leading-relaxed text-ink-500">
                {active.blurb}
            </p>
            <pre className="max-h-72 overflow-auto scroll-slim bg-ink-50 p-4 text-[12px] leading-relaxed text-ink-800">
                {output}
            </pre>
        </Sandbox>
    );
};

/* ── Sandbox: the canvas itself ───────────────────────────────────────────── */

export const CanvasSandbox = () => (
    <Sandbox
        title="Try it: the canvas"
        hint="Drag a table. This is the editor's canvas, with no file open behind it."
    >
        <div className="demo-canvas h-[260px]">
            <DemoCanvas
                tables={TABLES}
                relationships={RELATIONSHIPS}
                className="h-full w-full"
                ariaLabel="A sample schema of customers, orders and order items"
            />
        </div>
    </Sandbox>
);
