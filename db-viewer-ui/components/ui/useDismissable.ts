"use client";

import { useEffect, useRef } from 'react';

/**
 * Closes a dropdown on an outside click or Escape.
 *
 * Shared by the editor's app bar and the landing nav, which both hang a menu off a button. It is
 * one hook rather than a copy in each because the two behaviours have to stay identical: a menu
 * that closes on Escape in one place and not the other is the kind of difference nobody notices
 * until they are relying on it.
 *
 * `mousedown` rather than `click`, so the menu is gone before whatever was clicked behind it
 * reacts — a `click` listener fires after the target has already handled the press.
 *
 * Listened for in the **capture** phase, which is load-bearing rather than tidiness: React Flow's
 * pane calls `stopPropagation()` on its own pointer handlers, so a bubble-phase listener never
 * hears a click that lands on a canvas. Both menus sit directly above one — the landing nav over
 * the hero diagram, the editor's File menu over the schema — and both stayed stubbornly open when
 * you clicked the thing you were obviously trying to get back to.
 *
 * @returns a ref to put on the element that wraps both the trigger and the menu
 */
export const useDismissable = <T extends HTMLElement = HTMLDivElement>(
    isOpen: boolean,
    close: () => void,
) => {
    const ref = useRef<T>(null);

    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen, close]);

    return ref;
};
