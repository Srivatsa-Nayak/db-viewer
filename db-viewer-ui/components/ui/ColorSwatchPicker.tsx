"use client";

import React from 'react';
import { Ban } from 'lucide-react';
import { TAG_COLOURS, TagColour } from '@/types';

/**
 * The six table colours, plus a way back to none.
 *
 * Deliberately not an `<input type="color">`. An arbitrary hex is the wrong control here for two
 * reasons: it produces colours that are unreadable in one of the two themes, and it produces
 * colours nobody can tell apart at the zoom where a hundred tables fit on screen. Six named
 * tokens, each defined for light and dark, keeps both problems out.
 *
 * Rendered as a `radiogroup` rather than a list of buttons — picking a colour is choosing one of
 * a fixed set, and arrow-key navigation comes with the role. Matches `ThemeToggle`.
 */

const SWATCH = 'w-5 h-5 rounded-full border transition-transform hover:scale-110 '
    + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1';

/** Inline styles because the colour is chosen at runtime; the *values* are still tokens. */
const swatchStyle = (colour: TagColour): React.CSSProperties => ({
    backgroundColor: `var(--color-tag-${colour})`,
    borderColor: `var(--color-tag-${colour})`,
});

interface ColorSwatchPickerProps {
    value?: TagColour;
    onChange: (colour: TagColour | undefined) => void;
    /** Rendered above the swatches, so the group has an accessible name. */
    label?: string;
}

export const ColorSwatchPicker = ({ value, onChange, label = 'Table colour' }: ColorSwatchPickerProps) => (
    <div>
        <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mb-1.5">{label}</p>
        <div role="radiogroup" aria-label={label} className="flex items-center gap-1.5">
            {TAG_COLOURS.map(colour => (
                <button
                    key={colour}
                    type="button"
                    role="radio"
                    aria-checked={value === colour}
                    aria-label={colour}
                    title={colour}
                    onClick={e => { e.stopPropagation(); onChange(colour); }}
                    className={`${SWATCH} ${value === colour ? 'ring-2 ring-offset-1 ring-ink-400' : ''}`}
                    style={swatchStyle(colour)}
                />
            ))}
            <button
                type="button"
                role="radio"
                aria-checked={!value}
                aria-label="No colour"
                title="No colour"
                onClick={e => { e.stopPropagation(); onChange(undefined); }}
                className={`${SWATCH} border-ink-300 text-ink-400 flex items-center justify-center `
                    + `${!value ? 'ring-2 ring-offset-1 ring-ink-400' : ''}`}
            >
                <Ban size={11} />
            </button>
        </div>
    </div>
);
