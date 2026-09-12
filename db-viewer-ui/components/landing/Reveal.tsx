"use client";

import React, { useEffect, useRef, useState } from 'react';

/**
 * Tracks whether an element has scrolled into view.
 *
 * Typed on `HTMLElement` rather than a specific tag so one hook serves every wrapper;
 * `Reveal` below renders through `React.ElementType`, which keeps the ref assignable
 * whichever tag the caller asks for.
 */
export const useInView = (options?: IntersectionObserverInit) => {
    const ref = useRef<HTMLElement | null>(null);
    const [isInView, setInView] = useState(false);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        // Without IntersectionObserver, show everything rather than nothing.
        if (typeof IntersectionObserver === 'undefined') {
            const frame = requestAnimationFrame(() => setInView(true));
            return () => cancelAnimationFrame(frame);
        }

        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setInView(true);
                // One-shot: re-animating on every scroll past is distracting.
                observer.disconnect();
            }
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15, ...options });

        observer.observe(node);
        return () => observer.disconnect();
    }, [options]);

    return { ref, isInView };
};

interface RevealProps {
    children: React.ReactNode;
    /** Stagger, in ms, so a grid cascades rather than snapping in as one block. */
    delay?: number;
    className?: string;
    as?: 'div' | 'li' | 'section' | 'article';
}

/**
 * Reveals its children once they scroll into view.
 *
 * The hidden state lives in CSS behind a `prefers-reduced-motion: no-preference` guard
 * (see globals.css), so a visitor who has asked for less motion sees the content straight
 * away instead of waiting on an animation that will never run.
 */
export const Reveal = ({ children, delay = 0, className = '', as = 'div' }: RevealProps) => {
    const { ref, isInView } = useInView();
    const Tag = as as React.ElementType;

    return (
        <Tag
            ref={ref}
            className={`reveal ${isInView ? 'is-visible' : ''} ${className}`}
            style={{ animationDelay: `${delay}ms` }}
        >
            {children}
        </Tag>
    );
};

/**
 * Counts up to a number when it scrolls into view.
 *
 * Driven by requestAnimationFrame against a wall-clock deadline rather than a fixed
 * per-frame step, so the duration holds regardless of refresh rate. Reduced motion collapses
 * the duration to zero instead of skipping the loop, which keeps the state update out of the
 * effect body itself.
 */
export const CountUp = ({ to, duration = 1100, suffix = '' }: {
    to: number;
    duration?: number;
    suffix?: string;
}) => {
    const { ref, isInView } = useInView();
    const [value, setValue] = useState(0);

    useEffect(() => {
        if (!isInView) return;

        const reduced = typeof window !== 'undefined'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const totalMs = reduced ? 0 : duration;

        let frame = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const progress = totalMs === 0 ? 1 : Math.min((now - start) / totalMs, 1);
            // Ease-out cubic: fast first, settling gently on the final number.
            setValue(Math.round(to * (1 - Math.pow(1 - progress, 3))));
            if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [isInView, to, duration]);

    return (
        <span ref={ref as React.Ref<HTMLSpanElement>}>
            {value}{suffix}
        </span>
    );
};
