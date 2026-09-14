"use client";

import React, { useMemo, useState } from 'react';
import {
    ChevronRight, ChevronDown, Database, Table,
    Columns, FileCode, Search, LayoutPanelLeft, Plus, KeyRound,
} from 'lucide-react';
import { ColumnInfo } from '@/types';

export interface ExplorerFile {
    id: string;
    name: string;
    tables: { name: string; columns: ColumnInfo[] }[];
}

interface FileExplorerProps {
    files: ExplorerFile[];
    activeFileId: string | null;
    onSelectFile: (fileId: string) => void;
    onCreateFile: () => void;
    isOpen: boolean;
    onToggle: () => void;
}

/**
 * The panel's width, split by breakpoint.
 *
 * These are deliberately *not* one constant. The collapsed state needs the base width (it
 * slides out at full width below `lg`) but must set `lg:w-0`, and emitting `lg:w-64` and
 * `lg:w-0` together lets Tailwind's output order — not this file — decide which one wins.
 */
const PANEL_W_BASE = 'w-[min(18rem,85vw)]';
const PANEL_W_LG = 'lg:w-64';

export const FileExplorer = ({
    files, activeFileId, onSelectFile, onCreateFile, isOpen, onToggle,
}: FileExplorerProps) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Matches a file by its own name or by any table inside it — searching for a table you
    // half-remember is the more common need once more than one file is open.
    const filteredFiles = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return files;
        return files.filter(f =>
            f.name.toLowerCase().includes(term)
            || f.tables.some(t => t.name.toLowerCase().includes(term))
        );
    }, [files, searchTerm]);

    return (
        <>
            {/*
                The rail. It is the *collapsed* form of the explorer, not a permanent spine
                beside it — from `lg` up it collapses to nothing as the panel opens, so you
                only ever see one of the two.

                It animates its width rather than just switching to `display: none`, so the
                48px it occupies hands over to the panel in one continuous movement instead of
                the canvas jumping left and then being pushed back right.

                Below `lg` it stays at full width and keeps its place in the layout: the panel
                only overlays the canvas there, so removing the rail from flow would shunt the
                canvas sideways every time the drawer opened. The drawer covers it anyway.
            */}
            <div
                inert={isOpen}
                className={[
                    'shrink-0 bg-white overflow-hidden border-r border-line',
                    'transition-[width] duration-300 ease-[cubic-bezier(.22,.9,.31,1)]',
                    'motion-reduce:transition-none',
                    isOpen ? 'w-12 lg:w-0 lg:border-r-0' : 'w-12',
                ].join(' ')}
            >
                {/* Fixed width, so the icons hold their place while the rail clips. */}
                <div className="w-12 h-full flex flex-col items-center py-4 gap-4">
                    <button
                        onClick={onToggle}
                        className="p-2 text-ink-500 hover:text-brand-600 rounded-md hover:bg-ink-100 transition-colors"
                        aria-label="Expand the file explorer"
                        aria-expanded={isOpen}
                        title="Expand the file explorer"
                    >
                        <LayoutPanelLeft size={20} />
                    </button>
                    <button
                        onClick={onCreateFile}
                        className="p-2 text-ink-500 hover:text-brand-600 hover:bg-ink-100 rounded-md transition-colors"
                        aria-label="New SQL file"
                        title="New SQL file"
                    >
                        <Plus size={20} />
                    </button>
                    <div className="w-8 h-px bg-ink-200" />

                    <div className="flex flex-col gap-2 overflow-y-auto scroll-slim w-full items-center">
                        {files.map(f => (
                            <button
                                key={f.id}
                                onClick={() => onSelectFile(f.id)}
                                className={`p-2 rounded-md transition-colors ${
                                    activeFileId === f.id
                                        ? 'brand-gradient text-white'
                                        : 'text-ink-400 hover:text-ink-700 hover:bg-ink-100'
                                }`}
                                title={f.name}
                                aria-label={f.name}
                                aria-current={activeFileId === f.id}
                            >
                                <Database size={18} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/*
                The panel is always mounted and animates between states — it is never
                conditionally rendered.

                That distinction is the whole trick: React only transitions an element it
                reuses across renders. Returning a different tree for the collapsed state
                unmounts this one and mounts a new node, and a brand new node has no previous
                width to animate from, so the collapse happens in a single frame.

                Two different animations, because the panel plays two different roles:
                  · from `lg` up it is a column in the layout, so its *width* animates and the
                    canvas reflows alongside it;
                  · below `lg` it overlays the canvas, so it *slides* out of view at full width
                    instead — collapsing the width of an overlay would reflow its contents in
                    mid-air rather than move it out of the way.
            */}
            <aside
                aria-label="File explorer"
                // Nothing inside a collapsed panel should be reachable by Tab, and the panel is
                // still in the DOM, so the browser has to be told.
                inert={!isOpen}
                className={[
                    'absolute lg:relative inset-y-0 left-0 z-40 lg:z-auto shrink-0',
                    'border-r border-line bg-white flex flex-col h-full overflow-hidden',
                    'transition-[width,transform,box-shadow] duration-300 ease-[cubic-bezier(.22,.9,.31,1)]',
                    'motion-reduce:transition-none',
                    // Each state sets every width/transform/shadow exactly once per breakpoint,
                    // so nothing here depends on which rule Tailwind happens to emit last.
                    // `shadow-[var(--glow-md)]` rather than the `.shadow-glow-md` helper for the
                    // same reason: that one is plain CSS declared after the utilities layer, so
                    // `lg:shadow-none` could never override it.
                    isOpen
                        ? `${PANEL_W_BASE} ${PANEL_W_LG} translate-x-0 shadow-[var(--glow-md)] lg:shadow-none`
                        // `lg:border-r-0` because a collapsed panel is zero *content* width but
                        // its right border survives, leaving a 1px line doubled up against the
                        // rail's own border. Below lg the border stays: the drawer is only
                        // translated off-screen there, not collapsed.
                        : `${PANEL_W_BASE} lg:w-0 lg:border-r-0 -translate-x-full lg:translate-x-0 shadow-none`,
                ].join(' ')}
            >
                {/*
                    Fixed to the panel's open width, so the contents hold their layout while the
                    parent clips them. Without it the sidebar would re-flow its way down to zero
                    — search box shrinking, filenames re-wrapping — instead of sliding away.
                */}
                <div className={`${PANEL_W_BASE} ${PANEL_W_LG} h-full flex flex-col`}>
                    <div className="h-14 flex items-center justify-between px-3 sm:px-4 border-b border-line shrink-0">
                        <span className="font-semibold text-ink-800 flex items-center gap-2 text-sm">
                            <FileCode size={18} className="text-ink-500" /> Explorer
                        </span>
                        <div className="flex gap-1">
                            <button
                                onClick={onCreateFile}
                                className="p-1.5 text-ink-500 hover:text-brand-600 hover:bg-ink-100 rounded transition-colors"
                                aria-label="New blank file"
                                title="New blank file"
                            >
                                <Plus size={18} />
                            </button>
                            <button
                                onClick={onToggle}
                                className="p-1.5 text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors"
                                aria-label="Collapse the file explorer"
                                title="Collapse the file explorer"
                            >
                                <LayoutPanelLeft size={18} />
                            </button>
                        </div>
                    </div>

                    <div className="p-3 border-b border-line shrink-0">
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
                            <input
                                className="w-full bg-white border border-ink-300 rounded-md py-2 pl-8 pr-3 text-xs text-ink-800 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors placeholder:text-ink-400"
                                placeholder="Search files and tables..."
                                aria-label="Search files and tables"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 scroll-slim">
                        {filteredFiles.length === 0 && (
                            <p className="text-center text-ink-400 text-xs py-8">
                                {searchTerm ? 'No matches found' : 'No files open'}
                            </p>
                        )}

                        {filteredFiles.map(file => {
                            const isFileExpanded = expandedIds.has(file.id);
                            const isActive = activeFileId === file.id;

                            return (
                                <div key={file.id} className="mb-1">
                                    <div
                                        className={`flex items-center gap-1.5 px-2 py-2 lg:py-1.5 rounded-md cursor-pointer select-none transition-colors border ${
                                            isActive ? 'bg-brand-50 border-brand-200' : 'hover:bg-ink-100 border-transparent'
                                        }`}
                                        onClick={() => onSelectFile(file.id)}
                                    >
                                        <button
                                            onClick={(e) => toggleExpand(file.id, e)}
                                            className={`p-0.5 rounded ${
                                                isActive
                                                    ? 'text-brand-500 hover:text-brand-700 hover:bg-brand-100'
                                                    : 'text-ink-400 hover:text-ink-700 hover:bg-ink-200'
                                            }`}
                                            aria-label={isFileExpanded ? `Collapse ${file.name}` : `Expand ${file.name}`}
                                            aria-expanded={isFileExpanded}
                                        >
                                            {isFileExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                        </button>
                                        <Database size={14} className={isActive ? 'text-brand-600' : 'text-ink-400'} />
                                        <span
                                            className={`text-xs font-medium truncate flex-1 ${isActive ? 'text-brand-700' : 'text-ink-700'}`}
                                            title={file.name}
                                        >
                                            {file.name}
                                        </span>
                                    </div>

                                    {isFileExpanded && (
                                        <div className="ml-3 pl-2 border-l border-ink-200 mt-1 space-y-0.5">
                                            {file.tables.length === 0 && (
                                                <p className="text-[11px] text-ink-400 italic px-2 py-1">No tables yet</p>
                                            )}
                                            {file.tables.map(table => {
                                                const tableId = `${file.id}-${table.name}`;
                                                const isTableExpanded = expandedIds.has(tableId);

                                                return (
                                                    <div key={tableId}>
                                                        <div
                                                            className="flex items-center gap-1.5 px-2 py-1.5 lg:py-1 rounded-md hover:bg-ink-100 cursor-pointer group transition-colors"
                                                            onClick={(e) => toggleExpand(tableId, e)}
                                                        >
                                                            <span className="text-ink-400 group-hover:text-ink-600">
                                                                {isTableExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                            </span>
                                                            <Table size={12} className="text-ink-400" />
                                                            <span className="text-xs text-ink-500 group-hover:text-ink-800 truncate flex-1" title={table.name}>
                                                                {table.name}
                                                            </span>
                                                            <span className="text-[9px] text-ink-500 bg-ink-100 px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center shrink-0">
                                                                {table.columns.length}
                                                            </span>
                                                        </div>

                                                        {isTableExpanded && (
                                                            <div className="ml-5 mt-0.5 space-y-0.5 mb-2">
                                                                {table.columns.map(col => (
                                                                    <div
                                                                        key={col.name}
                                                                        className="flex items-center gap-2 px-2 py-0.5 hover:bg-ink-100 rounded text-[10px] text-ink-400 hover:text-ink-700 select-none group/col"
                                                                    >
                                                                        {col.isPk
                                                                            ? <KeyRound size={10} className="text-brand-500 shrink-0" />
                                                                            : <Columns size={10} className="opacity-40 group-hover/col:opacity-70 shrink-0" />}
                                                                        <span className={`truncate flex-1 font-mono ${col.isPk ? 'text-brand-600 font-semibold' : ''}`}>
                                                                            {col.name}
                                                                        </span>
                                                                        <span className="text-[9px] font-mono text-ink-400 opacity-70 shrink-0">{col.type}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </aside>
        </>
    );
};
