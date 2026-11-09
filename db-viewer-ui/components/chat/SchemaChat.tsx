"use client";

import React, { useEffect, useState } from 'react';
import { AlertCircle, KeyRound, Loader2, Sparkles, X } from 'lucide-react';
import { ChatConfig, chatService } from '@/services/api';
import { ChatConversation } from './ChatConversation';

/**
 * The schema assistant, as a column of the editor beside the canvas.
 *
 * <p><b>A panel, not a popover.</b> It is built the way `FileExplorer` is and mirrored to the
 * other edge: a real flex child from `lg` up, so opening it makes the canvas narrower rather than
 * covering it, and an overlay drawer below that, where there is no room for both. A floating card
 * was the first shape and it was the wrong one for what this holds — a conversation grows, a
 * schema summary is long, and code blocks want width. Sharing the layout with the diagram also
 * means the two can be read together, which is the point of putting the assistant on the canvas
 * rather than on a page of its own.
 *
 * <p>The panel stays mounted and animates its width, exactly as the Explorer does, so the canvas
 * slides rather than jumping — and `inert` is set while it is closed, because a zero-width panel
 * is still in the DOM and its inputs are still in the tab order otherwise.
 *
 * <p><b>Availability is asked for, not assumed.</b> Whether a message can be sent depends on two
 * things the browser cannot know — whether the deployment has a key of its own, and whether this
 * account has supplied one — so `GET /chat/config` answers before the composer is shown. The
 * alternative is a panel that always looks ready and fails on the first question.
 */

/** Matches the Explorer's rhythm, one step wider: answers contain SQL, and SQL wraps badly. */
const PANEL_W_BASE = 'w-[min(24rem,90vw)]';
const PANEL_W_LG = 'lg:w-[22rem] xl:w-[26rem]';

interface SchemaChatProps {
    isOpen: boolean;
    onClose: () => void;
    /**
     * The open file's workspace id. Both the conversation's `key` and its identity in
     * `chatStore`: remounting swaps which stored conversation is shown, rather than clearing it.
     */
    workspaceKey: string;
    /** Names of the tables in the open file — the examples are written around them. */
    tableNames: string[];
    hasAccount: boolean;
    /** Opens the sign-up prompt, as export and the scratchpad do. */
    onNeedsAccount: () => void;
    onSendToScratchpad: (sql: string) => void;
    /** Opens the profile dialog, where the API key lives. */
    onManageKey: () => void;
    /**
     * Changes whenever what `/chat/config` would say may have changed: a different user signed
     * in, or the profile dialog (where the key is managed) was closed. The config is fetched once
     * per value, so a key added while the panel said "unavailable" is picked up straight away —
     * it used to stay unavailable until the page was reloaded.
     */
    configKey: string;
}

/** Where focus goes back to when the panel closes. */
export const CHAT_LAUNCHER_ID = 'schema-assistant-launcher';

