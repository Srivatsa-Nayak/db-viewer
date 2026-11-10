"use client";

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Play, ChevronDown, ChevronUp, Loader2, AlertCircle, Lock, Terminal, History, Check, X } from 'lucide-react';
import { dbService } from '@/services/api';
import { ScratchpadResult, StatementResult } from '@/types';
import { highlightSql } from './sqlHighlight';
import { errorMessage } from '@/services/errors';
import { describeWhen, loadHistory, recordRun, type HistoryEntry } from '@/services/queryHistory';
import { useDismissable } from '@/components/ui/useDismissable';

/**
 * A bottom drawer for running SQL against the open file.
 *
 * Mounted as a **sibling of the canvas**, never inside it. The previous version of this panel
 * lived inside the visualiser, which meant the canvas component owned a concern that had nothing
 * to do with drawing a diagram — and put a scrolling text editor inside a transformed, zoomable
 * viewport.
 *
 * The editor is a `<textarea>` over a highlighted `<pre>`, sharing one scroll container. That is
 * about 40 lines and no dependency; Monaco is over a megabyte and would be the largest thing in a
 * seven-dependency project, for a panel most people open occasionally. What it gives up is
 * IntelliSense-grade completion — the table chips above the editor cover the case that actually
 * comes up, which is not remembering exactly how a table was spelled.
 */

/** Shared with the assistant's code blocks, so both colour SQL the same way. */
const highlight = highlightSql;

const PLACEHOLDER = `-- Ctrl+Enter to run. Several statements are fine.
SELECT * FROM your_table LIMIT 10;`;

interface SqlScratchpadProps {
    /**
     * Text to start the editor with — how the chat assistant hands SQL over.
     *
     * Read once, at mount. The caller remounts with a new `key` to send a second snippet, which
     * is deliberate on both sides: it keeps this component's editor state local, and it makes
     * "replace what is in the editor" the explicit behaviour rather than an append nobody asked
     * for. The result pane goes with it, correctly — those results belonged to the old script.
     */
    initialSql?: string;
    /** The open file, whose history the panel shows. */
    workspaceId: string;
    isOpen: boolean;
    onToggle: () => void;
    /** Table names, offered as chips so nobody has to remember an exact spelling. */
    tableNames: string[];
    hasAccount: boolean;
    onNeedsAccount: () => void;
    /** Called after anything that may have changed the schema. */
    onSchemaChanged: () => void;
}

