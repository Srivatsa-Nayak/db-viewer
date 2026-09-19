"use client";

import React from 'react';
import { FileCode2, Table2, Network, ChevronRight } from 'lucide-react';
import { Reveal, useInView } from './Reveal';
import { EditorMockup } from './EditorMockup';

/**
 * The import pipeline, ending in the editor at full size.
 *
 * The three steps run across the top as a numbered row, which leaves the whole width for the
 * result — the point of the section is the diagram, so it gets the space. The mockup only
 * starts assembling once the section is actually in view, so the animation is not already
 * over by the time anyone scrolls to it.
 */

const STEPS = [
    {
        icon: FileCode2,
        title: 'Drop in your file',
        body: 'A .csv or a .sql dump — phpMyAdmin exports included, keys and all.',
    },
    {
        icon: Table2,
        title: 'Tables are created for real',
        body: 'Every statement runs against a real database. Types come from the schema, not a guess.',
    },
    {
        icon: Network,
        title: 'Relationships are read back',
        body: 'Foreign keys are queried from live metadata and drawn. What you see is what is there.',
    },
];

export const HowItWorks = () => {
    const { ref, isInView } = useInView({ threshold: 0.08 });

    return (
        <section className="section-wash-tinted overflow-hidden border-y border-[var(--surface-line)] py-20 sm:py-28">
            <div className="mx-auto max-w-6xl px-6">

                <Reveal className="mx-auto mb-12 max-w-2xl text-center">
                    <span className="mb-4 inline-block rounded-full border border-brand-200/70 bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700 shadow-sm">
                        How it works
                    </span>
                    <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
                        From a file to a diagram,{' '}
                        <span className="brand-text-gradient">in one step</span>
                    </h2>
                    <p className="mt-4 leading-relaxed text-ink-600">
                        There is no import wizard and no mapping screen. Your file becomes a database,
                        and the diagram is read back out of it.
                    </p>
                </Reveal>

                {/* Steps, as a row across the top. The chevrons are their own grid items, so
                    nothing has to be positioned into the gap by hand. */}
                <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-stretch">
                    {STEPS.map((step, i) => {
                        const Icon = step.icon;
                        return (
                            <React.Fragment key={step.title}>
                                <Reveal
                                    delay={i * 90}
                                    className="surface-card group relative flex-1 overflow-hidden rounded-xl border p-5"
                                >
                                    {/* The step number, set large and faint behind the content. */}
                                    <span
                                        aria-hidden
                                        className="pointer-events-none absolute -right-2 -top-3 text-[64px] font-bold leading-none text-brand-600/[0.06]"
                                    >
                                        {i + 1}
                                    </span>

                                    <div className="relative">
                                        <div className="mb-3 flex items-center gap-3">
                                            <span className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm transition-transform duration-300 group-hover:scale-105">
                                                <Icon size={18} />
                                            </span>
                                            <span className="text-[11px] font-bold uppercase tracking-widest text-brand-500">
                                                Step {i + 1}
                                            </span>
                                        </div>
                                        <h3 className="font-semibold text-ink-900">{step.title}</h3>
                                        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
                                    </div>
                                </Reveal>

                                {i < STEPS.length - 1 && (
                                    <div aria-hidden className="hidden shrink-0 items-center sm:flex">
                                        <ChevronRight size={18} className="text-brand-300" />
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>

                {/* The result, at full width */}
                <div ref={ref as React.Ref<HTMLDivElement>} className="relative">
                    {/* A coloured bloom behind the frame, so it sits in light rather than on a flat panel. */}
                    <div
                        aria-hidden
                        className="pointer-events-none absolute -inset-x-8 -inset-y-6 rounded-[2rem] bg-gradient-to-tr from-brand-500/12 via-indigo-500/10 to-sky-400/12 blur-2xl"
                    />
                    <div className="shadow-glow-lg relative overflow-hidden rounded-2xl ring-1 ring-[var(--surface-line)]">
                        {/* `playing` gates the CSS animations until the frame is on screen. */}
                        <EditorMockup playing={isInView} />
                    </div>
                </div>

                <p className="mt-6 text-center text-sm text-ink-500">
                    Eight tables and every foreign key between them — read from the database, not drawn by hand.
                </p>
            </div>
        </section>
    );
};
