"use client";

import React from 'react';
import { Check, AlertCircle, Undo2 } from 'lucide-react';

/**
 * A brief, non-blocking message at the bottom of the canvas.
 *
 * Undo needs one. Ctrl+Z that reverses a database change and says nothing leaves the user
 * guessing whether it worked, and the change itself is often off screen — reversing "add column
 * orders.status" moves nothing the eye is looking at. Every other message in this app is a
 * `NoticeModal`, which is the wrong shape here: stopping the world to say "done" is worse than
 * saying nothing.
 *
 * Dismissal is the caller's job (a `setTimeout` beside the `setState` that raised it) rather than
 * an effect in here, because `react-hooks/set-state-in-effect` is an error and a self-dismissing
 * component would need exactly that.
 */

export interface ToastState {
    message: string;
    tone: 'ok' | 'error';
    /** Optional single action, e.g. redo what was just undone. */
    action?: { label: string; onClick: () => void };
}

export const ActionToast = ({ toast, onDismiss }: {
    toast: ToastState | null;
    onDismiss: () => void;
}) => {
    if (!toast) return null;

    return (
        <div
            // `polite`, not `assertive`: this is confirmation, not an alarm, and it must not
            // interrupt whatever a screen reader is already saying.
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4"
        >
            <div
                className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2.5
                            shadow-glow-lg anim-fade-up ${
                    toast.tone === 'error' ? 'tone-error' : 'bg-surface border-line text-ink-700'
                }`}
            >
                <span className="shrink-0">
                    {toast.tone === 'error'
                        ? <AlertCircle size={15} />
                        : <Check size={15} className="text-emerald-600" />}
                </span>
                <span className="text-xs font-medium">{toast.message}</span>

                {toast.action && (
                    <button
                        type="button"
                        onClick={toast.action.onClick}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold
                                   text-brand-700 transition-colors hover:bg-brand-50"
                    >
                        <Undo2 size={13} /> {toast.action.label}
                    </button>
                )}

                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    className="ml-1 rounded px-1 text-ink-400 transition-colors hover:text-ink-700"
                >
                    &times;
                </button>
            </div>
        </div>
    );
};
