"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Database, KeyRound } from 'lucide-react';
import { TemplateSchema } from '@/services/api';

/**
 * Draws a template the way the editor will draw it.
 *
 * Styled to match `TableNode` deliberately — the point of the preview is to answer "what will
 * I actually get", so a different-looking diagram would be worse than none. It renders from
 * the schema the backend parsed out of the template, so nothing here has to understand SQL.
 *
 * Tables are laid out in dependency order (a table sits to the right of everything it
 * references), which is what makes an ER diagram readable rather than a grid of boxes.
 *
 * The diagram is scaled to fit its **measured** container. It previously scaled to fixed
 * fallback dimensions, so whenever the real pane was shorter than those — a short viewport, or
 * the stacked layout below `lg` — the content overflowed an `overflow-hidden` wrapper and was
 * silently cropped. Because the content is centred, the crop took the top of the tallest
 * column first, which is how `customers` went missing from the Online Store preview.
 */

const CARD_W = 152;
const HEADER_H = 22;
const ROW_H = 17;
const COL_GAP = 78;
const ROW_GAP = 22;

interface Props {
    schema: TemplateSchema;
    /** Fallback box, used only for the first paint before the container has been measured. */
    width?: number;
    height?: number;
}

export const TemplateDiagram = ({ schema, width = 560, height = 380 }: Props) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [box, setBox] = useState({ w: width, h: height });

    useEffect(() => {
        const node = containerRef.current;
        if (!node || typeof ResizeObserver === 'undefined') return;

        // observe() fires an initial callback, so the first real measurement arrives without
        // a setState in the effect body (which would trigger a cascading render).
        const observer = new ResizeObserver(([entry]) => {
            const { width: w, height: h } = entry.contentRect;
            if (w > 0 && h > 0) setBox({ w, h });
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    const layout = useMemo(() => {
        const tables = schema?.tables ?? [];
        const relationships = schema?.relationships ?? [];
        if (tables.length === 0) return null;

        const names = tables.map(t => t.name);

        // Depth = how many hops this table is from one that references nothing. Parents end up
        // on the left, dependents to the right, which is the conventional reading order.
        const parentsOf = new Map<string, string[]>();
        names.forEach(n => parentsOf.set(n, []));
        relationships.forEach(r => {
            // A self-reference would otherwise push the table infinitely rightwards.
            if (r.sourceTable !== r.targetTable && parentsOf.has(r.sourceTable)) {
                parentsOf.get(r.sourceTable)!.push(r.targetTable);
            }
        });

        const depth = new Map<string, number>();
        const resolve = (name: string, seen: Set<string>): number => {
            if (depth.has(name)) return depth.get(name)!;
            // A cycle has no well-defined depth; stopping at 0 keeps the layout finite.
            if (seen.has(name)) return 0;
            seen.add(name);
            const parents = parentsOf.get(name) ?? [];
            const d = parents.length === 0
                ? 0
                : Math.max(...parents.map(p => (names.includes(p) ? resolve(p, seen) + 1 : 0)));
            depth.set(name, d);
            return d;
        };
        names.forEach(n => resolve(n, new Set()));

        const columns = new Map<number, string[]>();
        names.forEach(n => {
            const d = depth.get(n) ?? 0;
            if (!columns.has(d)) columns.set(d, []);
            columns.get(d)!.push(n);
        });

        const heightOf = (name: string) =>
            HEADER_H + (tables.find(t => t.name === name)?.columns.length ?? 0) * ROW_H + 6;

        // Centre each column vertically against the tallest one.
        const columnHeights = [...columns.entries()].map(([d, list]) => [
            d, list.reduce((h, n) => h + heightOf(n) + ROW_GAP, -ROW_GAP),
        ] as const);
        const tallest = Math.max(...columnHeights.map(([, h]) => h));

        const positions = new Map<string, { x: number; y: number; h: number }>();
        [...columns.entries()]
            .sort(([a], [b]) => a - b)
            .forEach(([d, list]) => {
                const columnHeight = columnHeights.find(([cd]) => cd === d)![1];
                let y = (tallest - columnHeight) / 2;
                list.forEach(name => {
                    const h = heightOf(name);
                    positions.set(name, { x: d * (CARD_W + COL_GAP), y, h });
                    y += h + ROW_GAP;
                });
            });

        const totalW = (Math.max(...columns.keys()) + 1) * (CARD_W + COL_GAP) - COL_GAP;
        // Fit within the measured box, with a small margin so cards do not touch the edge.
        // Never scale up: a two-table template should not become comically large.
        const scale = Math.min(box.w / (totalW + 24), box.h / (tallest + 24), 1);

        return { tables, relationships, positions, totalW, totalH: tallest, scale };
    }, [schema, box]);

    const { tables, relationships, positions, totalW, totalH, scale } = layout ?? {
        tables: [], relationships: [], positions: new Map<string, { x: number; y: number; h: number }>(),
        totalW: 0, totalH: 0, scale: 1,
    };

    /** Vertical centre of a column's row, so an edge meets the field it belongs to. */
    const rowY = (tableName: string, columnName: string) => {
        const pos = positions.get(tableName);
        const table = tables.find(t => t.name === tableName);
        if (!pos || !table) return 0;
        const index = table.columns.findIndex(c => c.name === columnName);
        return index < 0
            ? pos.y + pos.h / 2
            : pos.y + HEADER_H + index * ROW_H + ROW_H / 2;
    };

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full overflow-hidden rounded-lg border border-ink-200"
            style={{
                backgroundColor: '#fafafa',
                backgroundImage: 'radial-gradient(#d4d4d8 1px, transparent 1px)',
                backgroundSize: '18px 18px',
            }}
        >
            {!layout && (
                <div className="flex h-full items-center justify-center text-sm text-ink-400">
                    No diagram to show.
                </div>
            )}

            <div
                className="absolute left-1/2 top-1/2"
                style={{
                    width: totalW,
                    height: totalH,
                    transform: `translate(-50%, -50%) scale(${scale})`,
                    transformOrigin: 'center',
                }}
            >
                <svg className="absolute inset-0 overflow-visible" width={totalW} height={totalH} fill="none">
                    <defs>
                        <marker id="tpl-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                            <path d="M0,0 L7,3.5 L0,7 Z" fill="#2563eb" />
                        </marker>
                    </defs>
                    {relationships.map((rel, i) => {
                        const from = positions.get(rel.targetTable);
                        const to = positions.get(rel.sourceTable);
                        if (!from || !to) return null;

                        const x1 = from.x + CARD_W;
                        const y1 = rowY(rel.targetTable, rel.targetColumn);
                        const x2 = to.x;
                        const y2 = rowY(rel.sourceTable, rel.sourceColumn);
                        const bend = Math.max(28, Math.abs(x2 - x1) / 2);

                        return (
                            <path
                                key={i}
                                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                                stroke="#2563eb"
                                strokeWidth="1.5"
                                strokeOpacity="0.8"
                                markerEnd="url(#tpl-arrow)"
                            />
                        );
                    })}
                </svg>

                {tables.map(table => {
                    const pos = positions.get(table.name)!;
                    return (
                        <div
                            key={table.name}
                            className="absolute rounded-md border border-brand-200 bg-white shadow-lg"
                            style={{ left: pos.x, top: pos.y, width: CARD_W }}
                        >
                            <div className="flex items-center gap-1.5 rounded-t-md bg-brand-600 px-2 py-1.5">
                                <Database size={10} className="shrink-0 text-white" />
                                <span className="truncate text-[10px] font-bold leading-tight text-white">
                                    {table.name}
                                </span>
                            </div>
                            <div className="rounded-b-md bg-ink-50 py-0.5">
                                {table.columns.map(column => (
                                    <div
                                        key={column.name}
                                        className="flex items-center justify-between px-2"
                                        style={{ height: ROW_H }}
                                    >
                                        <span className="flex items-center gap-1 overflow-hidden">
                                            {(column.pk || column.name.endsWith('_id')) && (
                                                <KeyRound size={8} className="shrink-0 text-brand-500" />
                                            )}
                                            <span className="truncate font-mono text-[9px] font-medium leading-none text-ink-700">
                                                {column.name}
                                            </span>
                                        </span>
                                        <span className="ml-2 shrink-0 font-mono text-[8px] uppercase leading-none text-ink-400">
                                            {column.type}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