export const SqlScratchpad = ({
    initialSql, workspaceId, isOpen, onToggle, tableNames, hasAccount, onNeedsAccount, onSchemaChanged,
}: SqlScratchpadProps) => {
    const [sql, setSql] = useState(initialSql ?? '');
    const [isRunning, setRunning] = useState(false);
    const [result, setResult] = useState<ScratchpadResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const mirrorRef = useRef<HTMLPreElement>(null);

    const highlighted = useMemo(() => highlight(sql), [sql]);

    /**
     * What was run against this file. Read once at mount - the page remounts the panel per file
     * (`key`), so mounting is the switch - and kept in step by `run` after that.
     */
    const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory(workspaceId));
    const [isHistoryOpen, setHistoryOpen] = useState(false);
    const historyRef = useDismissable(isHistoryOpen, () => setHistoryOpen(false));

    const run = useCallback(async () => {
        if (!hasAccount) return onNeedsAccount();
        if (!sql.trim() || isRunning) return;

        setRunning(true);
        setError(null);
        try {
            const next = await dbService.runScratchpad(sql);
            setResult(next);
            setHistory(recordRun(workspaceId, sql, !next.failed));
            // Only when something could have changed it: re-reading the whole schema after a
            // SELECT would make the canvas jump for no reason.
            if (next.schemaChanged) onSchemaChanged();
        } catch (e: unknown) {
            const message = errorMessage(e);
            setError(message || 'That could not be run.');
            setResult(null);
            // A script the server refused outright (too many statements, an internal table) is
            // still worth getting back to, to fix.
            setHistory(recordRun(workspaceId, sql, false));
        } finally {
            setRunning(false);
        }
    }, [sql, isRunning, hasAccount, onNeedsAccount, onSchemaChanged, workspaceId]);

    /** Inserts a table name where the cursor is, rather than at the end. */
    const insert = (text: string) => {
        const field = editorRef.current;
        if (!field) return;
        const start = field.selectionStart ?? sql.length;
        const end = field.selectionEnd ?? start;
        setSql(sql.slice(0, start) + text + sql.slice(end));
        requestAnimationFrame(() => {
            field.focus();
            field.setSelectionRange(start + text.length, start + text.length);
        });
    };

    return (
        <div className={`flex flex-col border-t border-line bg-surface transition-[height] duration-200 ${
            isOpen ? 'h-[19rem]' : 'h-10'
        }`}>
            <div className="flex h-10 shrink-0 items-center gap-2 px-3">
                <button
                    type="button"
                    onClick={onToggle}
                    className="flex items-center gap-2 text-xs font-semibold text-ink-600 transition-colors hover:text-ink-900"
                    aria-expanded={isOpen}
                >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <Terminal size={14} className="text-ink-400" />
                    SQL
                </button>

                {isOpen && (
                    <>
                        <div className="mx-1 h-4 w-px bg-ink-200" />
                        {/* Chips rather than a completion popup: the thing people actually need is
                            the exact spelling of a table, and a list they can see beats one they
                            have to summon. */}
                        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-slim">
                            {tableNames.map(name => (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => insert(name)}
                                    className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px]
                                               text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                                    title={`Insert "${name}"`}
                                >
                                    {name}
                                </button>
                            ))}
                        </div>

                        <div className="relative shrink-0" ref={historyRef}>
                            <button
                                type="button"
                                onClick={() => setHistoryOpen(v => !v)}
                                disabled={history.length === 0}
                                aria-haspopup="menu"
                                aria-expanded={isHistoryOpen}
                                className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold transition-colors
                                            disabled:opacity-40 ${isHistoryOpen ? 'bg-ink-100 text-ink-900' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'}`}
                                title={history.length === 0 ? 'Nothing run against this file yet' : 'Scripts run against this file'}
                            >
                                <History size={13} />
                                <span className="max-sm:hidden">History</span>
                            </button>
                            {isHistoryOpen && (
                                <div
                                    role="menu"
                                    aria-label="Query history"
                                    className="anim-menu-in absolute bottom-full right-0 z-40 mb-2 max-h-72 w-[min(26rem,calc(100vw-2rem))]
                                               overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-glow-lg scroll-slim"
                                >
                                    <p className="px-3 pb-1 pt-1.5 text-[10px] text-ink-400">
                                        Kept in this browser only, for this file. Click one to load it.
                                    </p>
                                    {history.map(entry => (
                                        <button
                                            key={`${entry.at}-${entry.sql.slice(0, 20)}`}
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                setSql(entry.sql);
                                                setHistoryOpen(false);
                                                requestAnimationFrame(() => editorRef.current?.focus());
                                            }}
                                            className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-ink-50"
                                        >
                                            <span className={`mt-0.5 shrink-0 ${entry.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {entry.ok ? <Check size={12} /> : <X size={12} />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <code className="block truncate font-mono text-[11px] text-ink-800">
                                                    {entry.sql.replace(/\s+/g, ' ')}
                                                </code>
                                                <span className="text-[10px] text-ink-400">
                                                    {describeWhen(entry.at)}{entry.ok ? '' : ' · failed'}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={run}
                            disabled={isRunning || !sql.trim()}
                            className="flex shrink-0 items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-xs
                                       font-semibold text-white transition-colors hover:bg-brand-700
                                       disabled:opacity-40"
                            title="Run  (Ctrl+Enter)"
                        >
                            {isRunning
                                ? <Loader2 size={13} className="animate-spin" />
                                : hasAccount ? <Play size={13} /> : <Lock size={13} />}
                            {hasAccount ? 'Run' : 'Sign in to run'}
                        </button>
                    </>
                )}
            </div>

            {isOpen && (
                <div className="grid min-h-0 flex-1 grid-rows-2 gap-px bg-line sm:grid-cols-2 sm:grid-rows-1">
                    {/* The editor: a transparent textarea over a highlighted mirror. Both use the
                        same font metrics and padding, so the caret lands where the glyph is. */}
                    <div className="relative min-h-0 overflow-hidden bg-surface">
                        <pre
                            ref={mirrorRef}
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap
                                       break-words p-3 font-mono text-xs leading-5 text-ink-800"
                        >
                            {highlighted}
                            {'\n'}
                        </pre>
                        <textarea
                            ref={editorRef}
                            value={sql}
                            onChange={e => setSql(e.target.value)}
                            onScroll={e => {
                                // The mirror has to follow, or the colours drift off the text.
                                if (mirrorRef.current) {
                                    mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
                                    mirrorRef.current.scrollLeft = e.currentTarget.scrollLeft;
                                }
                            }}
                            onKeyDown={e => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    void run();
                                }
                            }}
                            spellCheck={false}
                            placeholder={PLACEHOLDER}
                            aria-label="SQL"
                            className="absolute inset-0 resize-none overflow-auto whitespace-pre-wrap break-words
                                       bg-transparent p-3 font-mono text-xs leading-5 text-transparent
                                       caret-ink-900 outline-none placeholder:text-ink-400 scroll-slim"
                        />
                    </div>

                    <div className="min-h-0 overflow-auto bg-surface scroll-slim">
                        {error && (
                            <div className="tone-error m-3 flex items-start gap-2 rounded-md p-3 text-xs">
                                <AlertCircle size={14} className="mt-px shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}
                        {!error && !result && (
                            <p className="p-3 text-xs text-ink-400">
                                Results appear here. Statements run in order and stop at the first error.
                            </p>
                        )}
                        {result?.statements.map((statement, i) => (
                            <StatementOutcome key={i} statement={statement} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

/** One statement's result: a grid for a SELECT, a line for everything else. */
const StatementOutcome = ({ statement }: { statement: StatementResult }) => {
    const rows = statement.rows ?? [];
    const columns = statement.columns ?? [];

    return (
        <div className="border-b border-line last:border-0">
            <div className="flex items-center gap-2 px-3 py-1.5">
                <span className={`shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase ${
                    statement.error ? 'tone-error'
                        : statement.kind === 'skipped' ? 'bg-ink-100 text-ink-500'
                            : 'bg-ink-100 text-ink-600'
                }`}>
                    {statement.kind}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-500">
                    {statement.sql}
                </code>
                {statement.rowCount !== undefined && !statement.error && (
                    <span className="shrink-0 text-[10px] text-ink-400">
                        {statement.rowCount} row{statement.rowCount === 1 ? '' : 's'}
                        {statement.truncated && ' (capped)'}
                    </span>
                )}
            </div>

            {statement.error && (
                <p className="px-3 pb-2 text-[11px] text-red-600">{statement.error}</p>
            )}

            {columns.length > 0 && (
                <div className="overflow-x-auto px-3 pb-2 scroll-slim">
                    <table className="w-full text-left font-mono text-[10px]">
                        <thead>
                            <tr className="text-ink-500">
                                {columns.map(c => <th key={c} className="py-1 pr-3 font-semibold">{c}</th>)}
                            </tr>
                        </thead>
                        <tbody className="text-ink-700">
                            {rows.map((row, i) => (
                                <tr key={i} className="border-t border-line">
                                    {columns.map(c => (
                                        <td key={c} className="py-1 pr-3">
                                            {row[c] === null || row[c] === undefined
                                                ? <span className="text-ink-300">null</span>
                                                : String(row[c])}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
