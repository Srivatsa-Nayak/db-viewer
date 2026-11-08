"use client";

import React, { memo, useMemo, useState } from 'react';
import { Check, Copy, PlayCircle } from 'lucide-react';

/**
 * Renders one assistant answer: prose, plus any SQL it wrote as a runnable block.
 *
 * <h2>Why there is no markdown library</h2>
 *
 * Models answer in markdown whether or not you ask them to, so something has to render it. The
 * project has seven runtime dependencies and the smallest credible markdown-plus-sanitiser pair
 * is larger than React Flow; what it would buy is tables, images, links and nested lists, none of
 * which an answer about a schema needs. What an answer *does* need is the fenced `sql` block, and
 * that is the part a general renderer handles worst — it produces a `<pre>`, when what the user
 * wants is a button that puts the statements in the scratchpad.
 *
 * So this handles five constructs — fenced code, headings, bullets, `**bold**` and `` `code` `` —
 * and renders everything else as plain text. An unrecognised construct appears as the characters
 * the model typed, which is legible; it is never executed and never injected as HTML.
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
                    className="font-mono text-[11px] px-1 py-0.5 rounded bg-surface-tint text-ink-800"
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

/** Headings, bullets, numbered items and paragraphs. */
const Prose = memo(function Prose({ text, idPrefix }: { text: string; idPrefix: string }) {
    const lines = text.split('\n');
    const out: React.ReactNode[] = [];
    let bullets: string[] = [];

    const flushBullets = (at: number) => {
        if (bullets.length === 0) return;
        out.push(
            <ul key={`${idPrefix}-ul${at}`} className="list-disc pl-4 space-y-0.5 my-1">
                {bullets.map((item, i) => (
                    <li key={i}>{inline(item, `${idPrefix}-ul${at}-${i}`)}</li>
                ))}
            </ul>,
        );
        bullets = [];
    };

    lines.forEach((raw, index) => {
        const line = raw.trimEnd();
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        const heading = /^#{1,4}\s+(.*)$/.exec(line);

        if (bullet || numbered) {
            bullets.push((bullet ?? numbered)![1]);
            return;
        }
        flushBullets(index);

        if (line.trim() === '') return;
        if (heading) {
            out.push(
                <p key={`${idPrefix}-h${index}`} className="font-semibold text-ink-900 mt-2">
                    {inline(heading[1], `${idPrefix}-h${index}`)}
                </p>,
            );
            return;
        }
        out.push(
            <p key={`${idPrefix}-p${index}`} className="my-1">
                {inline(line, `${idPrefix}-p${index}`)}
            </p>,
        );
    });
    flushBullets(lines.length);

    return <>{out}</>;
});

interface CodeBlockProps {
    code: string;
    language: string;
    /** True while the closing fence has not arrived yet. */
    open: boolean;
    onSendToScratchpad?: (sql: string) => void;
}

const CodeBlock = ({ code, language, open, onSendToScratchpad }: CodeBlockProps) => {
    const [copied, setCopied] = useState(false);
    const isSql = language === 'sql' || language === '';

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
                <span className="text-[10px] font-mono uppercase tracking-wide text-ink-400">
                    {language || 'sql'}
                </span>
                {/* Withheld while the block is still being written: half a CREATE TABLE is not
                    something anyone should be invited to run. */}
                {!open && (
                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            onClick={copy}
                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold
                                       text-ink-500 hover:text-ink-900 hover:bg-surface-tint transition-colors"
                        >
                            {copied ? <Check size={10} /> : <Copy size={10} />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                        {isSql && onSendToScratchpad && (
                            <button
                                type="button"
                                onClick={() => onSendToScratchpad(code)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold
                                           text-brand-700 hover:bg-brand-50 transition-colors"
                            >
                                <PlayCircle size={10} />
                                Open in scratchpad
                            </button>
                        )}
                    </div>
                )}
            </div>
            <pre className="px-2 py-1.5 overflow-x-auto scroll-slim text-[11px] leading-relaxed font-mono text-ink-800">
                {code}
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
        <div className="text-xs leading-relaxed text-ink-700">
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
