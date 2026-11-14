"use client";

import React, { useEffect, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { wakeBackend } from '@/services/api';
import { getBackendStatus, subscribeBackendStatus } from '@/services/backendStatus';

/**
 * Wakes the backend on every route, and says so while somebody is waiting for it.
 *
 * Mounted once, in the root layout. The free hosting plan stops an idle backend and restarting
 * it takes about half a minute; without this, a visitor's first click spins for that long with
 * no explanation and reads as broken. The notice appears only once a request has been waiting
 * a few seconds (see `services/backendStatus.ts`), so a backend that is already up never shows
 * it at all.
 *
 * The live region is always in the DOM and only its contents change, because a screen reader
 * announces a change to an existing region far more reliably than a region that appears.
 */
export const ServerWakeNotice = () => {
    const status = useSyncExternalStore(subscribeBackendStatus, getBackendStatus, () => 'unknown' as const);

    useEffect(() => {
        wakeBackend();
    }, []);

    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 top-24 z-[300] flex justify-center px-4"
        >
            {status === 'waking' && (
                <div className="anim-fade-up pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-ink-700 shadow-glow-lg">
                    <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-brand-600" />
                    <p className="text-xs leading-relaxed">
                        <span className="block font-semibold text-ink-800">Waking up the server…</span>
                        This app runs on free hosting, which pauses the server when nobody is using
                        it. Starting it again takes about 30 seconds — your request will carry on by
                        itself.
                    </p>
                </div>
            )}
        </div>
    );
};
