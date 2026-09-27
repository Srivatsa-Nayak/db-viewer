"use client";

import React, { useCallback, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * A hover/focus tooltip that escapes the canvas.
 *
 * Portalled to `document.body` for the same reason `Modal` is: React Flow transforms its viewport,
 * which makes it the containing block for any `position: fixed` descendant — a tooltip rendered in
 * place inside a table node would anchor to the canvas pane and, worse, would be *scaled* by the
 * current zoom. Portalled, it is the same size and readable at any zoom.
 *
 * It is an **enhancement, never the only channel**. `DialectMatrix` records the house stance —
 * "shown under the mark, so nothing depends on a tooltip" — and that holds here: a column's key
 * status is visible as an icon whether or not anyone hovers. The tooltip adds the detail that will
 * not fit in 200px, and nothing that lives only here matters.
 *
 * It renders its own trigger element rather than cloning the caller's. Cloning was the obvious
 * shape and the lint config rejects it (`react-hooks/refs`) — and owning the element means the
 * focus handling and `aria-describedby` wiring cannot be forgotten at a call site.
 */

/** Delay before showing, so sweeping the pointer across a table does not strobe. */
const OPEN_DELAY = 350;

const subscribeToNothing = () => () => {};
const useIsClient = () =>
    useSyncExternalStore(subscribeToNothing, () => true, () => false);

interface TooltipProps {
    /** Tooltip body. Rendering nothing disables the tooltip entirely. */
    content: React.ReactNode;
    /** What the tooltip is attached to. */
    children: React.ReactNode;
    /** Classes for the trigger element, which is a `<span>`. */
    className?: string;
    /** Suppresses the tooltip — used while a node is being dragged. */
    disabled?: boolean;
}

export const Tooltip = ({ content, children, className = '', disabled }: TooltipProps) => {
    const [position, setPosition] = useState<{ x: number; y: number; above: boolean } | null>(null);
    const timer = useRef<number | null>(null);
    const isClient = useIsClient();
    const id = useId();

    const cancel = useCallback(() => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const show = useCallback((element: HTMLElement, immediate: boolean) => {
        cancel();
        const open = () => {
            const box = element.getBoundingClientRect();
            // Above the row by preference; below it when there is no room, which is what happens
            // to a table sitting near the top of the canvas.
            const above = box.top > 120;
            setPosition({ x: box.left, y: above ? box.top - 8 : box.bottom + 8, above });
        };
        if (immediate) open();
        else timer.current = window.setTimeout(open, OPEN_DELAY);
    }, [cancel]);

    const hide = useCallback(() => {
        cancel();
        setPosition(null);
    }, [cancel]);

    if (disabled || !content) {
        return <span className={className}>{children}</span>;
    }

    return (
        <>
            <span
                // Focusable so the definition is reachable without a mouse.
                tabIndex={0}
                aria-describedby={position ? id : undefined}
                className={className}
                onMouseEnter={e => show(e.currentTarget, false)}
                onMouseLeave={hide}
                // No delay for keyboard users — they have already committed to the element.
                onFocus={e => show(e.currentTarget, true)}
                onBlur={hide}
            >
                {children}
            </span>

            {isClient && position && createPortal(
                <div
                    id={id}
                    role="tooltip"
                    // Below the dialog layer (100) but above the canvas chrome.
                    className="fixed z-[90] pointer-events-none max-w-[22rem] rounded-md border border-line
                               bg-surface px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-700
                               shadow-glow-md anim-fade-in"
                    style={{
                        left: position.x,
                        top: position.y,
                        transform: position.above ? 'translateY(-100%)' : undefined,
                    }}
                >
                    {content}
                </div>,
                document.body
            )}
        </>
    );
};