export const SchemaChat = ({
    isOpen, onClose, workspaceKey, tableNames, hasAccount,
    onNeedsAccount, onSendToScratchpad, onManageKey, configKey,
}: SchemaChatProps) => {
    // Kept with the key it was fetched for, and derived from that, rather than reset by an effect
    // when the key changes: the lint config rejects setting state synchronously in an effect.
    const [loaded, setLoaded] = useState<{ key: string; config: ChatConfig } | null>(null);
    const config = loaded && loaded.key === configKey ? loaded.config : null;

    const close = () => {
        onClose();
        // Back to the control that opened it, so keyboard users are not dropped at the top.
        document.getElementById(CHAT_LAUNCHER_ID)?.focus();
    };

    /**
     * Checked the first time the panel is opened, never on mount.
     *
     * <p>The panel is mounted from the start — it has to be, to animate its width — so mounting
     * cannot be the trigger the way it is for a dialog. Gating on `isOpen` instead means a
     * visitor who never opens the assistant never pays for the request.
     *
     * <p>`config === null` is both the "not loaded yet" state and the guard, so there is no
     * second `isChecking` flag to keep in step: once a result lands the dependency changes and
     * the effect does not run again. The `cancelled` flag follows `ShareModal`'s pattern. React's
     * development double-invoke will fire two requests here, which is harmless for an idempotent
     * read — unlike `POST /share`, where the same double-invoke needed fixing server-side.
     */
    const loadedKey = loaded?.key;
    useEffect(() => {
        if (!isOpen || !hasAccount || loadedKey === configKey) return;

        let cancelled = false;
        chatService.config()
            .then(result => { if (!cancelled) setLoaded({ key: configKey, config: result }); })
            .catch(() => {
                if (cancelled) return;
                setLoaded({
                    key: configKey,
                    config: {
                        requiresAccount: true,
                        signedIn: true,
                        available: false,
                        error: 'Could not reach the server. Is the backend running?',
                    },
                });
            });
        return () => { cancelled = true; };
    }, [isOpen, hasAccount, configKey, loadedKey]);

    return (
        <aside
            aria-label="Schema assistant"
            // A closed panel is still in the DOM, so nothing inside it should be tabbable.
            inert={!isOpen}
            className={[
                'absolute lg:relative inset-y-0 right-0 z-40 lg:z-auto shrink-0',
                'border-l border-line bg-surface flex flex-col h-full overflow-hidden',
                'transition-[width,transform,box-shadow] duration-300 ease-[cubic-bezier(.22,.9,.31,1)]',
                'motion-reduce:transition-none',
                isOpen
                    ? `${PANEL_W_BASE} ${PANEL_W_LG} translate-x-0 shadow-[var(--glow-md)] lg:shadow-none`
                    // `lg:border-l-0` because a collapsed panel is zero *content* width but keeps
                    // its border, leaving a stray 1px line against the canvas. Below lg the border
                    // stays — the drawer is translated off-screen there, not collapsed.
                    : `${PANEL_W_BASE} lg:w-0 lg:border-l-0 translate-x-full lg:translate-x-0 shadow-none`,
            ].join(' ')}
        >
            {/* Pinned to the open width so the contents hold their layout while the parent clips
                them; otherwise the composer and the code blocks re-flow their way down to zero. */}
            <div className={`${PANEL_W_BASE} ${PANEL_W_LG} h-full flex flex-col`}>
                <div className="h-14 flex items-center gap-2 px-3 sm:px-4 border-b border-line shrink-0">
                    <Sparkles size={16} className="text-brand-600 shrink-0" />
                    <span className="font-semibold text-ink-800 text-sm">Assistant</span>
                    <button
                        type="button"
                        onClick={onManageKey}
                        className="ml-auto shrink-0 flex items-center gap-1 rounded px-1.5 py-1 text-[10px]
                                   text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors"
                    >
                        <KeyRound size={10} />
                        API key
                    </button>
                    <button
                        type="button"
                        onClick={close}
                        aria-label="Close the assistant"
                        className="shrink-0 p-1 rounded text-ink-400 hover:text-ink-800
                                   hover:bg-ink-100 transition-colors"
                    >
                        <X size={15} />
                    </button>
                </div>

                {!hasAccount ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                        <Sparkles size={24} className="text-ink-300" />
                        <p className="text-xs text-ink-500 leading-relaxed">
                            The assistant needs a free account — every answer costs a model call,
                            the same reason exporting and sharing do.
                        </p>
                        <button
                            type="button"
                            onClick={onNeedsAccount}
                            className="px-3 py-1.5 rounded-md brand-gradient brand-gradient-hover
                                       text-xs font-semibold text-white"
                        >
                            Create a free account
                        </button>
                    </div>
                ) : config === null ? (
                    <div className="flex-1 flex items-center justify-center">
                        <Loader2 size={18} className="animate-spin text-ink-300" />
                    </div>
                ) : !config.available ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                        <AlertCircle size={24} className="text-ink-300" />
                        <p className="text-xs text-ink-500 leading-relaxed">
                            {config.error
                                ?? 'No model key is configured on this server, so the assistant cannot answer.'}
                        </p>
                        <button
                            type="button"
                            onClick={onManageKey}
                            className="px-3 py-1.5 rounded-md border border-ink-300 text-xs
                                       font-semibold text-ink-700 hover:border-brand-400
                                       hover:text-brand-700 transition-colors"
                        >
                            Use your own API key
                        </button>
                    </div>
                ) : (
                    <ChatConversation
                        key={workspaceKey}
                        workspaceId={workspaceKey}
                        tableNames={tableNames}
                        isOpen={isOpen}
                        config={config}
                        onSendToScratchpad={onSendToScratchpad}
                        onUnauthorized={onNeedsAccount}
                    />
                )}
            </div>
        </aside>
    );
};
