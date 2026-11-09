"use client";

import { useCallback, useRef, useState } from 'react';
import type { ToastState } from '@/components/ui/ActionToast';

/**
 * The editor's single action toast ("Undid: …", "Grouped 3 tables").
 *
 * Toasts dismiss themselves from a timer started here, not from an effect inside the toast:
 * `react-hooks/set-state-in-effect` is an error, and a self-dismissing component needs exactly
 * that. A new toast replaces the current one and restarts the clock.
 */
export const useToast = (durationMs = 4000) => {
    const [toast, setToast] = useState<ToastState | null>(null);
    const dismissTimer = useRef<number | null>(null);

    const showToast = useCallback((next: ToastState) => {
        if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
        setToast(next);
        dismissTimer.current = window.setTimeout(() => setToast(null), durationMs);
    }, [durationMs]);

    const dismissToast = useCallback(() => setToast(null), []);

    return { toast, showToast, dismissToast };
};
