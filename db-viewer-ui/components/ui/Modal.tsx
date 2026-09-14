"use client";

import React, { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * The one dialog primitive.
 *
 * Before this existed there were fourteen hand-rolled overlays: Escape closed four of
 * them, none announced itself to a screen reader, none trapped or restored focus, and the
 * stacking order was a ladder of hand-picked `z-[110]` / `z-[120]` / `z-[130]` values that
 * only held as long as nobody added a fifteenth. Everything below is here so that a call
 * site has to think about none of that.
 *
 * Three things are worth knowing:
 *
 * 1. **Portalled, always.** Dialogs opened from a table node would otherwise be positioned
 *    against React Flow's transformed viewport rather than the window — `position: fixed`
 *    resolves against the nearest transformed ancestor, not the screen.
 * 2. **Stack-ordered.** Depth in `openDialogs` sets the z-index and decides who Escape
 *    talks to, so a confirm opened from inside an editor lands above it and closes first.
 * 3. **A sheet on a phone.** Under 640px it docks to the bottom edge and can grow to 90vh,
 *    which is the only shape that works when the keyboard takes half the screen.
 */

/** Ids of every dialog currently mounted, oldest first. Depth drives z-index and Escape. */
const openDialogs: string[] = [];

/** Matches `--z-overlay-base` in globals.css; each nested dialog sits ten above the last. */
const BASE_Z = 100;

const syncBodyScrollLock = () => {
    if (typeof document === 'undefined') return;
    if (openDialogs.length > 0) document.body.setAttribute('data-dialog-open', 'true');
    else document.body.removeAttribute('data-dialog-open');
};

/**
 * True once running in the browser.
 *
 * The portal needs `document`, which does not exist while Next renders this on the server.
 * The usual `useState(false)` + `useEffect(() => setMounted(true))` does the job but costs an
 * extra render pass per dialog; a store whose server snapshot is `false` and client snapshot
 * is `true` gets the same answer through the path React already runs for hydration.
 */
const subscribeToNothing = () => () => {};
const useIsClient = () =>
    useSyncExternalStore(subscribeToNothing, () => true, () => false);

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZES: Record<ModalSize, string> = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-md',
    lg: 'sm:max-w-lg',
    xl: 'sm:max-w-2xl',
    full: 'sm:max-w-5xl',
};

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Rendered as the dialog's accessible name. */
    title: React.ReactNode;
    /** Optional second line under the title — usually the thing being acted on. */
    subtitle?: React.ReactNode;
    icon?: React.ReactNode;
    size?: ModalSize;
    /** Pinned to the bottom of the dialog, outside the scrolling body. */
    footer?: React.ReactNode;
    /** A top border colour class, e.g. `border-t-red-500`, for destructive dialogs. */
    accent?: string;
    /** Set false for a dialog with unsaved input, where a stray click should not discard it. */
    closeOnBackdrop?: boolean;
    /** Focused on open. Defaults to the first focusable element in the dialog. */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    /** Wraps the body so a form's submit button can live in `footer`. */
    onSubmit?: (e: React.FormEvent) => void;
    children?: React.ReactNode;
}

