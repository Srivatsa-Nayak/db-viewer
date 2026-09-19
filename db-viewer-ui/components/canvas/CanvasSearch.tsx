"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, CornerDownLeft, Table2, Columns3 } from 'lucide-react';
import { Node } from 'reactflow';
import { ColumnInfo } from '@/types';

/**
 * Find a table or a column on a canvas too big to scan by eye.
 *
 * Past about thirty tables the diagram stops being something you look at and becomes something
 * you navigate, and at that point "where is `orders.customer_id`?" has no answer short of
 * panning around until you spot it. Ctrl+F is the answer everyone already knows, so it is the
 * one bound here — which means it has to be intercepted before the browser's own find bar takes
 * it, and that is only defensible because this does the same job on the thing the user is
 * actually looking at. The browser's version finds nothing useful on a canvas: the table names
 * are inside an SVG transform, and half of them are scrolled out of the DOM's idea of view.
 */

export interface SearchHit {
    nodeId: string;
    table: string;
    /** Absent when the table name itself is the match. */
    column?: string;
    columnType?: string;
}

interface CanvasSearchProps {
    nodes: Node[];
    /** Pans and zooms to a hit, and dims everything else. */
    onSelect: (hit: SearchHit) => void;
    onClose: () => void;
}

/** Enough to be useful, few enough to stay a list rather than a second canvas. */
const MAX_HITS = 40;

const collectHits = (nodes: Node[], query: string): SearchHit[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const tableHits: SearchHit[] = [];
    const columnHits: SearchHit[] = [];

    for (const node of nodes) {
        const table = String(node.data?.label ?? node.id);
        if (table.toLowerCase().includes(needle)) {
            tableHits.push({ nodeId: node.id, table });
        }
        const columns: ColumnInfo[] = Array.isArray(node.data?.columns) ? node.data.columns : [];
        for (const column of columns) {
            if (column.name.toLowerCase().includes(needle)) {
                columnHits.push({
                    nodeId: node.id, table, column: column.name, columnType: column.type,
                });
            }
        }
    }

    // Tables first: someone searching "order" almost always wants the table, and burying it
    // under nine columns called `order_id` is the wrong answer to the same keystrokes.
    return [...tableHits, ...columnHits].slice(0, MAX_HITS);
};

export const CanvasSearch = ({ nodes, onSelect, onClose }: CanvasSearchProps) => {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const hits = useMemo(() => collectHits(nodes, query), [nodes, query]);

    // Mounting is the reset: the panel is rendered only while open, so there is no stale query
    // to clear and no effect needed to clear it.
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const select = useCallback((index: number) => {
        const hit = hits[index];
        if (hit) onSelect(hit);
    }, [hits, onSelect]);

    // Jumping as you arrow through the list is the whole point — the canvas moves with the
    // selection, so the result is visible before you commit to it.
    const move = useCallback((delta: number) => {
        if (hits.length === 0) return;
        const next = (activeIndex + delta + hits.length) % hits.length;
        setActiveIndex(next);
        select(next);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex, hits.length, select]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(-1);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            select(activeIndex);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
        }
    };

    return (
        <div
            className="w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface shadow-glow-lg overflow-hidden anim-menu-in"
            role="search"
        >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-200">
                <Search size={15} className="text-ink-400 shrink-0" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setActiveIndex(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder="Find a table or column..."
                    aria-label="Find a table or column"
                    className="flex-1 min-w-0 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
                />
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1 -m-1 rounded text-ink-400 hover:text-ink-900 hover:bg-ink-100 transition-colors shrink-0"
                    aria-label="Close search"
                >
                    <X size={15} />
                </button>
            </div>

            {query.trim() !== '' && (
                <div className="max-h-72 overflow-y-auto scroll-slim">
                    {hits.length === 0 ? (
                        <p className="px-3 py-4 text-xs text-ink-500">
                            Nothing matches &quot;{query.trim()}&quot;.
                        </p>
                    ) : (
                        <ul ref={listRef} role="listbox" aria-label="Search results">
                            {hits.map((hit, index) => (
                                <li key={`${hit.nodeId}.${hit.column ?? ''}`}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={index === activeIndex}
                                        onClick={() => {
                                            setActiveIndex(index);
                                            select(index);
                                        }}
                                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                                            index === activeIndex ? 'bg-brand-50' : 'hover:bg-ink-50'
                                        }`}
                                    >
                                        {hit.column
                                            ? <Columns3 size={13} className="text-ink-400 shrink-0" />
                                            : <Table2 size={13} className="text-brand-600 shrink-0" />}
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-mono text-xs text-ink-900 truncate">
                                                {hit.column ? `${hit.table}.${hit.column}` : hit.table}
                                            </span>
                                            <span className="block text-[10px] text-ink-500 mt-0.5">
                                                {hit.column ? `column · ${hit.columnType ?? 'unknown'}` : 'table'}
                                            </span>
                                        </span>
                                        {index === activeIndex && (
                                            <CornerDownLeft size={12} className="text-ink-400 shrink-0" />
                                        )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <p className="px-3 py-1.5 border-t border-ink-200 text-[10px] text-ink-500 flex items-center gap-3">
                <span><kbd className="font-mono">↑↓</kbd> move</span>
                <span><kbd className="font-mono">Enter</kbd> jump</span>
                <span><kbd className="font-mono">Esc</kbd> close</span>
            </p>
        </div>
    );
};
