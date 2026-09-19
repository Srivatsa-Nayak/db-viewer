"use client";

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
    ThemePreference, applyTheme, readPreference, resolveTheme, storePreference,
    subscribeToPreference, watchSystemTheme,
} from '@/services/theme';

/**
 * Light / dark / system, as three buttons rather than one that cycles.
 *
 * A cycling button hides its own state: you cannot tell "dark because I chose dark" from "dark
 * because the OS is dark", and those behave differently at sunrise. Three visible options cost
 * a little more room and remove the question.
 *
 * The component renders nothing until it has read the stored preference. It cannot know the
 * answer on the server — localStorage does not exist there — and rendering a guess would put a
 * wrong option in the selected state for one frame. The page itself does not flash, because the
 * theme is applied by a blocking script in `app/layout.tsx` long before this mounts.
 */

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun size={13} /> },
    { value: 'dark', label: 'Dark', icon: <Moon size={13} /> },
    { value: 'system', label: 'Match the system setting', icon: <Monitor size={13} /> },
];

interface ThemeToggleProps {
    /** `header` sits on the app bar, where the ground is a gradient rather than a surface. */
    variant?: 'header' | 'plain';
}

export const ThemeToggle = ({ variant = 'header' }: ThemeToggleProps) => {
    /**
     * The preference is not React state — it lives in localStorage, and a second tab can change
     * it. Subscribing to it as an external store keeps the two in step, and the server snapshot
     * of `null` is what renders the placeholder below instead of a guess.
     */
    const preference = useSyncExternalStore<ThemePreference | null>(
        subscribeToPreference, readPreference, () => null);

    // Push the choice out to the DOM, where the CSS reads it. This is the effect doing what an
    // effect is for: synchronising an external system with React's idea of the state.
    useEffect(() => {
        if (preference === null) return;
        applyTheme(resolveTheme(preference));
    }, [preference]);

    // Only while following the system: an explicit choice must not be overridden at dusk.
    useEffect(() => {
        if (preference !== 'system') return;
        return watchSystemTheme(applyTheme);
    }, [preference]);

    const choose = useCallback((next: ThemePreference) => storePreference(next), []);

    if (preference === null) {
        // Reserves the space so the header does not shift when the real control arrives.
        return <div className="w-[86px] h-8 shrink-0" aria-hidden="true" />;
    }

    const onHeader = variant === 'header';
    const track = onHeader
        ? 'bg-black/20 border-white/20 dark:bg-ink-100 dark:border-line'
        : 'bg-ink-100 border-line';

    return (
        <div
            role="radiogroup"
            aria-label="Colour theme"
            className={`flex items-center gap-0.5 p-0.5 rounded-md border shrink-0 ${track}`}
        >
            {OPTIONS.map(option => {
                const isActive = preference === option.value;
                const activeClass = onHeader
                    ? 'bg-white text-brand-700 dark:bg-brand-600 dark:text-white'
                    : 'bg-surface text-brand-700 shadow-glow-sm';
                const idleClass = onHeader
                    ? 'text-white/70 hover:text-white hover:bg-white/15 dark:text-ink-500 dark:hover:text-ink-900 dark:hover:bg-ink-200'
                    : 'text-ink-500 hover:text-ink-900 hover:bg-ink-200';

                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => choose(option.value)}
                        className={`p-1.5 rounded transition-colors ${isActive ? activeClass : idleClass}`}
                    >
                        {option.icon}
                    </button>
                );
            })}
        </div>
    );
};
