"use client";

import React from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowLeftRight } from 'lucide-react';
import { Reveal } from './Reveal';
import { ENGINES } from './DatabaseLogos';

/**
 * "Yes, yours is supported" — answered before it is asked.
 *
 * A developer evaluating a schema tool scans for their own engine's mark before reading a word
 * of copy, and not finding it is a reason to leave rather than a reason to look harder. So the
 * four engines get a banner of their own with their actual marks on it, rather than a line in a
 * feature card saying "multi-dialect support".
 *
 * The claim is deliberately two-directional, because that is what is actually implemented: a
 * dump written for any of these is detected and translated on the way in, and an export is
 * *rewritten* for whichever one you name on the way out. "Compatible with" would be vaguer and
 * would promise less.
 */
export const EngineBanner = () => (
    <Reveal className="mt-14">
        <div className="surface-card relative overflow-hidden rounded-2xl border p-6 sm:p-8">
            <span
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-brand-400/15 blur-3xl"
            />

            <div className="relative">
                <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200/70 bg-surface px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                            <ArrowLeftRight size={11} /> Both directions
                        </span>
                        <h3 className="mt-3 text-2xl font-bold tracking-tight text-ink-900">
                            Bring a dump from any of these.{' '}
                            <span className="brand-text-gradient">Take one back to any of them.</span>
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
                            The dialect is detected from the file itself — you never pick it. On the
                            way out you do: the script is rebuilt in that engine&apos;s own syntax,
                            because <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-700">SERIAL</code>,{' '}
                            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-700">IDENTITY(1,1)</code>,{' '}
                            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-700">AUTO_INCREMENT</code> and{' '}
                            <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[0.85em] text-ink-700">AUTOINCREMENT</code>{' '}
                            are four spellings of one idea and no engine accepts another&apos;s.
                        </p>
                    </div>
                </div>

                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {ENGINES.map(({ id, name, colour, note, Logo }) => (
                        <li
                            key={id}
                            className="group flex flex-col gap-3 rounded-xl border border-[var(--surface-line)] bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-glow-md"
                        >
                            <span className="flex items-center gap-2.5">
                                {/* The mark keeps its own brand colour — a monochrome row of logos
                                    is harder to scan, and recognition is the entire job here. */}
                                <span
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                                    style={{ backgroundColor: `${colour}1f`, color: colour }}
                                >
                                    <Logo className="h-5 w-5" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate font-semibold text-ink-900">{name}</span>
                                    <span className="block text-[11px] font-medium text-emerald-600">
                                        import · export
                                    </span>
                                </span>
                            </span>
                            <span className="text-[12.5px] leading-snug text-ink-500">{note}</span>
                        </li>
                    ))}
                </ul>

                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <span className="text-ink-500">
                        SQLite and portable ANSI SQL are export targets too.
                    </span>
                    <Link
                        href="/docs#dialects"
                        className="inline-flex items-center gap-1.5 font-semibold text-brand-700 transition-colors hover:text-brand-600"
                    >
                        See exactly what is supported <ArrowRight size={14} />
                    </Link>
                </div>
            </div>
        </div>
    </Reveal>
);
