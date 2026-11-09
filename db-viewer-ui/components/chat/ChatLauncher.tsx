"use client";

import React from 'react';
import { PanelRightClose, Sparkles } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { CHAT_LAUNCHER_ID } from './SchemaChat';

/**
 * The round button in the canvas's top-right corner that opens the assistant.
 *
 * <p>Separate from the panel because the two live in different parts of the layout: the button is
 * rendered into React Flow's top-right `Panel`, over the diagram, while the panel itself is a
 * column of the editor shell beside the canvas — the same relationship the Explorer's collapsed
 * rail has with the Explorer. Neither owns the open state; `app/app/page.tsx` does, because it
 * owns the layout the panel takes part in.
 */

interface ChatLauncherProps {
    isOpen: boolean;
    onToggle: () => void;
    /** This file already has a conversation — drawn as a dot, so it is findable when closed. */
    hasConversation?: boolean;
}

export const ChatLauncher = ({ isOpen, onToggle, hasConversation }: ChatLauncherProps) => (
    <Tooltip content={isOpen ? 'Hide the assistant (Ctrl+I)' : 'Ask the schema assistant (Ctrl+I)'}>
        <button
            id={CHAT_LAUNCHER_ID}
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={hasConversation && !isOpen
                ? 'Schema assistant, conversation in progress'
                : 'Schema assistant'}
            aria-keyshortcuts="Control+I"
            // A labelled pill rather than an icon-only circle: "Ask" says what it is, where a
            // sparkle on a gradient read as decoration and was easy to miss.
            className={`relative flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg border bg-surface shadow-glow-sm
                        text-[13px] font-medium transition-colors focus-visible:outline-none
                        focus-visible:ring-2 focus-visible:ring-brand-500 ${
                isOpen
                    ? 'border-brand-400 text-brand-700'
                    : 'border-line text-ink-700 hover:text-ink-900 hover:border-ink-300'
            }`}
        >
            {isOpen
                ? <PanelRightClose size={15} />
                : <Sparkles size={15} className="text-brand-600" />}
            {/* The word goes on a phone, where the canvas toolbar needs the width; the
                aria-label above still names it. */}
            <span className="hidden sm:inline">{isOpen ? 'Close' : 'Ask'}</span>
            {hasConversation && !isOpen && (
                <span aria-hidden="true"
                      className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-surface" />
            )}
        </button>
    </Tooltip>
);
