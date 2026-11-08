"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Lightbulb, Loader2, Sparkles, Square, Trash2 } from 'lucide-react';
import { ChatTurnPayload, chatService } from '@/services/api';
import { chatStore } from '@/services/chatStore';
import { ChatAnswer } from './ChatAnswer';

/**
 * The message list, the examples and the composer.
 *
 * <p><b>One conversation per file.</b> Mounted with a `key` of the active workspace id, so
 * switching files swaps the whole component out — but what it mounts *from* is
 * {@link chatStore}, which holds a conversation per workspace for as long as the app is open.
 * Switching away parks the talk; switching back restores it.
 *
 * <p>This used to be a plain reset, and that was a bug rather than a trade-off. The reasoning
 * behind it still holds — the schema block is rebuilt server-side every turn, so the *facts* are
 * always about the open file, but the history is not, and carrying "the orders table you
 * mentioned" into a different file would have the model answer confidently about a table that is
 * not there. Keeping conversations apart is the fix for that. Destroying one was not: it solved a
 * correctness problem by throwing away something the user could not get back.
 *
 * <p>Live turns stay in local state and are *mirrored* to the store, rather than being read from
 * it on every render. A streaming answer changes on every token, and the store is a plain module
 * map with no subscription — which is the point: nothing else needs to re-render while an answer
 * is being written.
 */

interface Turn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** Set when the answer failed; rendered beneath whatever text did arrive. */
    error?: string;
    /**
     * A caveat that is not a failure: the answer was cut off at the length limit. Unlike
     * `error`, the turn stays in the history sent back, so "continue" has something to continue.
     */
    notice?: string;
}

interface ExampleGroup {
    title: string;
    prompts: string[];
}

/**
 * The openers, written around the schema that is actually open.
 *
 * <p>Generic examples are the weakest part of every assistant: "ask me anything" teaches nothing,
 * and a sample question about a `posts` table you do not have reads as a different product. Naming
 * the user's own tables does two jobs at once — it shows what a good question looks like, and it
 * demonstrates that the assistant can already see the file, which is the thing people do not
 * believe until they watch it happen.
 *
 * <p>An empty file gets a different set entirely. "Summarise this schema" is not a useful first
 * move when there is nothing to summarise, so the prompts become ways to start one.
 */
const examplesFor = (tables: string[]): ExampleGroup[] => {
    if (tables.length === 0) {
        return [
            {
                title: 'Start a schema',
                prompts: [
                    'Design a schema for a blog with authors, posts and tags',
                    'I need to track orders, customers and products',
                    'Model a school timetable: students, courses, rooms',
                ],
            },
            {
                title: 'About the app',
                prompts: [
                    'What can this app do?',
                    'How do I import an existing .sql file?',
                ],
            },
        ];
    }

    const first = tables[0];
    const second = tables[1] ?? first;

    return [
        {
            title: 'Understand it',
            prompts: [
                'Summarise this schema',
                `What is ${first} for, and what depends on it?`,
                `How are ${first} and ${second} related?`,
            ],
        },
        {
            title: 'Improve it',
            prompts: [
                'What would you change about this design?',
                'Which columns should be indexed?',
                'Is anything here not properly normalised?',
            ],
        },
        {
            title: 'Build on it',
            prompts: [
                `Add a created_at and updated_at to ${first}`,
                'Write the SQL for a tags table with a join table',
                `What columns is ${first} missing?`,
            ],
        },
        {
            title: 'About the app',
            prompts: [
                'How do I share this diagram with someone?',
                'What formats can I export to?',
            ],
        },
    ];
};

interface ExamplesProps {
    groups: ExampleGroup[];
    onPick: (prompt: string) => void;
}

/** Module scope, not nested: the lint config rejects a component declared inside another. */
const Examples = ({ groups, onPick }: ExamplesProps) => (
    <div className="space-y-4">
        {groups.map(group => (
            <div key={group.title}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400 mb-1.5">
                    {group.title}
                </p>
                <div className="flex flex-col gap-1">
                    {group.prompts.map(prompt => (
                        <button
                            key={prompt}
                            type="button"
                            onClick={() => onPick(prompt)}
                            className="group text-left w-full rounded-md border border-line bg-surface
                                       px-2.5 py-1.5 text-xs leading-snug text-ink-600
                                       hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-800
                                       transition-colors"
                        >
                            {prompt}
                        </button>
                    ))}
                </div>
            </div>
        ))}
    </div>
);

interface ChatConversationProps {
    /** Which file this conversation belongs to. Also the component's `key`, set by the caller. */
    workspaceId: string;
    /** Tables in the open file. Drives the examples, and what the empty state can honestly say. */
    tableNames: string[];
    onSendToScratchpad: (sql: string) => void;
}

