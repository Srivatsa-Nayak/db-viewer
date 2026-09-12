"use client";

import React from 'react';
import {
    Network, FileUp, Table2, PencilRuler, Share2, Download,
    StickyNote, Layers, ShieldCheck,
} from 'lucide-react';
import { Reveal } from './Reveal';
import {
    ArtImport, ArtRelationships, ArtIsolation, ArtEditing,
    ArtSafeDelete, ArtShare, ArtNotes, ArtExport, ArtSchemaEdit,
} from './FeatureArt';

/**
 * What the app does, in the order someone would actually meet it: get data in, see it,
 * change it, get it back out.
 *
 * Laid out as a bento grid rather than a uniform three-by-three. Nine identical tiles read as
 * a list — the eye scans them and takes nothing in. Giving the two features that carry the
 * product (relationships, and one file per database) double width creates a hierarchy, and
 * the varied rhythm makes the section something you look at rather than skim.
 *
 * `span` is the width on a six-column grid; rows are composed to total six.
 */
const FEATURES = [
    {
        icon: Network,
        art: ArtRelationships,
        title: 'See the relationships',
        body: 'Foreign keys are drawn as live edges between tables. Drag the tables around to '
            + 'arrange the diagram; your layout is remembered between visits.',
        span: 'lg:col-span-4',
        wide: true,
    },
    {
        icon: FileUp,
        art: ArtImport,
        title: 'Import CSV or SQL',
        body: 'Column types are inferred from a .csv, and a .sql dump keeps its keys — '
            + 'phpMyAdmin exports included.',
        span: 'lg:col-span-2',
    },
    {
        icon: PencilRuler,
        art: ArtSchemaEdit,
        title: 'Edit the schema live',
        body: 'Create tables, add columns, rename or retype them. Every action runs real DDL.',
        span: 'lg:col-span-2',
    },
    {
        icon: Table2,
        art: ArtEditing,
        title: 'Edit the data too',
        body: 'Change a single cell, or a whole row at once, without leaving the canvas.',
        span: 'lg:col-span-2',
    },
    {
        icon: ShieldCheck,
        art: ArtSafeDelete,
        title: 'Deletes that refuse to break things',
        body: 'Dropping a table another one still points at is refused — and it names them.',
        span: 'lg:col-span-2',
    },
    {
        icon: StickyNote,
        art: ArtNotes,
        title: 'Leave notes on a table',
        body: 'A to-do list per table, stored with the file. Tick items off when you return.',
        span: 'lg:col-span-2',
    },
    {
        icon: Layers,
        art: ArtIsolation,
        title: 'Every file is its own database',
        body: 'Open as many as you like. Each is fully isolated, so two files can both have a '
            + 'users table without ever colliding.',
        span: 'lg:col-span-4',
        wide: true,
    },
    {
        icon: Share2,
        art: ArtShare,
        title: 'Share a read-only link',
        body: 'Anyone with the link can explore the diagram — without an account, and without '
            + 'being able to change anything.',
        span: 'lg:col-span-3',
    },
    {
        icon: Download,
        art: ArtExport,
        title: 'Export SQL or a diagram',
        body: 'A runnable script, or a PNG of the whole canvas for a doc or a pull request.',
        span: 'lg:col-span-3',
    },
];

export const FeaturesSection = () => (
    <section id="features" className="section-wash scroll-mt-28 py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">

            <Reveal className="mx-auto mb-14 max-w-2xl text-center">
                <span className="mb-4 inline-block rounded-full border border-blue-200/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700 shadow-sm">
                    Features
                </span>
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                    Everything happens against{' '}
                    <span className="brand-text-gradient">a real database</span>
                </h2>
                <p className="mt-4 leading-relaxed text-slate-600">
                    This is not a drawing tool. Your file is an actual database, the diagram is
                    read back from its live metadata, and every edit you make is executed SQL.
                    Hover a card to see what each one means.
                </p>
            </Reveal>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-6">
                {FEATURES.map(({ icon: Icon, art: Art, title, body, span, wide }, i) => (
                    <Reveal
                        key={title}
                        // Staggered so the grid cascades instead of snapping in as one block.
                        delay={Math.min(i, 5) * 70}
                        className={`group lift-card surface-card overflow-hidden rounded-2xl border hover:border-blue-300 ${span}`}
                    >
                        {wide ? (
                            // Wide tiles read side-by-side, so the drawing gets real room.
                            <div className="flex h-full flex-col gap-4 p-6 sm:flex-row sm:items-center">
                                <div className="sm:w-[46%] sm:shrink-0">
                                    <span className="lift-icon mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 group-hover:border-transparent group-hover:bg-[image:linear-gradient(135deg,#2563eb,#4f46e5)]">
                                        <Icon size={16} className="text-blue-600 transition-colors group-hover:text-white" />
                                    </span>
                                    <h3 className="font-semibold text-slate-900">{title}</h3>
                                    <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{body}</p>
                                </div>
                                <div className="min-w-0 flex-1 rounded-xl border border-[var(--surface-line)] bg-gradient-to-b from-[#eef3fd] to-white px-3 pt-3 pb-1">
                                    <Art />
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col">
                                <div className="border-b border-[var(--surface-line)] bg-gradient-to-b from-[#eef3fd] to-white px-4 pt-4 pb-2">
                                    <Art />
                                </div>
                                <div className="flex-1 p-5">
                                    <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-900">
                                        <span className="lift-icon inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 group-hover:border-transparent group-hover:bg-[image:linear-gradient(135deg,#2563eb,#4f46e5)]">
                                            <Icon size={14} className="text-blue-600 transition-colors group-hover:text-white" />
                                        </span>
                                        {title}
                                    </h3>
                                    <p className="text-sm leading-relaxed text-slate-500">{body}</p>
                                </div>
                            </div>
                        )}
                    </Reveal>
                ))}
            </div>
        </div>
    </section>
);
