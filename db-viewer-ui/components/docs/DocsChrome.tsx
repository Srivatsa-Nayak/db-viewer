"use client";

import React, { useEffect, useState } from 'react';

/**
 * Page furniture for the docs: the contents rail, and the small primitives the prose is
 * built from (sections, numbered steps, action tables, callouts, keycaps).
 *
 * The rail tracks the heading you are actually reading rather than the last one you passed,
 * which is why it observes a band near the top of the viewport instead of the whole screen.
 */

export interface DocsGroup {
    title: string;
    items: { id: string; label: string }[];
}

/* ── Contents rail ──────────────────────────────────────────────────────────── */

export const DocsSidebar = ({ groups }: { groups: DocsGroup[] }) => {
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        const ids = groups.flatMap(g => g.items.map(i => i.id));

        const observer = new IntersectionObserver(
            entries => {
                // Prefer whichever observed heading is nearest the top of the reading band.
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
                if (visible) setActiveId(visible.target.id);
            },
            // Excludes the area behind the fixed nav, and ignores the bottom half, so a
            // heading only becomes "current" once it has actually reached reading position.
            { rootMargin: '-120px 0px -60% 0px', threshold: 0 }
        );

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [groups]);

    return (
        <nav aria-label="Contents" className="space-y-7">
            {groups.map(group => (
                <div key={group.title}>
                    <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-widest text-ink-400">
                        {group.title}
                    </p>
                    <ul className="space-y-0.5">
                        {group.items.map(item => {
                            const isActive = activeId === item.id;
                            return (
                                <li key={item.id}>
                                    <a
                                        href={`#${item.id}`}
                                        aria-current={isActive ? 'location' : undefined}
                                        className={`block rounded-lg border-l-2 px-3 py-1.5 text-[13.5px] transition-colors ${
                                            isActive
                                                ? 'border-brand-600 bg-brand-50/70 font-semibold text-brand-700'
                                                : 'border-transparent text-ink-600 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900'
                                        }`}
                                    >
                                        {item.label}
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );
};

/* ── Prose primitives ───────────────────────────────────────────────────────── */

/** A documented topic. `scroll-mt` clears the fixed nav when jumped to from the rail. */
export const Section = ({ id, title, lead, children }: {
    id: string;
    title: string;
    lead?: React.ReactNode;
    children: React.ReactNode;
}) => (
    <section id={id} className="scroll-mt-32 border-t border-ink-200/80 pt-12 first:border-0 first:pt-0">
        <h2 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h2>
        {lead && <p className="mt-3 max-w-2xl leading-relaxed text-ink-600">{lead}</p>}
        <div className="mt-5 space-y-4 leading-relaxed text-ink-600">{children}</div>
    </section>
);

/** Numbered instructions. Rendered as a real <ol> so it reads correctly unstyled too. */
export const Steps = ({ children }: { children: React.ReactNode }) => (
    <ol className="space-y-3">{children}</ol>
);

export const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
    <li className="flex gap-3.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
            {n}
        </span>
        <span className="min-w-0 flex-1 pt-0.5">{children}</span>
    </li>
);

/**
 * "What each action does" — the shape most of these docs take. A real table so the
 * control and its effect stay on one line together; it scrolls rather than squashing.
 */
export const ActionTable = ({ caption, rows }: {
    caption?: string;
    rows: { icon?: React.ReactNode; action: string; effect: React.ReactNode }[];
}) => (
    <div className="surface-card overflow-hidden rounded-xl border">
        {caption && (
            <p className="border-b border-ink-200/80 bg-ink-50/80 px-4 py-2.5 text-[12.5px] font-semibold text-ink-700">
                {caption}
            </p>
        )}
        <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13.5px]">
                <thead>
                    <tr className="border-b border-ink-200/80 text-[11px] uppercase tracking-wide text-ink-400">
                        <th scope="col" className="px-4 py-2 font-semibold">Control</th>
                        <th scope="col" className="px-4 py-2 font-semibold">What it does</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.action} className="border-b border-ink-100 last:border-0 align-top">
                            <td className="whitespace-nowrap px-4 py-3">
                                <span className="flex items-center gap-2 font-medium text-ink-900">
                                    {row.icon && <span className="text-brand-600">{row.icon}</span>}
                                    {row.action}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-ink-600">{row.effect}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

type CalloutTone = 'note' | 'warn';

/** A short aside. Two tones only — anything more and they stop being read. */
export const Callout = ({ tone = 'note', title, children }: {
    tone?: CalloutTone;
    title?: string;
    children: React.ReactNode;
}) => {
    const style = tone === 'warn'
        ? 'tone-warning'
        : 'tone-info';
    return (
        <div className={`rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed ${style}`}>
            {title && <p className="mb-1 font-semibold">{title}</p>}
            <div className={tone === 'warn' ? 'text-tone-warn-ink' : 'text-brand-800'}>{children}</div>
        </div>
    );
};

/** Inline UI label or identifier. */
export const UI = ({ children }: { children: React.ReactNode }) => (
    <span className="rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[12.5px] font-medium text-ink-800">
        {children}
    </span>
);

/** Inline code — column names, types, SQL. Uses the monospace face. */
export const Code = ({ children }: { children: React.ReactNode }) => (
    <code className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[12.5px] text-brand-700">
        {children}
    </code>
);

/** A keyboard key. */
export const Key = ({ children }: { children: React.ReactNode }) => (
    <kbd className="rounded-md border border-ink-300 border-b-2 bg-surface px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-ink-700">
        {children}
    </kbd>
);
