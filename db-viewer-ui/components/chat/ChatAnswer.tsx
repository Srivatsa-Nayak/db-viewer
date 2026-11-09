"use client";

import React, { memo, useMemo, useState } from 'react';
import { Check, Copy, PlayCircle } from 'lucide-react';
import { highlightSql } from '@/components/editor/sqlHighlight';

/**
 * Renders one assistant answer: prose, plus any SQL it wrote as a runnable block.
 *
 * <h2>Why there is no markdown library</h2>
 *
 * Models answer in markdown whether or not you ask them to, so something has to render it. The
 * project has seven runtime dependencies and the smallest credible markdown-plus-sanitiser pair
 * is larger than React Flow; what it would buy is images, links and nested lists, none of which
 * an answer about a schema needs. What an answer *does* need is the fenced `sql` block, and that
 * is the part a general renderer handles worst — it produces a `<pre>`, when what the user wants
 * is a button that puts the statements in the scratchpad.
 *
 * So this handles the constructs schema answers actually use — fenced code, headings, bullet and
 * numbered lists, pipe tables, `**bold**` and `` `code` `` — and renders everything else as plain
 * text. An unrecognised construct appears as the characters the model typed, which is legible; it
 * is never executed and never injected as HTML.
 */

type Block =
    | { kind: 'code'; language: string; code: string; open: boolean }
    | { kind: 'text'; text: string };

/**
 * Splits an answer into prose and fenced code.
 *
 * Handles the unterminated fence deliberately: while an answer is still streaming, the opening
 * ``` has arrived and the closing one has not, and rendering the half-written statement as prose
 * would make the block appear to jump formats the moment it finished. `open` marks that state so
 * the block can render as code and withhold its buttons until there is something whole to run.
 */
export const parseBlocks = (text: string): Block[] => {
    const blocks: Block[] = [];
    const fence = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)(```|$)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = fence.exec(text)) !== null) {
        if (match.index > cursor) {
            blocks.push({ kind: 'text', text: text.slice(cursor, match.index) });
        }
        blocks.push({
            kind: 'code',
            language: (match[1] || 'sql').toLowerCase(),
            code: match[2].replace(/\n$/, ''),
            open: match[3] !== '```',
        });
        cursor = fence.lastIndex;
        // A zero-length match at the very end would otherwise loop for ever.
        if (match[0].length === 0) fence.lastIndex++;
    }
    if (cursor < text.length) {
        blocks.push({ kind: 'text', text: text.slice(cursor) });
    }
    return blocks;
};

/** `**bold**` and `` `code` ``, as React nodes. Everything else is left as characters. */
const inline = (text: string, keyPrefix: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) parts.push(text.slice(cursor, match.index));
        const token = match[0];
        if (token.startsWith('**')) {
            parts.push(
                <strong key={`${keyPrefix}-b${match.index}`} className="font-semibold text-ink-900">
                    {token.slice(2, -2)}
                </strong>,
            );
        } else {
            parts.push(
                <code
                    key={`${keyPrefix}-c${match.index}`}
                    className="font-mono text-[12px] px-1 py-0.5 rounded bg-surface-tint text-ink-800"
                >
                    {token.slice(1, -1)}
                </code>,
            );
        }
        cursor = pattern.lastIndex;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
};

