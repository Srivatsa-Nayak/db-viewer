"use client";

import React from 'react';
import { PanelRightClose, Sparkles } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';

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
}

export const ChatLauncher = ({ isOpen, onToggle }: ChatLauncherProps) => (
    <Tooltip content={isOpen ? 'Hide the assistant' : 'Ask the schema assistant'}>
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label="Schema assistant"
            className={`h-9 w-9 flex items-center justify-center rounded-full border transition-all
                        shadow-glow-md ${
                isOpen
                    ? 'bg-surface border-brand-400 text-brand-600'
                    : 'brand-gradient brand-gradient-hover border-transparent text-white'
            }`}
        >
            {isOpen ? <PanelRightClose size={15} /> : <Sparkles size={15} />}
        </button>
    </Tooltip>
);
