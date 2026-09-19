/**
 * The colour theme: what the user picked, and what that resolves to right now.
 *
 * Three states, not two: the stored preference and the theme actually in effect are different
 * questions with different answers, because "system" is one of the things a reader can pick.
 *
 * **Light is the default.** Following the OS sounds more considerate and makes the product look
 * like two different things depending on who opens the link — a shared diagram, a screenshot in
 * an issue, a first visit — so the first impression is a fixed one. "System" is still there for
 * anyone who wants it; it is just chosen rather than assumed.
 *
 * The attribute on `<html>` is the single source of truth for CSS (see the `dark:` variant and
 * the `[data-theme="dark"]` token block in `globals.css`). It is written before first paint by
 * `themeBootstrapScript`, so the page never renders light and then flips.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sql-visualizer.theme';

const isPreference = (value: unknown): value is ThemePreference =>
    value === 'light' || value === 'dark' || value === 'system';

/**
 * localStorage throws rather than returning null in several real situations — Safari private
 * browsing, storage disabled by policy — and a theme is never worth taking the app down for.
 */
export const readPreference = (): ThemePreference => {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        return isPreference(stored) ? stored : 'light';
    } catch {
        return 'light';
    }
};

/**
 * Anyone currently displaying the preference.
 *
 * The preference lives in localStorage, which is an external store rather than React state — so
 * it is read through `useSyncExternalStore` and has to be able to announce a change. The
 * `storage` event covers other tabs but deliberately never fires in the tab that wrote the
 * value, which is the one that most needs to know.
 */
const listeners = new Set<() => void>();

export const subscribeToPreference = (onChange: () => void): (() => void) => {
    listeners.add(onChange);
    window.addEventListener('storage', onChange);
    return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onChange);
    };
};

export const storePreference = (preference: ThemePreference): void => {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
        // Storage disabled: the choice still applies for this tab, which is the part that matters.
    }
    listeners.forEach(listener => listener());
};

export const systemTheme = (): ResolvedTheme =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

export const resolveTheme = (preference: ThemePreference): ResolvedTheme =>
    preference === 'system' ? systemTheme() : preference;

/** Writes the resolved theme where CSS can see it. */
export const applyTheme = (theme: ResolvedTheme): void => {
    document.documentElement.setAttribute('data-theme', theme);
};

/**
 * Calls back when the OS theme changes, so "system" keeps up without a reload.
 *
 * @returns an unsubscribe function
 */
export const watchSystemTheme = (onChange: (theme: ResolvedTheme) => void): (() => void) => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
};

/**
 * Runs before anything is painted, from a blocking `<script>` in the document head.
 *
 * Without it the server-rendered HTML carries no theme, the page paints light, and React only
 * then applies the stored preference — a white flash on every navigation, which is precisely
 * what somebody working in the dark turned this on to avoid. It is written as a string because
 * it has to execute before React exists, and kept to one statement for the same reason.
 */
export const themeBootstrapScript = `(function(){try{` +
    `var s=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    // Only an explicit "system" consults the OS. No stored value means light, which has to match
    // `readPreference` exactly or the first paint and the toggle disagree for one frame.
    `var d=s==='dark'||(s==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);` +
    `document.documentElement.setAttribute('data-theme',d?'dark':'light');` +
    `}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
