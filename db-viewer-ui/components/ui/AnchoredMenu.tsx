"use client";

import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown that hangs off a button but is not rendered inside it.
 *
 * Built for menus that live on the canvas. A menu rendered in place inside a table node inherits
 * React Flow's viewport transform, which means it is *scaled by the zoom* — illegible at 25% and
 * comically large at 200% — and clipped by the node's own box. Portalled to `document.body` and
 * positioned from the button's screen rect, it is the same size at any zoom.
 *
 * Dismissal is hand-rolled rather than `useDismissable` for one reason: across a portal the menu
 * is not a DOM descendant of its button, so the usual "is the click inside my ref?" test counts a
 * click on the button as *outside*, closes the menu, and lets the button's own handler reopen it —
 * a menu that cannot be closed by the control that opened it. Both elements are checked here.
 * The listener is still capture-phase, because React Flow's pane calls `stopPropagation`.
 */

const subscribeToNothing = () => () => {};
const useIsClient = () =>
    useSyncExternalStore(subscribeToNothing, () => true, () => false);

/** Keeps the menu on screen when the button is near an edge. */
const MARGIN = 8;
const ESTIMATED_WIDTH = 210;

/**
 * Where the menu hangs from: the button, and its screen rect *at the moment it was opened*.
 *
 * The caller measures and passes both, rather than the menu measuring for itself. Measuring here
 * would mean a `setState` inside an effect, which the lint config rejects outright — and it is the
 * right call regardless: the anchor lives on a canvas that pans and zooms, so a rect is only ever
 * true for an instant, and the honest lifetime for it is "until something moves", which is exactly
 * when this menu closes.
 */
export interface MenuAnchor {
    el: HTMLElement;
    rect: DOMRect;
}

interface AnchoredMenuProps {
    /** Null when closed. */
    anchor: MenuAnchor | null;
    onClose: () => void;
    children: React.ReactNode;
    label: string;
}

export const AnchoredMenu = ({ anchor, onClose, children, label }: AnchoredMenuProps) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const isClient = useIsClient();

    /**
     * `onClose` reached through a ref, so the listeners below can depend only on `anchor`.
     *
     * This is load-bearing and the reason is not obvious. Callers pass an inline arrow, so
     * `onClose` is a new function on every render — and with it in the dependency array the
     * listeners were torn down and re-added on *every* render. A real Escape keypress on a node
     * button makes React Flow re-render that node while the event is still bubbling, so the
     * teardown ran before the event reached `document` and the handler never fired. Escape
     * silently did nothing; a synthetically dispatched Escape worked, because nothing re-rendered
     * in between, which is exactly the sort of difference that hides a bug from a test.
     */
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        if (!anchor) return;
        const handleClose = () => onCloseRef.current();

        const onPointerDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (menuRef.current?.contains(target)) return;
            // The button is not a descendant of the portalled menu, so it has to be excluded
            // explicitly or it would toggle twice on one click.
            if (anchor.el.contains(target)) return;
            handleClose();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); handleClose(); }
        };
        // The canvas pans under a menu that is anchored to a fixed screen position, so the two
        // would drift apart. Closing is better than following.
        const onCanvasMove = () => handleClose();

        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', onCanvasMove);
        window.addEventListener('wheel', onCanvasMove, { passive: true });
        return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', onCanvasMove);
            window.removeEventListener('wheel', onCanvasMove);
        };
    }, [anchor]);

    if (!isClient || !anchor) return null;
    const box = anchor.rect;

    // Right-aligned with the button, flipped above it when there is no room below.
    const left = Math.min(
        Math.max(MARGIN, box.right - ESTIMATED_WIDTH),
        window.innerWidth - ESTIMATED_WIDTH - MARGIN
    );
    const below = box.bottom + 6;
    const openUp = below + 260 > window.innerHeight && box.top > 280;

    return createPortal(
        <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            // `nodrag` so a mousedown in the menu does not drag the table out from under it.
            className="nodrag fixed z-[95] min-w-[13rem] rounded-lg border border-line bg-surface
                       py-1 shadow-glow-lg anim-menu-in cursor-default"
            style={{
                left,
                top: openUp ? box.top - 6 : below,
                transform: openUp ? 'translateY(-100%)' : undefined,
            }}
            onClick={e => e.stopPropagation()}
        >
            {children}
        </div>,
        document.body
    );
};

/** One row in an {@link AnchoredMenu}. Icon, label, and an optional trailing badge. */
export const MenuItem = ({
    icon, children, onClick, badge, tone = 'default', description,
}: {
    icon: React.ReactNode;
    children: React.ReactNode;
    onClick: () => void;
    badge?: React.ReactNode;
    tone?: 'default' | 'danger';
    description?: string;
}) => (
    <button
        type="button"
        role="menuitem"
        onClick={e => { e.stopPropagation(); onClick(); }}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors ${
            tone === 'danger'
                ? 'text-red-600 hover:bg-red-50'
                : 'text-ink-700 hover:bg-ink-100'
        }`}
    >
        <span className={`shrink-0 ${tone === 'danger' ? 'text-red-500' : 'text-ink-400'}`}>{icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{children}</span>
            {description && (
                <span className="block truncate text-[10px] text-ink-400">{description}</span>
            )}
        </span>
        {badge}
    </button>
);

export const MenuSeparator = () => <div className="my-1 h-px bg-ink-100" />;

export const MenuLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-ink-400">
        {children}
    </p>
);
