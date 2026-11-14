/**
 * Whether the backend has answered yet in this tab, and whether anybody is waiting on it.
 *
 * The live backend runs on a free Azure plan with no "Always On": after ~20 idle minutes it is
 * stopped, and the next request waits for a JVM and Spring to start — measured at 26 seconds.
 * Two things follow, and both live here so they cannot disagree:
 *
 * - **A longer timeout until the first answer.** The normal 30s limit sat just above the
 *   measured start time, so a slightly slower start turned a visitor's first click into an
 *   error. Until something has come back, requests are allowed `COLD_START_TIMEOUT_MS`.
 * - **A notice while someone waits.** A request that is still pending after
 *   `WAKE_NOTICE_AFTER_MS`, before the backend has answered once, flips the status to
 *   `waking`; `ServerWakeNotice` says why the spinner is taking so long. The first response
 *   clears it.
 *
 * "Answered" means any HTTP response except the gateway errors Azure's front end returns while
 * the app behind it is still starting — a 401 or a 404 proves the backend is up just as well as
 * a 200 does. Pure module state with a subscribe/snapshot pair for `useSyncExternalStore`, so
 * it can be unit-tested without a DOM.
 */

export type BackendStatus = 'unknown' | 'waking' | 'awake';

/** How long a request may wait before the "waking up" notice appears. */
export const WAKE_NOTICE_AFTER_MS = 3_000;

/** The timeout a request gets while the backend may still be starting. */
export const COLD_START_TIMEOUT_MS = 90_000;

/** Statuses Azure's front end answers with while the app behind it is still starting. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

let status: BackendStatus = 'unknown';
let pending = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const setStatus = (next: BackendStatus) => {
    if (status === next) return;
    status = next;
    listeners.forEach(listener => listener());
};

const clearTimer = () => {
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
};

export const getBackendStatus = (): BackendStatus => status;

export const isBackendAwake = (): boolean => status === 'awake';

export const subscribeBackendStatus = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** The backend has answered. Everything waiting on it is about to resolve. */
export const markBackendAwake = () => {
    clearTimer();
    setStatus('awake');
};

/** A request the user is waiting on has been sent. */
export const requestStarted = () => {
    if (status === 'awake') return;
    pending += 1;
    if (timer === null) {
        timer = setTimeout(() => {
            timer = null;
            if (pending > 0 && status !== 'awake') setStatus('waking');
        }, WAKE_NOTICE_AFTER_MS);
    }
};

/**
 * A request has finished. `httpStatus` is the response's status, or undefined when there was
 * no response at all (timeout, network down).
 */
export const requestFinished = (httpStatus?: number) => {
    pending = Math.max(0, pending - 1);
    if (httpStatus !== undefined && httpStatus > 0 && !GATEWAY_STATUSES.has(httpStatus)) {
        markBackendAwake();
        return;
    }
    if (pending === 0 && status !== 'awake') {
        // Nobody is waiting any more, and the backend never answered: the request's own error
        // says what went wrong, so the notice goes rather than promising a wake-up.
        clearTimer();
        setStatus('unknown');
    }
};

/** Test-only: back to a fresh tab. */
export const resetBackendStatusForTests = () => {
    clearTimer();
    pending = 0;
    status = 'unknown';
    listeners.clear();
};
