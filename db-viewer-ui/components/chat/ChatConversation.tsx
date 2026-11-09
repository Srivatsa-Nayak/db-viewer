"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle, ArrowDown, ArrowUp, Check, Copy, Info, Lightbulb, Loader2, RotateCcw, Sparkles,
    Square, Trash2,
} from 'lucide-react';
import { ChatConfig, ChatTurnPayload, chatService } from '@/services/api';
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
 * <p>Live turns stay in local state and are *mirrored* to the store, rather than being read from
 * it on every render. A streaming answer changes on every token, and nothing else needs to
 * re-render while an answer is being written.
 */

interface Turn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** Set when the answer failed; rendered beneath whatever text did arrive. */
    error?: string;
    /**
     * A caveat that is not a failure: cut off at the length limit, or stopped by the user. Unlike
     * `error`, the turn stays in the history sent back, so "continue" has something to continue.
     */
    notice?: string;
    /** The schema was too large to send whole; said on the answer it affected. */
    schemaNote?: string;
}

interface ExampleGroup {
    title: string;
    prompts: string[];
}

/** The backend's own limit; longer questions are refused there, so say so before sending. */
const MAX_QUESTION_CHARS = 4000;
const COUNTER_FROM = MAX_QUESTION_CHARS - 500;

/** Within this many pixels of the bottom counts as "at the bottom", for following a stream. */
const STICK_THRESHOLD = 48;

/**
 * The openers, written around the schema that is actually open.
 *
 * <p>Naming the user's own tables does two jobs at once — it shows what a good question looks
 * like, and it demonstrates that the assistant can already see the file. An empty file gets a
 * different set entirely: the prompts become ways to start one.
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
        <p className="text-[11px] text-ink-400">Pick one to edit it before sending.</p>
        {groups.map(group => (
            <div key={group.title}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400 mb-1.5">
                    {group.title}
                </p>
                <div className="flex flex-col gap-1">
                    {group.prompts.map(prompt => (
                        <button
                            key={prompt}
                            type="button"
                            onClick={() => onPick(prompt)}
                            className="group text-left w-full min-h-8 rounded-md border border-line bg-surface
                                       px-2.5 py-1.5 text-[13px] leading-snug text-ink-600
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

const SMALL_ACTION = 'inline-flex items-center gap-1 h-6 px-1.5 rounded text-[11px] font-semibold '
    + 'text-ink-400 hover:text-ink-800 hover:bg-ink-100 transition-colors';

interface ChatConversationProps {
    /** Which file this conversation belongs to. Also the component's `key`, set by the caller. */
    workspaceId: string;
    /** Tables in the open file. Drives the examples, and what the empty state can honestly say. */
    tableNames: string[];
    /** Whether the panel is showing; the composer takes focus when it opens. */
    isOpen: boolean;
    /** What `/chat/config` said: the model and key a question would use, and today's quota. */
    config: ChatConfig;
    onSendToScratchpad: (sql: string) => void;
    /** The session has expired; opens the sign-in prompt. */
    onUnauthorized: () => void;
}