export const Modal = ({
    isOpen,
    onClose,
    title,
    subtitle,
    icon,
    size = 'md',
    footer,
    accent,
    closeOnBackdrop = true,
    initialFocusRef,
    onSubmit,
    children,
}: ModalProps) => {
    const id = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    // Held in a ref so the close handler never goes stale inside the key listener, which
    // is registered once per open rather than once per render.
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; });

    const isMounted = useIsClient();
    const overlayRef = useRef<HTMLDivElement>(null);

    // Register in the stack for as long as the dialog is open. The resulting depth is written
    // straight onto the overlay rather than held in state: it is presentation only, and a
    // state round trip here would re-render every dialog body on each open and close.
    useEffect(() => {
        if (!isOpen) return;
        openDialogs.push(id);
        if (overlayRef.current) {
            overlayRef.current.style.zIndex = String(BASE_Z + (openDialogs.length - 1) * 10);
        }
        syncBodyScrollLock();
        return () => {
            const index = openDialogs.indexOf(id);
            if (index !== -1) openDialogs.splice(index, 1);
            syncBodyScrollLock();
        };
    }, [isOpen, id]);

    // Escape closes, but only the dialog on top of the stack.
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (openDialogs[openDialogs.length - 1] !== id) return;
            e.stopPropagation();
            onCloseRef.current();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, id]);

    // Move focus in on open and put it back where it was on close. Without the restore,
    // closing a dialog opened from a table node drops focus onto <body> and the next Tab
    // starts again from the top of the page.
    useEffect(() => {
        if (!isOpen || !isMounted) return;
        const previous = document.activeElement as HTMLElement | null;

        const focusTarget = initialFocusRef?.current
            ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)
            ?? dialogRef.current;
        // Deferred a frame: the dialog is still animating in, and focusing mid-animation
        // makes Safari scroll the element into view against the transform.
        const handle = requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));

        return () => {
            cancelAnimationFrame(handle);
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, [isOpen, isMounted, initialFocusRef]);

    // Keep Tab inside the dialog.
    const onKeyDownCapture = useCallback((e: React.KeyboardEvent) => {
        if (e.key !== 'Tab' || !dialogRef.current) return;
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
            .filter(el => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    }, []);

    if (!isOpen || !isMounted) return null;

    const Body = onSubmit ? 'form' : 'div';

    return createPortal(
        <div
            ref={overlayRef}
            className="fixed inset-0 bg-ink-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 anim-fade-in"
            style={{ zIndex: BASE_Z }}
            // mousedown rather than click: a click that *starts* inside the dialog and ends
            // on the backdrop (selecting text, dragging a slider) must not close it.
            onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                tabIndex={-1}
                onKeyDownCapture={onKeyDownCapture}
                className={[
                    'bg-white border border-line shadow-glow-lg flex flex-col outline-none',
                    'w-full max-h-[90vh] rounded-t-2xl sm:rounded-xl',
                    'sm:max-h-[85vh] anim-dialog-in',
                    SIZES[size],
                    accent ? `border-t-4 ${accent}` : '',
                ].join(' ')}
            >
                <div className="px-4 py-3.5 sm:px-5 sm:py-4 border-b border-ink-200 flex justify-between items-start gap-3 shrink-0">
                    <div className="min-w-0">
                        <h2
                            id={`${id}-title`}
                            className="font-bold text-ink-900 flex items-center gap-2 text-[15px] sm:text-base"
                        >
                            {icon}
                            <span className="truncate">{title}</span>
                        </h2>
                        {subtitle && (
                            <p className="text-xs text-ink-500 mt-0.5 truncate">{subtitle}</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 -m-1 rounded-md text-ink-400 hover:text-ink-900 hover:bg-ink-100 transition-colors shrink-0"
                        aria-label="Close dialog"
                    >
                        <X size={18} />
                    </button>
                </div>

                <Body
                    onSubmit={onSubmit}
                    className="flex-1 min-h-0 flex flex-col overflow-hidden"
                >
                    <div className="flex-1 min-h-0 overflow-y-auto scroll-slim px-4 py-4 sm:px-5 sm:py-5">
                        {children}
                    </div>
                    {footer && (
                        <div className="px-4 py-3 sm:px-5 border-t border-ink-200 shrink-0 bg-white rounded-b-xl">
                            {footer}
                        </div>
                    )}
                </Body>
            </div>
        </div>,
        document.body
    );
};

/* ── Shared dialog furniture ──────────────────────────────────────────────── */

/** The standard Cancel / confirm pair. Kept here so every dialog agrees on order and weight. */
export const ModalActions = ({ children }: { children: React.ReactNode }) => (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">{children}</div>
);

const BUTTON_BASE = 'px-4 py-2.5 sm:py-2 rounded-md text-sm font-semibold transition-all '
    + 'disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2';

export const PrimaryButton = ({ className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
        {...props}
        className={`${BUTTON_BASE} brand-gradient brand-gradient-hover text-white shadow-glow-sm ${className}`}
    />
);

export const DangerButton = ({ className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
        {...props}
        className={`${BUTTON_BASE} bg-red-600 hover:bg-red-700 text-white shadow-sm ${className}`}
    />
);

export const GhostButton = ({ className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
        type="button"
        {...props}
        className={`${BUTTON_BASE} text-ink-600 hover:text-ink-900 hover:bg-ink-100 ${className}`}
    />
);

/** Inline error/warning/info strip, used inside dialog bodies. */
export const Callout = ({ tone, icon, children }: {
    tone: 'error' | 'warning' | 'info';
    icon?: React.ReactNode;
    children: React.ReactNode;
}) => {
    const tones = {
        error: 'bg-red-50 border-red-200 text-red-700',
        warning: 'bg-amber-50 border-amber-200 text-amber-800',
        info: 'bg-brand-50 border-brand-200 text-brand-700',
    };
    return (
        <div className={`flex items-start gap-2 p-3 rounded-md border text-xs leading-relaxed ${tones[tone]}`}>
            {icon && <span className="shrink-0 mt-px">{icon}</span>}
            <span className="min-w-0">{children}</span>
        </div>
    );
};
