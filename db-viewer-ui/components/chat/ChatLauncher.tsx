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
            className={`relative h-9 w-9 flex items-center justify-center rounded-full border transition-all
                        shadow-glow-md ${
                isOpen
                    ? 'bg-surface border-brand-400 text-brand-600'
                    : 'brand-gradient brand-gradient-hover border-transparent text-white'
            }`}
        >
            {isOpen ? <PanelRightClose size={15} /> : <Sparkles size={15} />}
            {hasConversation && !isOpen && (
                <span aria-hidden="true"
                      className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-surface" />
            )}
        </button>
    </Tooltip>
);