export const ChatConversation = ({
    workspaceId, tableNames, isOpen, config, onSendToScratchpad, onUnauthorized,
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
    /** False once the reader scrolls up, so the stream stops dragging them back down. */
    const [atBottom, setAtBottom] = useState(true);
    const [quotaLeft, setQuotaLeft] = useState<number | null>(config.quota?.remaining ?? null);
    const [keep, setKeep] = useState(() => chatStore.keepsConversations());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    /** For screen readers: said once when an answer finishes, never per token. */
    const [announcement, setAnnouncement] = useState('');

    const scrollRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const answerIdRef = useRef<string | null>(null);
    const atBottomRef = useRef(true);

    const examples = useMemo(() => examplesFor(tableNames), [tableNames]);

    // Follows the stream only while the reader is at the bottom. It used to scroll on every
    // token unconditionally, which made reading the start of a long answer impossible until it
    // had finished. DOM-only, which the lint config allows in an effect.
    useEffect(() => {
        const el = scrollRef.current;
        if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    }, [turns]);

    // The composer takes focus when the panel opens, so typing can start straight away.
    useEffect(() => {
        if (isOpen) textareaRef.current?.focus();
    }, [isOpen]);

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
     * has left is nobody's intent — and records that it was stopped, or coming back would show
     * "Reading the schema…" spinning for ever against a request that no longer exists.
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
                last.content.trim() === ''
                    ? { ...last, error: 'Stopped when you switched files — ask again to retry.' }
                    : { ...last, notice: 'Cut short when you switched files.' },
            ],
        });
    }, [workspaceId]);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD;
        atBottomRef.current = near;
        if (near !== atBottom) setAtBottom(near);
    };

    const jumpToLatest = () => {
        const el = scrollRef.current;
        if (!el) return;
        atBottomRef.current = true;
        setAtBottom(true);
        el.scrollTop = el.scrollHeight;
    };

    /**
     * Sends a question.
     *
     * @param base the conversation to ask from. Normally the current one; Retry and Regenerate
     *             pass it with the old question and answer removed, because `turns` in this
     *             closure is the render's copy and a `setTurns` has not landed yet.
     */
    const ask = useCallback(async (question: string, base?: Turn[]) => {
        const text = question.trim();
        if (!text || isStreaming) return;
        const from = base ?? turns;

        // Errored turns are left out: replaying "the assistant is unavailable" back to the model
        // as its own words would be a lie about what it said.
        const history: ChatTurnPayload[] = from
            .filter(turn => !turn.error && turn.content.trim() !== '')
            .map(turn => ({ role: turn.role, content: turn.content }));

        const stamp = Date.now();
        const answerId = `a${stamp}`;
        answerIdRef.current = answerId;
        setTurns([
            ...from,
            { id: `q${stamp}`, role: 'user', content: text },
            { id: answerId, role: 'assistant', content: '' },
        ]);
        setDraft('');
        if (textareaRef.current) textareaRef.current.style.height = '';
        setShowExamples(false);
        setStreaming(true);
        setAnnouncement('');
        atBottomRef.current = true;
        setAtBottom(true);

        const controller = new AbortController();
        abortRef.current = controller;

        const patch = (change: (turn: Turn) => Turn) =>
            setTurns(prev => prev.map(turn => (turn.id === answerId ? change(turn) : turn)));

        let failed = false;
        try {
            await chatService.stream(text, history, {
                onMeta: received => {
                    setAnsweredBy({ model: received.model, usingOwnKey: received.usingOwnKey });
                    if (received.schemaTruncated) {
                        const omitted = received.omittedTables ?? 0;
                        patch(turn => ({
                            ...turn,
                            schemaNote: omitted > 0
                                ? `This file is large: ${omitted} table${omitted === 1 ? ' was' : 's were'} `
                                    + 'left out, so this answer cannot see their columns.'
                                : 'This file is large, and part of the schema was left out.',
                        }));
                    }
                },
                onDelta: fragment => patch(turn => ({ ...turn, content: turn.content + fragment })),
                // Kept beside the partial answer rather than replacing it. Half an explanation
                // plus "the connection dropped" is more use than an error on its own.
                onError: message => {
                    failed = true;
                    patch(turn => ({ ...turn, error: message }));
                },
                onTruncated: () => patch(turn => ({
                    ...turn,
                    notice: 'This answer was cut off at the length limit. Ask it to continue, or '
                        + 'ask something narrower. Check any SQL above before running it.',
                })),
                onUnauthorized,
            }, controller.signal);
        } catch (err) {
            if (!controller.signal.aborted) {
                failed = true;
                patch(turn => ({
                    ...turn,
                    error: err instanceof Error && err.message
                        ? err.message
                        : 'Could not reach the assistant.',
                }));
            }
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            if (answerIdRef.current === answerId) answerIdRef.current = null;
            setStreaming(false);
            if (!controller.signal.aborted) {
                setAnnouncement(failed ? 'The assistant could not answer.' : 'Answer ready.');
                if (!failed) setQuotaLeft(left => (left === null ? null : Math.max(0, left - 1)));
            }
        }
    }, [isStreaming, turns, onUnauthorized]);

    /**
     * Stops the answer being written.
     *
     * It used to only abort, which left a turn with no text and no error — rendered as
     * "Reading the schema…" with a spinner that never stopped. The turn now says what happened.
     */
    const stop = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        const answerId = answerIdRef.current;
        answerIdRef.current = null;
        setStreaming(false);
        if (!answerId) return;
        setTurns(prev => prev.map(turn => {
            if (turn.id !== answerId || turn.error) return turn;
            return turn.content.trim() === ''
                ? { ...turn, error: 'Stopped before it started answering.' }
                : { ...turn, notice: 'Stopped before the answer finished.' };
        }));
        setAnnouncement('Stopped.');
    }, []);

    const clear = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        answerIdRef.current = null;
        setStreaming(false);
        setTurns([]);
        setAnsweredBy(null);
        setShowExamples(false);
    }, []);

    /** Asks the question behind an answer again, replacing that answer. */
    const reask = useCallback((answerId: string) => {
        const at = turns.findIndex(turn => turn.id === answerId);
        const question = at > 0 ? turns[at - 1] : null;
        if (!question || question.role !== 'user') return;
        void ask(question.content, turns.slice(0, at - 1));
    }, [turns, ask]);

    const copyAnswer = async (turn: Turn) => {
        try {
            await navigator.clipboard.writeText(turn.content);
            setCopiedId(turn.id);
            setTimeout(() => setCopiedId(id => (id === turn.id ? null : id)), 1800);
        } catch {
            // Clipboard denied; the text is selectable.
        }
    };

    const pickExample = (prompt: string) => {
        // Into the composer, not straight off: most examples are templates worth editing first
        // ("Add a created_at to …"), and each send is a paid call.
        setDraft(prompt);
        setShowExamples(false);
        requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(prompt.length, prompt.length);
        });
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDraft(e.target.value);
        // Grows with its content, up to the CSS max-height; done in the handler, not an effect.
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends and Shift+Enter breaks the line, which is what every chat does — but the
        // canvas is listening for keys too, so the event must not reach it either way.
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void ask(draft);
        }
    };

    const toggleKeep = () => {
        const next = !keep;
        chatStore.setKeepConversations(next);
        setKeep(next);
        if (next) {
            // Write what is already here, rather than waiting for the next message.
            chatStore.save(workspaceId, {
                turns,
                model: answeredBy?.model ?? null,
                usingOwnKey: answeredBy?.usingOwnKey ?? false,
            });
        }
    };

    const isEmpty = turns.length === 0;
    const tooLong = draft.length > MAX_QUESTION_CHARS;
    const lastAssistantId = [...turns].reverse().find(turn => turn.role === 'assistant')?.id;

    const model = answeredBy?.model ?? config.model ?? null;
    const usingOwnKey = answeredBy?.usingOwnKey ?? config.usingOwnKey ?? false;

    return (
        <>
            <div className="relative flex-1 min-h-0 flex flex-col">
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    role="log"
                    aria-label="Conversation with the schema assistant"
                    // Announced once per answer through the status line below, not per token.
                    aria-live="off"
                    // `nowheel` or scrolling the transcript zooms the canvas underneath it.
                    className="nowheel flex-1 overflow-y-auto scroll-slim px-3 py-3 space-y-4"
                >
                    {isEmpty && (
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <p className="text-[13px] text-ink-500 leading-relaxed">
                                    Ask about the schema you have open, or have one designed for you.
                                    {tableNames.length > 0
                                        ? ` I can see ${tableNames.length} table${tableNames.length === 1 ? '' : 's'} — their columns, keys, indexes and relationships, but none of the data in them.`
                                        : ' This file has no tables yet, so start by describing what you want to store.'}
                                </p>
                                {/* Said plainly, because an empty panel right after switching files
                                    otherwise reads as "your conversation is gone". */}
                                <p className="text-xs text-ink-400 leading-relaxed">
                                    Every file keeps its own conversation. Switching away does not end
                                    this one — it is here when you come back.
                                </p>
                            </div>
                            <Examples groups={examples} onPick={pickExample} />
                        </div>
                    )}

                    {turns.map(turn =>
                        turn.role === 'user' ? (
                            <div key={turn.id} className="flex justify-end">
                                <p className="max-w-[85%] rounded-lg rounded-br-sm px-3 py-2 bg-brand-600
                                              text-[13px] leading-relaxed text-white whitespace-pre-wrap break-words">
                                    {turn.content}
                                </p>
                            </div>
                        ) : (
                            <div
                                key={turn.id}
                                className="space-y-1.5"
                                aria-busy={isStreaming && turn.id === lastAssistantId}
                            >
                                {turn.schemaNote && (
                                    <p className="tone-info flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs">
                                        <Info size={13} className="shrink-0 mt-px" />
                                        <span>{turn.schemaNote}</span>
                                    </p>
                                )}
                                {turn.content === '' && !turn.error ? (
                                    <p className="flex items-center gap-1.5 text-[13px] text-ink-400">
                                        <Loader2 size={13} className="animate-spin" />
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
                                    <p className="tone-warning flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs">
                                        <AlertCircle size={13} className="shrink-0 mt-px" />
                                        <span>{turn.notice}</span>
                                    </p>
                                )}
                                {turn.error && (
                                    <p className="tone-error flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs">
                                        <AlertCircle size={13} className="shrink-0 mt-px" />
                                        <span>{turn.error}</span>
                                    </p>
                                )}
                                {/* Whole-answer actions, once it is no longer being written. */}
                                {!(isStreaming && turn.id === lastAssistantId) && (
                                    <div className="flex items-center gap-0.5 -ml-1.5">
                                        {turn.content.trim() !== '' && (
                                            <button type="button" onClick={() => void copyAnswer(turn)}
                                                    className={SMALL_ACTION}>
                                                {copiedId === turn.id ? <Check size={12} /> : <Copy size={12} />}
                                                {copiedId === turn.id ? 'Copied' : 'Copy'}
                                            </button>
                                        )}
                                        {(turn.error || turn.id === lastAssistantId) && !isStreaming && (
                                            <button type="button" onClick={() => reask(turn.id)}
                                                    className={SMALL_ACTION}>
                                                <RotateCcw size={12} />
                                                {turn.error ? 'Retry' : 'Regenerate'}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        ),
                    )}

                    {/* Re-opened from the composer once a conversation is under way. Rendered at the
                        bottom of the transcript rather than as a popover so it scrolls with
                        everything else and cannot cover the answer it was opened next to. */}
                    {!isEmpty && showExamples && (
                        <div className="pt-2 border-t border-line">
                            <Examples groups={examples} onPick={pickExample} />
                        </div>
                    )}
                </div>

                {!atBottom && !isEmpty && (
                    <button
                        type="button"
                        onClick={jumpToLatest}
                        className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1
                                   h-7 px-3 rounded-full shadow-glow-md border border-line bg-surface
                                   text-xs font-semibold text-ink-700 hover:text-brand-700 transition-colors"
                    >
                        <ArrowDown size={12} />
                        {isStreaming ? 'New text below' : 'Jump to latest'}
                    </button>
                )}
            </div>

            <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

            <div className="border-t border-line px-2 py-2 shrink-0">
                <div className="flex items-end gap-1.5">
                    <textarea
                        ref={textareaRef}
                        rows={2}
                        value={draft}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask about this schema…"
                        aria-label="Ask the schema assistant"
                        aria-invalid={tooLong}
                        className="flex-1 resize-none max-h-40 bg-surface border border-ink-300 rounded-md
                                   px-2.5 py-1.5 text-[13px] text-ink-900 placeholder:text-ink-400 scroll-slim
                                   focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    {isStreaming ? (
                        <button
                            type="button"
                            onClick={stop}
                            aria-label="Stop generating"
                            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md
                                       border border-line text-ink-500 hover:text-ink-900 transition-colors"
                        >
                            <Square size={13} fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => void ask(draft)}
                            disabled={draft.trim() === '' || tooLong}
                            aria-label="Send"
                            className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md
                                       brand-gradient text-white disabled:opacity-40
                                       disabled:cursor-not-allowed transition-opacity"
                        >
                            <ArrowUp size={15} />
                        </button>
                    )}
                </div>

                {draft.length >= COUNTER_FROM && (
                    <p className={`mt-1 px-0.5 text-[11px] ${tooLong ? 'text-tone-error-ink font-semibold' : 'text-ink-400'}`}>
                        {draft.length.toLocaleString()} / {MAX_QUESTION_CHARS.toLocaleString()} characters
                        {tooLong ? ' — shorten it to send' : ''}
                    </p>
                )}

                <div className="flex items-center gap-1 mt-1.5 px-0.5 flex-wrap">
                    {!isEmpty && (
                        <button
                            type="button"
                            onClick={() => setShowExamples(v => !v)}
                            aria-pressed={showExamples}
                            className={`${SMALL_ACTION} ${showExamples ? '!text-brand-700' : ''}`}
                        >
                            <Lightbulb size={12} />
                            Examples
                        </button>
                    )}
                    <p className="flex items-center gap-1 text-[11px] text-ink-400 min-w-0">
                        <Sparkles size={11} className="shrink-0" />
                        <span className="truncate">
                            {model
                                ? `${model} · ${usingOwnKey ? 'your key' : 'app key'}`
                                    + (!usingOwnKey && quotaLeft !== null ? ` · ${quotaLeft} left today` : '')
                                : 'Schema only — no row data is sent.'}
                        </span>
                    </p>
                    <label className="ml-auto inline-flex items-center gap-1 h-6 px-1 text-[11px] text-ink-400 cursor-pointer select-none"
                           title="Keep these conversations if this tab is reloaded. They are never kept after the tab closes.">
                        <input type="checkbox" checked={keep} onChange={toggleKeep}
                               className="h-3 w-3 accent-brand-600" />
                        Keep after reload
                    </label>
                    {!isEmpty && (
                        <button type="button" onClick={clear} className={SMALL_ACTION}>
                            <Trash2 size={11} />
                            Clear
                        </button>
                    )}
                </div>
            </div>
        </>
    );
};