/** A markdown table row: `| a | b |`. The outer pipes are optional, as models write both. */
const splitRow = (line: string): string[] =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Headings, bullet and numbered lists, tables and paragraphs. */
export const Prose = memo(function Prose({ text, idPrefix }: { text: string; idPrefix: string }) {
    const lines = text.split('\n');
    const out: React.ReactNode[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;

    const flushList = (at: number) => {
        if (!list) return;
        const items = list.items.map((item, i) => (
            <li key={i}>{inline(item, `${idPrefix}-l${at}-${i}`)}</li>
        ));
        out.push(list.ordered
            ? <ol key={`${idPrefix}-ol${at}`} className="list-decimal pl-5 space-y-1 my-1.5">{items}</ol>
            : <ul key={`${idPrefix}-ul${at}`} className="list-disc pl-5 space-y-1 my-1.5">{items}</ul>);
        list = null;
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trimEnd();

        // A table is a header row, a divider, and body rows. Anything less is left as text,
        // which is what a lone line with a pipe in it usually is.
        if (isTableRow(line) && index + 1 < lines.length && isDivider(lines[index + 1])) {
            flushList(index);
            const header = splitRow(line);
            const rows: string[][] = [];
            let next = index + 2;
            while (next < lines.length && isTableRow(lines[next])) {
                rows.push(splitRow(lines[next]));
                next++;
            }
            out.push(
                <div key={`${idPrefix}-t${index}`} className="my-2 overflow-x-auto scroll-slim">
                    <table className="w-full border-collapse text-[12px]">
                        <thead>
                            <tr>
                                {header.map((cell, c) => (
                                    <th key={c} className="text-left font-semibold text-ink-800 border-b border-line px-2 py-1">
                                        {inline(cell, `${idPrefix}-t${index}-h${c}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, r) => (
                                <tr key={r} className="border-b border-line/60">
                                    {row.map((cell, c) => (
                                        <td key={c} className="align-top px-2 py-1">
                                            {inline(cell, `${idPrefix}-t${index}-${r}-${c}`)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>,
            );
            index = next - 1;
            continue;
        }

        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (bullet || numbered) {
            const ordered = !!numbered && !bullet;
            if (list && list.ordered !== ordered) flushList(index);
            if (!list) list = { ordered, items: [] };
            list.items.push((bullet ?? numbered)![1]);
            continue;
        }
        flushList(index);

        if (line.trim() === '') continue;
        const heading = /^#{1,4}\s+(.*)$/.exec(line);
        if (heading) {
            out.push(
                <p key={`${idPrefix}-h${index}`} className="font-semibold text-ink-900 mt-2.5 mb-1">
                    {inline(heading[1], `${idPrefix}-h${index}`)}
                </p>,
            );
            continue;
        }
        out.push(
            <p key={`${idPrefix}-p${index}`} className="my-1.5">
                {inline(line, `${idPrefix}-p${index}`)}
            </p>,
        );
    }
    flushList(lines.length);

    return <>{out}</>;
});

interface CodeBlockProps {
    code: string;
    language: string;
    /** True while the closing fence has not arrived yet. */
    open: boolean;
    onSendToScratchpad?: (sql: string) => void;
}

const ACTION_BUTTON = 'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold transition-colors';

const CodeBlock = ({ code, language, open, onSendToScratchpad }: CodeBlockProps) => {
    const [copied, setCopied] = useState(false);
    const isSql = language === 'sql' || language === '';
    const highlighted = useMemo(() => (isSql ? highlightSql(code) : code), [code, isSql]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            // Matches ExportModal's "Copied" label: a timeout rather than an effect, because the
            // lint config treats setting state from an effect as an error.
            setTimeout(() => setCopied(false), 1800);
        } catch {
            // Clipboard denied. The text is selectable, which is the fallback.
        }
    };

    return (
        <div className="my-2 rounded-md border border-line overflow-hidden bg-surface-tint">
            <div className="flex items-center gap-1 px-2 py-1 border-b border-line bg-surface">
                <span className="text-[11px] font-mono uppercase tracking-wide text-ink-400">
                    {language || 'sql'}
                </span>
                {/* Withheld while the block is still being written: half a CREATE TABLE is not
                    something anyone should be invited to run. */}
                {!open && (
                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            onClick={copy}
                            className={`${ACTION_BUTTON} text-ink-500 hover:text-ink-900 hover:bg-surface-tint`}
                        >
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                        {isSql && onSendToScratchpad && (
                            <button
                                type="button"
                                onClick={() => onSendToScratchpad(code)}
                                className={`${ACTION_BUTTON} text-brand-700 hover:bg-brand-50`}
                            >
                                <PlayCircle size={12} />
                                Open in scratchpad
                            </button>
                        )}
                    </div>
                )}
            </div>
            <pre className="px-2.5 py-2 overflow-x-auto scroll-slim text-[12px] leading-relaxed font-mono text-ink-800">
                {highlighted}
            </pre>
        </div>
    );
};

interface ChatAnswerProps {
    text: string;
    /** Absent for a user's own message, which has no SQL to run. */
    onSendToScratchpad?: (sql: string) => void;
    idPrefix: string;
}

/**
 * Memoized, and that is not premature. A streaming answer re-renders its parent on every token,
 * and without this every earlier message in the conversation would be re-parsed each time.
 */
export const ChatAnswer = memo(function ChatAnswer(
    { text, onSendToScratchpad, idPrefix }: ChatAnswerProps,
) {
    const blocks = useMemo(() => parseBlocks(text), [text]);

    return (
        <div className="text-[13px] leading-relaxed text-ink-700">
            {blocks.map((block, index) =>
                block.kind === 'code' ? (
                    <CodeBlock
                        key={`${idPrefix}-code${index}`}
                        code={block.code}
                        language={block.language}
                        open={block.open}
                        onSendToScratchpad={onSendToScratchpad}
                    />
                ) : (
                    <Prose key={`${idPrefix}-text${index}`} text={block.text} idPrefix={`${idPrefix}-${index}`} />
                ),
            )}
        </div>
    );
});
