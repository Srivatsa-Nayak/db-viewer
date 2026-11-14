import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getBackendStatus, isBackendAwake, markBackendAwake, requestFinished, requestStarted,
    resetBackendStatusForTests, subscribeBackendStatus, WAKE_NOTICE_AFTER_MS,
} from '@/services/backendStatus';

describe('backendStatus', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetBackendStatusForTests();
    });
    afterEach(() => {
        resetBackendStatusForTests();
        vi.useRealTimers();
    });

    it('says nothing while a request is quick', () => {
        requestStarted();
        vi.advanceTimersByTime(WAKE_NOTICE_AFTER_MS - 1);
        requestFinished(200);
        vi.advanceTimersByTime(WAKE_NOTICE_AFTER_MS);
        expect(getBackendStatus()).toBe('awake');
    });

    it('reports waking once a request has waited, and clears on the first answer', () => {
        const listener = vi.fn();
        subscribeBackendStatus(listener);

        requestStarted();
        vi.advanceTimersByTime(WAKE_NOTICE_AFTER_MS);
        expect(getBackendStatus()).toBe('waking');

        requestFinished(200);
        expect(getBackendStatus()).toBe('awake');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('counts any real answer as awake, even a refusal', () => {
        requestStarted();
        requestFinished(401);
        expect(isBackendAwake()).toBe(true);
    });

    it('does not count a gateway error from the host as awake', () => {
        requestStarted();
        vi.advanceTimersByTime(WAKE_NOTICE_AFTER_MS);
        requestStarted();
        requestFinished(503);
        expect(getBackendStatus()).toBe('waking');
    });

    it('drops the notice when the only waiting request fails with no response', () => {
        requestStarted();
        vi.advanceTimersByTime(WAKE_NOTICE_AFTER_MS);
        requestFinished(undefined);
        expect(getBackendStatus()).toBe('unknown');
    });

    it('never goes back from awake, and stops tracking once awake', () => {
        markBackendAwake();
        requestStarted();
        vi.advanceTimersByTime(WAKE_NOTICE_AFTER_MS * 2);
        requestFinished(undefined);
        expect(getBackendStatus()).toBe('awake');
    });
});
