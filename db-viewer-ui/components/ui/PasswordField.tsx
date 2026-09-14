"use client";

import React, { useId, useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface PasswordFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    id?: string;
    placeholder?: string;
    autoComplete?: string;
    autoFocus?: boolean;
    /** Small print under the field — a rule, or what this particular password is for. */
    hint?: React.ReactNode;
    inputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * A password input with a reveal toggle.
 *
 * The toggle exists because the alternative to seeing what you typed is typing it again, and a
 * password field that silently swallowed a stray capital is the most common way a correct
 * password gets rejected. It starts hidden, and is a `button` rather than a checkbox so it
 * cannot be submitted with the form.
 */
export const PasswordField = ({
    label, value, onChange, id, placeholder, autoComplete, autoFocus, hint, inputRef,
}: PasswordFieldProps) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const [isVisible, setVisible] = useState(false);

    return (
        <div>
            <label htmlFor={fieldId} className="block text-xs font-bold text-ink-500 uppercase mb-2">
                {label}
            </label>
            <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" size={16} />
                <input
                    id={fieldId}
                    ref={inputRef}
                    type={isVisible ? 'text' : 'password'}
                    autoComplete={autoComplete}
                    autoFocus={autoFocus}
                    className="w-full bg-white border border-ink-300 rounded-md py-2.5 sm:py-2 pl-10 pr-11 text-sm
                               text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500
                               focus:ring-1 focus:ring-brand-500"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                />
                <button
                    type="button"
                    onClick={() => setVisible(v => !v)}
                    // Announces state rather than just swapping an icon, so it is usable without
                    // being able to see which icon is currently showing.
                    aria-label={isVisible ? 'Hide password' : 'Show password'}
                    aria-pressed={isVisible}
                    title={isVisible ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-ink-400
                               hover:text-ink-700 hover:bg-ink-100 transition-colors"
                >
                    {/* The icon reports the current state, not the action: a struck-through eye
                        means "this is hidden", an open one means "this is readable". */}
                    {isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
            </div>
            {hint && <p className="text-[11px] text-ink-400 mt-1.5 leading-relaxed">{hint}</p>}
        </div>
    );
};
