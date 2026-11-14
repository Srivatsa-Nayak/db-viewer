"use client";

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, KeyRound, Link2, Pencil, Search, Table2 } from 'lucide-react';
import type { ColumnInfo, Relationship } from '@/types';

/**
 * The schema as a list, for a phone.
 *
 * At 375px the diagram fits by shrinking every table until its text is a few pixels tall: it
 * shows the shape of a schema and nothing you can read. This shows the same tables as cards —
 * columns with their types and keys, what each table points at and what points at it — at a
 * size meant for a thumb, and opens a table's rows on tap. The diagram is one switch away.
 */
export const TableListView = ({ tables, relationships, onEditTable }: {
    tables: { name: string; columns: ColumnInfo[]; isView?: boolean }[];
    relationships: Relationship[];
    onEditTable: (table: string) => void;
}) => {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<Set<string>>(() => new Set());

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return tables;
        return tables.filter(t => t.name.toLowerCase().includes(q)
            || t.columns.some(c => c.name.toLowerCase().includes(q)));
    }, [tables, query]);

    const toggle = (name: string) => setOpen(prev => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name); else next.add(name);
        return next;
    });

    return (
        <div className="flex-1 min-h-0 overflow-y-auto bg-canvas px-3 py-3 scroll-slim">
            <label className="relative mb-3 block">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <span className="sr-only">Find a table or column</span>
                <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={`Find in ${tables.length} table${tables.length === 1 ? '' : 's'}`}
                    className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink-900
                               placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
            </label>

            {visible.length === 0 && (
                <p className="px-1 py-6 text-center text-sm text-ink-500">Nothing matches “{query}”.</p>
            )}

            <ul className="space-y-2">
                {visible.map(table => {
                    const isOpen = open.has(table.name) || query.trim().length > 0;
                    const outgoing = relationships.filter(r => r.sourceTable === table.name);
                    const incoming = relationships.filter(r => r.targetTable === table.name && r.sourceTable !== table.name);
                    const fkColumns = new Set(outgoing.map(r => r.sourceColumn));
                    return (
                        <li key={table.name} className="schema-card relative overflow-hidden rounded-lg border border-line bg-surface">
                            <div className="flex items-center">
                                <button
                                    type="button"
                                    onClick={() => toggle(table.name)}
                                    aria-expanded={isOpen}
                                    className="flex min-h-12 min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                                >
                                    {isOpen ? <ChevronDown size={16} className="shrink-0 text-ink-400" />
                                        : <ChevronRight size={16} className="shrink-0 text-ink-400" />}
                                    {table.isView ? <Eye size={15} className="shrink-0 text-ink-400" />
                                        : <Table2 size={15} className="shrink-0 text-brand-600" />}
                                    <span className="truncate font-mono text-sm font-semibold text-ink-900">{table.name}</span>
                                    <span className="ml-auto shrink-0 text-xs text-ink-500">
                                        {table.columns.length} col{table.columns.length === 1 ? '' : 's'}
                                    </span>
                                </button>
                                {!table.isView && (
                                    <button
                                        type="button"
                                        onClick={() => onEditTable(table.name)}
                                        className="flex h-12 w-12 shrink-0 items-center justify-center border-l border-line text-ink-500 hover:text-brand-700"
                                        aria-label={`Open the rows of ${table.name}`}
                                        title="Rows"
                                    >
                                        <Pencil size={15} />
                                    </button>
                                )}
                            </div>

                            {isOpen && (
                                <div className="border-t border-line px-3 pb-3 pt-2">
                                    <ul className="divide-y divide-line">
                                        {table.columns.map(c => (
                                            <li key={c.name} className="flex items-center gap-2 py-1.5 text-[13px]">
                                                <span className="w-4 shrink-0">
                                                    {c.isPk ? <KeyRound size={13} className="text-key-pk" aria-label="primary key" />
                                                        : fkColumns.has(c.name) ? <Link2 size={13} className="text-key-fk" aria-label="foreign key" /> : null}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate font-mono text-ink-800">{c.name}</span>
                                                <span className="shrink-0 font-mono text-[11px] text-ink-500">
                                                    {c.type}{c.notNull && !c.isPk ? ' · not null' : ''}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                    {(outgoing.length > 0 || incoming.length > 0) && (
                                        <div className="mt-2 space-y-1 text-xs text-ink-600">
                                            {outgoing.map(r => (
                                                <p key={`o-${r.sourceColumn}-${r.targetTable}`}>
                                                    <span className="font-mono">{r.sourceColumn}</span> → <span className="font-mono">{r.targetTable}.{r.targetColumn}</span>
                                                </p>
                                            ))}
                                            {incoming.length > 0 && (
                                                <p>Referenced by {incoming.map(r => r.sourceTable)
                                                    .filter((t, i, all) => all.indexOf(t) === i).join(', ')}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
