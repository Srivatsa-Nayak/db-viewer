"use client";

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Play, ChevronDown, ChevronUp, Loader2, AlertCircle, Lock, Terminal } from 'lucide-react';
import { dbService } from '@/services/api';
import { ScratchpadResult, StatementResult } from '@/types';

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

/** Only what a scratchpad needs: enough to see structure at a glance. */
const KEYWORDS = new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE',
    'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'JOIN', 'LEFT', 'RIGHT', 'INNER',
    'OUTER', 'ON', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'ORDER', 'BY', 'GROUP',
    'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'PRIMARY',
    'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT', 'CHECK', 'CASCADE', 'INTEGER', 'TEXT',
    'VARCHAR', 'BOOLEAN', 'DATE', 'DATETIME', 'REAL', 'BLOB', 'IF', 'EXISTS', 'PRAGMA', 'WITH',
    'UNION', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'REPLACE',
]);

/**
 * Splits SQL into spans.
 *
 * Order matters: comments and strings are consumed whole, before anything inside them can be
 * mistaken for a keyword. `SELECT` inside `'a SELECT string'` must not light up.
 */
const TOKEN = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

const highlight = (sql: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let last = 0;
    let key = 0;

    for (const match of sql.matchAll(TOKEN)) {
        const [text, comment, string, num, word] = match;
        const at = match.index ?? 0;
        if (at > last) out.push(sql.slice(last, at));

        if (comment) out.push(<span key={key++} className="text-ink-400 italic">{text}</span>);
        else if (string) out.push(<span key={key++} className="text-emerald-600">{text}</span>);
        else if (num) out.push(<span key={key++} className="text-amber-600">{text}</span>);
        else if (word && KEYWORDS.has(word.toUpperCase())) {
            out.push(<span key={key++} className="text-brand-600 font-semibold">{text}</span>);
        } else out.push(text);

        last = at + text.length;
    }
    out.push(sql.slice(last));
    return out;
};

const PLACEHOLDER = `-- Ctrl+Enter to run. Several statements are fine.
SELECT * FROM your_table LIMIT 10;`;

interface SqlScratchpadProps {
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
    isOpen, onToggle, tableNames, hasAccount, onNeedsAccount, onSchemaChanged,
}: SqlScratchpadProps) => {
    const [sql, setSql] = useState('');
    const [isRunning, setRunning] = useState(false);
    const [result, setResult] = useState<ScratchpadResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const mirrorRef = useRef<HTMLPreElement>(null);

    const highlighted = useMemo(() => highlight(sql), [sql]);

    const run = useCallback(async () => {
        if (!hasAccount) return onNeedsAccount();
        if (!sql.trim() || isRunning) return;

        setRunning(true);
        setError(null);
        try {
            const next = await dbService.runScratchpad(sql);
            setResult(next);
            // Only when something could have changed it: re-reading the whole schema after a
            // SELECT would make the canvas jump for no reason.
            if (next.schemaChanged) onSchemaChanged();
        } catch (e: unknown) {
            const message = e && typeof e === 'object' && 'response' in e
                ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || 'That could not be run.');
            setResult(null);
        } finally {
            setRunning(false);
        }
    }, [sql, isRunning, hasAccount, onNeedsAccount, onSchemaChanged]);

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
