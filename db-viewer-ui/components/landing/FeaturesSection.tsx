"use client";

import React, { useCallback, useState } from 'react';
import {
    Network, FileUp, Table2, PencilRuler, Share2, Download,
    StickyNote, Layers, ShieldCheck, Search, Gauge, Moon, Route, PlayCircle,
} from 'lucide-react';
import { Reveal } from './Reveal';
import { FEATURE_DEMOS, FeatureDemoId } from './FeatureDemos';
import { EngineBanner } from './EngineBanner';

/**
 * What the app does, shown rather than listed.
 *
 * This was a bento grid of nine cards, each with a still drawing. It read well and it argued
 * badly: for a tool whose entire pitch is that you can watch a schema change, a static tile
 * asks the reader to imagine the part that matters. The section is now a rail of features
 * beside one panel that plays the selected one — hover or focus a row and the panel shows that
 * action happening.
 *
 * The panel is sticky, so the demonstration stays in view while the rail is read. Below `lg`
 * there is no room for two columns, so each row carries its own demonstration underneath it
 * and the layout becomes an ordinary list.
 */

interface Feature {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    demo: FeatureDemoId;
    title: string;
    body: string;
}

const FEATURES: Feature[] = [
    {
        icon: Route,
        demo: 'relationships',
        title: 'Relationships you can actually follow',
        body: 'Foreign keys are drawn as right-angled edges that route around the tables in the '
            + 'way rather than through them — the difference between a diagram and a ball of wool '
            + 'once you are past a couple of dozen tables.',
    },
    {
        icon: FileUp,
        demo: 'import',
        title: 'An import you get to check first',
        body: 'Picking a file does not import it. You see the tables it would create, the type '
            + 'chosen for every column and why, and real values from the file — then you correct '
            + 'whatever is wrong. A postcode of 01234 never silently becomes 1234.',
    },
    {
        icon: Search,
        demo: 'search',
        title: 'Find anything on a big canvas',
        body: 'Ctrl+F finds a table or a column, moves the canvas to it and turns everything else '
            + 'down. A minimap in the corner keeps the rest of the schema in view.',
    },
    {
        icon: PencilRuler,
        demo: 'schemaEdit',
        title: 'Edit the schema live',
        body: 'Create tables, add columns, rename or retype them. Every action runs real DDL '
            + 'against a real database, and the diagram is read back from what it did.',
    },
    {
        icon: Table2,
        demo: 'dataEdit',
        title: 'Edit the data too',
        body: 'Change a single cell, or a whole row at once, without leaving the canvas.',
    },
    {
        icon: ShieldCheck,
        demo: 'safeDelete',
        title: 'Deletes that refuse to break things',
        body: 'Dropping a table another one still points at is refused — and it names the tables '
            + 'that depend on it, instead of leaving dangling references behind.',
    },
    {
        icon: Layers,
        demo: 'isolation',
        title: 'Every file is its own database',
        body: 'Open as many as you like. Each is fully isolated, so two files can both have a '
            + 'users table without ever colliding.',
    },
    {
        icon: Download,
        demo: 'export',
        title: 'Export for docs, not just for databases',
        body: 'A SQL script written for the engine you name, or Mermaid and DBML text that render '
            + 'as diagrams in a GitHub README, a Jira ticket or dbdiagram.io.',
    },
    {
        icon: StickyNote,
        demo: 'notes',
        title: 'Leave notes on a table',
        body: 'A to-do list per table, stored with the file. Tick items off when you come back.',
    },
    {
        icon: Share2,
        demo: 'share',
        title: 'Share a read-only link',
        body: 'Anyone with the link can explore the diagram — without an account, and without '
            + 'being able to change anything.',
    },
];

/**
 * Kept beside the features rather than in a marketing banner of its own.
 *
 * The three things a developer silently checks before trusting a browser-based canvas, answered
 * with what the app actually does about each.
 */
const ASSURANCES = [
    {
        icon: Gauge,
        title: 'Built for schemas that are actually big',
        body: 'The canvas is React Flow, the same renderer behind most production node editors. '
            + 'Tables are real DOM nodes, edges are routed only against the tables near them, and '
            + 'the row preview per table is capped — so a hundred-table dump pans and zooms at '
            + 'the same speed as a five-table one.',
    },
    {
        icon: Moon,
        title: 'Made for long sessions',
        body: 'A proper dark theme across the whole product — canvas, dialogs, docs and all — not '
            + 'an inverted canvas on a white page. Light, dark, or follow the system, remembered '
            + 'between visits and applied before the page paints.',
    },
    {
        icon: Network,
        title: 'Read from the database, not drawn by hand',
        body: 'The diagram is queried from live metadata every time it changes. It cannot drift '
            + 'from the schema, because it is the schema — if a relationship line is missing, the '
            + 'foreign key is missing too.',
    },
];