export const ChatConversation = ({
    workspaceId, tableNames, onSendToScratchpad,
}: ChatConversationProps) => {
    // Lazy initialisers: the store is read once, at mount, which is exactly when this component
    // is remounted for a different file.
    const [turns, setTurns] = useState<Turn[]>(() => chatStore.load(workspaceId).turns);
    const [draft, setDraft] = useState('');
    const [isStreaming, setStreaming] = useState(false);
    const [answeredBy, setAnsweredBy] = useState<{ model: string; usingOwnKey: boolean } | null>(
        () => {
            const saved = chatStore.load(workspaceId);
            return saved.model ? { model: saved.model, usingOwnKey: saved.usingOwnKey } : null;
        });
    /** Examples stay reachable after the first question, but out of the way. */
    const [showExamples, setShowExamples] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);

    const examples = useMemo(() => examplesFor(tableNames), [tableNames]);

    // Keeps the newest text in view as it streams. An effect that only reads and writes the DOM,
    // which is allowed; it is setting React state from an effect that the config rejects.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [turns]);

    // Mirrored to the store on every change, so the latest state is already there whenever this
    // component goes away — no save-on-unmount race to get right.
    useEffect(() => {
        chatStore.save(workspaceId, {
            turns,
            model: answeredBy?.model ?? null,
            usingOwnKey: answeredBy?.usingOwnKey ?? false,
        });
    }, [workspaceId, turns, answeredBy]);

    /**
     * Unmounting stops the request — leaving one running against a paid API for a file the user
     * has left is nobody's intent — and records that it was stopped.
     *
     * Without the second half, a switch made mid-answer would store an assistant turn with no
     * text, and coming back to the file would show "Reading the schema…" spinning for ever
     * against a request that no longer exists. The store is patched directly rather than through
     * `setTurns`, because by this point there is nothing left to render.
     */
    useEffect(() => () => {
        if (!abortRef.current) return;
        abortRef.current.abort();
        abortRef.current = null;

        const saved = chatStore.load(workspaceId);
        const last = saved.turns[saved.turns.length - 1];
        if (!last || last.role !== 'assistant' || last.error) return;
        chatStore.save(workspaceId, {
            ...saved,
            turns: [
                ...saved.turns.slice(0, -1),
                {
                    ...last,
                    error: last.content.trim() === ''
                        ? 'Stopped when you switched files — ask again to retry.'
                        : 'Cut short when you switched files.',
                },
            ],
        });
    }, [workspaceId]);

    const ask = useCallback(async (question: string) => {
        const text = question.trim();
        if (!text || isStreaming) return;

        // Captured before the new turns are appended, and errored turns are left out: replaying
        // "the assistant is unavailable" back to the model as its own words would be a lie about
        // what it said.
        const history: ChatTurnPayload[] = turns
            .filter(turn => !turn.error && turn.content.trim() !== '')
            .map(turn => ({ role: turn.role, content: turn.content }));

        const stamp = Date.now();
        const answerId = `a${stamp}`;
        setTurns(prev => [
            ...prev,
            { id: `q${stamp}`, role: 'user', content: text },
            { id: answerId, role: 'assistant', content: '' },
        ]);
        setDraft('');
        setShowExamples(false);
        setStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        const patch = (change: (turn: Turn) => Turn) =>
            setTurns(prev => prev.map(turn => (turn.id === answerId ? change(turn) : turn)));

        try {
            await chatService.stream(text, history, {
                onMeta: received => setAnsweredBy({
                    model: received.model, usingOwnKey: received.usingOwnKey,
                }),
                onDelta: fragment => patch(turn => ({ ...turn, content: turn.content + fragment })),
                // Kept beside the partial answer rather than replacing it. Half an explanation
                // plus "the connection dropped" is more use than an error on its own.
                onError: message => patch(turn => ({ ...turn, error: message })),
                onTruncated: () => patch(turn => ({
                    ...turn,
                    notice: 'This answer was cut off at the length limit. Ask it to continue, or '
                        + 'ask something narrower. Check any SQL above before running it.',
                })),
            }, controller.signal);
        } catch (err) {
            if (!controller.signal.aborted) {
                patch(turn => ({
                    ...turn,
                    error: err instanceof Error && err.message
                        ? err.message
                        : 'Could not reach the assistant.',
                }));
            }
        } finally {
            setStreaming(false);
            abortRef.current = null;
        }
    }, [isStreaming, turns]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStreaming(false);
    }, []);

    const clear = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStreaming(false);
        setTurns([]);
        setAnsweredBy(null);
        setShowExamples(false);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends and Shift+Enter breaks the line, which is what every chat does — but the
        // canvas is listening for keys too, so the event must not reach it either way.
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void ask(draft);
        }
    };

    const isEmpty = turns.length === 0;

    return (
        <>
            <div
                ref={scrollRef}
                // `nowheel` or scrolling the transcript zooms the canvas underneath it.
                className="nowheel flex-1 overflow-y-auto scroll-slim px-3 py-3 space-y-3"
            >
                {isEmpty && (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <p className="text-xs text-ink-500 leading-relaxed">
                                Ask about the schema you have open, or have one designed for you.
                                {tableNames.length > 0
                                    ? ` I can see ${tableNames.length} table${tableNames.length === 1 ? '' : 's'} — their columns, keys and relationships, but none of the data in them.`
                                    : ' This file has no tables yet, so start by describing what you want to store.'}
                            </p>
                            {/* Said plainly, because an empty panel right after switching files
                                otherwise reads as "your conversation is gone". */}
                            <p className="text-[11px] text-ink-400 leading-relaxed">
                                Every file keeps its own conversation. Switching away does not end
                                this one — it is here when you come back.
                            </p>
                        </div>
                        <Examples groups={examples} onPick={prompt => void ask(prompt)} />
                    </div>
                )}

                {turns.map(turn =>
                    turn.role === 'user' ? (
                        <div key={turn.id} className="flex justify-end">
                            <p className="max-w-[85%] rounded-lg rounded-br-sm px-2.5 py-1.5 bg-brand-600
                                          text-xs leading-relaxed text-white whitespace-pre-wrap break-words">
                                {turn.content}
                            </p>
                        </div>
                    ) : (
                        <div key={turn.id} className="space-y-1">
                            {turn.content === '' && !turn.error ? (
                                <p className="flex items-center gap-1.5 text-xs text-ink-400">
                                    <Loader2 size={12} className="animate-spin" />
                                    Reading the schema…
                                </p>
                            ) : (
                                <ChatAnswer
                                    idPrefix={turn.id}
                                    text={turn.content}
                                    onSendToScratchpad={onSendToScratchpad}
                                />
                            )}
                            {turn.notice && !turn.error && (
                                <p className="tone-warning flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]">
                                    <AlertCircle size={12} className="shrink-0 mt-px" />
                                    <span>{turn.notice}</span>
                                </p>
                            )}
                            {turn.error && (
                                <p className="tone-error flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]">
                                    <AlertCircle size={12} className="shrink-0 mt-px" />
                                    <span>{turn.error}</span>
                                </p>
                            )}
                        </div>
                    ),
                )}

                {/* Re-opened from the composer once a conversation is under way. Rendered at the
                    bottom of the transcript rather than as a popover so it scrolls with
                    everything else and cannot cover the answer it was opened next to. */}
                {!isEmpty && showExamples && (
                    <div className="pt-2 border-t border-line">
                        <Examples groups={examples} onPick={prompt => void ask(prompt)} />
                    </div>
                )}
            </div>

            <div className="border-t border-line px-2 py-2 shrink-0">
                <div className="flex items-end gap-1.5">
                    <textarea
                        rows={2}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about this schema…"
                        aria-label="Ask the schema assistant"
                        className="flex-1 resize-none max-h-40 bg-surface border border-ink-300 rounded-md
                                   px-2 py-1.5 text-xs text-ink-900 placeholder:text-ink-400 scroll-slim
                                   focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    {isStreaming ? (
                        <button
                            type="button"
                            onClick={stop}
                            aria-label="Stop generating"
                            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md
                                       border border-line text-ink-500 hover:text-ink-900 transition-colors"
                        >
                            <Square size={12} fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void ask(draft)}
                            disabled={draft.trim() === ''}
                            aria-label="Send"
                            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md
                                       brand-gradient text-white disabled:opacity-40
                                       disabled:cursor-not-allowed transition-opacity"
                        >
                            <ArrowUp size={14} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 mt-1.5 px-0.5">
                    {!isEmpty && (
                        <button
                            type="button"
                            onClick={() => setShowExamples(v => !v)}
                            aria-pressed={showExamples}
                            className={`shrink-0 flex items-center gap-1 text-[10px] transition-colors ${
                                showExamples ? 'text-brand-700' : 'text-ink-400 hover:text-ink-700'
                            }`}
                        >
                            <Lightbulb size={10} />
                            Examples
                        </button>
                    )}
                    <p className="flex items-center gap-1 text-[10px] text-ink-400 min-w-0">
                        <Sparkles size={9} className="shrink-0" />
                        <span className="truncate">
                            {answeredBy
                                ? `${answeredBy.model}${answeredBy.usingOwnKey ? ' · your key' : ''}`
                                : 'Schema only — no row data is sent.'}
                        </span>
                    </p>
                    {!isEmpty && (
                        <button
                            type="button"
                            onClick={clear}
                            className="ml-auto shrink-0 flex items-center gap-1 text-[10px] text-ink-400
                                       hover:text-ink-700 transition-colors"
                        >
                            <Trash2 size={9} />
                            Clear
                        </button>
                    )}
                </div>
            </div>
        </>
    );
};
