import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, following it as the window changes.
 *
 * `useSyncExternalStore` rather than state set in an effect: the lint config rejects
 * `set-state-in-effect`, and this is what the hook is for. The server snapshot is `false`, so
 * the first paint is the wide layout and a phone switches on hydration.
 */
export const useMediaQuery = (query: string): boolean => {
    const subscribe = useCallback((notify: () => void) => {
        const list = window.matchMedia(query);
        list.addEventListener('change', notify);
        return () => list.removeEventListener('change', notify);
    }, [query]);
    return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
};