export const FeaturesSection = () => {
    const [active, setActive] = useState<number>(0);

    // Hover is the primary gesture and focus is the keyboard equivalent; both simply select.
    // There is no click handler on purpose - a row is not a link, and making it one would
    // promise a destination that does not exist.
    const select = useCallback((index: number) => setActive(index), []);

    const ActiveDemo = FEATURE_DEMOS[FEATURES[active].demo];

    // No `overflow-hidden` on the section, deliberately: an ancestor with a clipped overflow
    // becomes the scroll container for anything `position: sticky` inside it, and since that
    // ancestor never scrolls, the demo panel stops sticking and scrolls away with the rail —
    // silently, because the CSS is still there and still ignored. Nothing here overflows anyway;
    // the only decorative blur lives inside the engine banner, which clips itself.
    return (
        <section id="features" className="section-wash scroll-mt-28 py-20 sm:py-28">
            <div className="mx-auto max-w-6xl px-6">

                <Reveal className="mx-auto mb-12 max-w-2xl text-center">
                    <span className="mb-4 inline-block rounded-full border border-brand-200/70 bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700 shadow-sm">
                        Features
                    </span>
                    <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
                        Everything happens against{' '}
                        <span className="brand-text-gradient">a real database</span>
                    </h2>
                    <p className="mt-4 leading-relaxed text-ink-600">
                        This is not a drawing tool. Your file is an actual database, the diagram is
                        read back from its live metadata, and every edit you make is executed SQL.
                        Hover a feature to watch it happen.
                    </p>
                </Reveal>

                <Reveal className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
                    {/* The rail */}
                    <ul className="space-y-2">
                        {FEATURES.map((feature, index) => {
                            const { icon: Icon, title, body, demo } = feature;
                            const Demo = FEATURE_DEMOS[demo];
                            const isActive = index === active;

                            return (
                                <li key={title}>
                                    <button
                                        type="button"
                                        onMouseEnter={() => select(index)}
                                        onFocus={() => select(index)}
                                        onClick={() => select(index)}
                                        aria-pressed={isActive}
                                        className={`w-full rounded-xl border p-4 text-left transition-all ${
                                            isActive
                                                ? 'border-brand-300 bg-surface shadow-glow-md'
                                                : 'border-transparent hover:border-[var(--surface-line)] hover:bg-surface/60'
                                        }`}
                                    >
                                        <span className="flex items-start gap-3">
                                            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                                                isActive
                                                    ? 'border-transparent bg-[image:linear-gradient(135deg,var(--brand-600),var(--brand-violet))]'
                                                    : 'border-brand-100 bg-brand-50'
                                            }`}>
                                                <Icon size={15} className={isActive ? 'text-white' : 'text-brand-600'} />
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block font-semibold text-ink-900">{title}</span>
                                                <span className="mt-1 block text-sm leading-relaxed text-ink-500">{body}</span>
                                            </span>
                                        </span>

                                        {/* Below lg the panel has nowhere to sit, so the selected
                                            row grows its own — and says so, because a touch screen
                                            has no hover to discover it with. Ten scenes animating
                                            at once would be both noisy and wasteful, so only the
                                            selected one plays. */}
                                        <span className="lg:hidden">
                                            {isActive ? (
                                                <span className="mt-3 block h-[150px]">
                                                    <Demo />
                                                </span>
                                            ) : (
                                                <span className="mt-2 flex items-center gap-1.5 pl-11 text-xs font-semibold text-brand-700">
                                                    <PlayCircle size={13} /> See it
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    {/* The panel. Sticky, so the demonstration stays put while the rail is read. */}
                    <div className="hidden lg:block lg:sticky lg:top-28">
                        <div className="surface-card overflow-hidden rounded-2xl border p-3 shadow-glow-md">
                            <div className="h-[240px]">
                                {/* Keyed on the feature so switching restarts the loop from its
                                    first frame rather than joining it half way through. */}
                                <ActiveDemo key={FEATURES[active].demo} />
                            </div>
                            <p className="px-1 pb-1 pt-3 text-xs leading-relaxed text-ink-500">
                                <span className="font-semibold text-ink-700">{FEATURES[active].title}.</span>{' '}
                                Everything above is the real interface, drawn with the app&apos;s own
                                components — not a recording.
                            </p>
                        </div>
                    </div>
                </Reveal>

                <EngineBanner />

                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                    {ASSURANCES.map(({ icon: Icon, title, body }, i) => (
                        <Reveal
                            key={title}
                            delay={i * 80}
                            className="surface-card rounded-2xl border p-5"
                        >
                            <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-brand-100 bg-brand-50">
                                <Icon size={16} className="text-brand-600" />
                            </span>
                            <h3 className="font-semibold text-ink-900">{title}</h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{body}</p>
                        </Reveal>
                    ))}
                </div>
            </div>
        </section>
    );
};
