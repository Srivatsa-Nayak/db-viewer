"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
    Table2, Share2, Loader2, AlertCircle, ArrowRight, Eye, Star, Network,
} from 'lucide-react';
import { dbService, SchemaTemplate } from '@/services/api';
import { CountUp, Reveal } from './Reveal';
import { TemplateDiagram } from './TemplateDiagram';
import { Modal, GhostButton, PrimaryButton } from '@/components/ui/Modal';

interface TemplatesSectionProps {
    /** Creates a workspace from the template and navigates to the editor. */
    onUse: (template: SchemaTemplate) => Promise<void> | void;
}

const ALL = 'All';

/**
 * The template catalogue.
 *
 * Everything shown here - names, descriptions, categories, table lists, counts - comes from
 * `GET /templates`. This component only renders; adding a template is a backend-only change.
 */
export const TemplatesSection = ({ onUse }: TemplatesSectionProps) => {
    const [templates, setTemplates] = useState<SchemaTemplate[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [activeCategory, setActiveCategory] = useState(ALL);
    const [isLoading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [busyId, setBusyId] = useState<string | null>(null);
    const [preview, setPreview] = useState<SchemaTemplate | null>(null);
    const [isPreviewLoading, setPreviewLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        dbService.listTemplates()
            .then(({ templates, categories }) => {
                if (cancelled) return;
                setTemplates(templates);
                setCategories(categories);
            })
            .catch(() => {
                if (!cancelled) setError('Templates could not be loaded. Is the backend running?');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const visible = useMemo(
        () => activeCategory === ALL
            ? templates
            : templates.filter(t => t.category === activeCategory),
        [templates, activeCategory]
    );

    const handleUse = async (template: SchemaTemplate) => {
        setBusyId(template.id);
        try {
            await onUse(template);
        } finally {
            setBusyId(null);
        }
    };

    const openPreview = async (template: SchemaTemplate) => {
        setPreview(template);
        // The catalogue listing carries only counts and table names; the drawn schema comes
        // from the detail endpoint, so it has to be fetched before there is a diagram to show.
        if (!template.schema) {
            setPreviewLoading(true);
            try {
                setPreview(await dbService.getTemplate(template.id));
            } catch {
                // Keep the dialog open — the diagram pane shows its own fallback.
            } finally {
                setPreviewLoading(false);
            }
        }
    };

    return (
        <section id="templates" className="section-wash-tinted scroll-mt-28 overflow-hidden py-20 sm:py-28 border-y border-[var(--surface-line)]">
            <div className="mx-auto max-w-6xl px-6">

                <Reveal className="text-center max-w-2xl mx-auto mb-12">
                    <span className="inline-block px-3 py-1 rounded-full border border-brand-200/70 bg-white text-brand-700 text-xs font-semibold tracking-wide uppercase mb-4 shadow-sm">
                        Templates
                    </span>
                    <h2 className="text-3xl sm:text-4xl font-bold text-ink-900 tracking-tight">
                        Start from <span className="brand-text-gradient">a real schema</span>
                    </h2>
                    <p className="mt-4 text-ink-600 leading-relaxed">
                        Each template creates its tables, foreign keys and a few sample rows, so you
                        get a diagram with something in it from the first second. Pick one and edit
                        it into whatever you actually need.
                    </p>

                    {/* Real figures from the catalogue, counted up on scroll - so the section
                        states its own size rather than making a vague claim about it. */}
                    {!isLoading && !error && templates.length > 0 && (
                        <div className="mt-8 flex items-center justify-center gap-8 sm:gap-12">
                            {[
                                { value: templates.length, label: 'templates' },
                                { value: templates.reduce((n, t) => n + t.tableCount, 0), label: 'tables' },
                                { value: templates.reduce((n, t) => n + t.relationshipCount, 0), label: 'relationships' },
                            ].map(stat => (
                                <div key={stat.label} className="text-center">
                                    <div className="brand-text-gradient text-2xl sm:text-3xl font-bold tabular-nums">
                                        <CountUp to={stat.value} />
                                    </div>
                                    <div className="mt-0.5 text-xs uppercase tracking-wide text-ink-400">
                                        {stat.label}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Reveal>

                {/* Category filter */}
                {categories.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2 mb-10">
                        {[ALL, ...categories].map(category => (
                            <button
                                key={category}
                                onClick={() => setActiveCategory(category)}
                                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                                    activeCategory === category
                                        ? 'brand-gradient border-transparent text-white shadow-sm'
                                        : 'bg-white border-[var(--surface-line)] text-ink-600 hover:border-brand-300 hover:text-brand-700'
                                }`}
                            >
                                {category}
                            </button>
                        ))}
                    </div>
                )}

                {isLoading && (
                    // Skeletons rather than a spinner: they reserve the real layout, so the
                    // section does not jump when the catalogue lands.
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="rounded-xl border border-ink-200 bg-white p-5">
                                <div className="mb-3 h-4 w-1/2 animate-pulse rounded bg-ink-200" />
                                <div className="mb-2 h-3 w-full animate-pulse rounded bg-ink-100" />
                                <div className="mb-2 h-3 w-5/6 animate-pulse rounded bg-ink-100" />
                                <div className="mb-4 h-3 w-2/3 animate-pulse rounded bg-ink-100" />
                                <div className="flex gap-1.5">
                                    {[56, 72, 48].map(w => (
                                        <div
                                            key={w}
                                            className="h-4 animate-pulse rounded bg-ink-100"
                                            style={{ width: w }}
                                        />
                                    ))}
                                </div>
                                <div className="mt-5 h-9 w-full animate-pulse rounded-lg bg-ink-100" />
                            </div>
                        ))}
                    </div>
                )}

                {error && !isLoading && (
                    <div className="mx-auto max-w-md flex items-start gap-2.5 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                        <AlertCircle size={16} className="shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </div>
                )}

                {!isLoading && !error && (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {visible.map((template, i) => (
                            <Reveal
                                as="article"
                                key={template.id}
                                delay={Math.min(i, 5) * 70}
                                className="group lift-card surface-card flex flex-col border rounded-xl p-5 hover:border-brand-300"
                            >
                                <div className="flex items-start justify-between gap-3 mb-2">
                                    <h3 className="font-semibold text-ink-900 leading-snug">
                                        {template.name}
                                    </h3>
                                    {template.featured && (
                                        <span
                                            className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold uppercase tracking-wide"
                                            title="A good place to start"
                                        >
                                            <Star size={9} className="fill-amber-500 text-amber-500" />
                                            Popular
                                        </span>
                                    )}
                                </div>

                                <p className="text-sm text-ink-500 leading-relaxed flex-1">
                                    {template.description}
                                </p>

                                <div className="flex items-center gap-4 mt-4 text-xs text-ink-500">
                                    <span className="flex items-center gap-1.5">
                                        <Table2 size={13} className="text-brand-500" />
                                        {template.tableCount} tables
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <Share2 size={13} className="text-brand-500" />
                                        {template.relationshipCount} relationships
                                    </span>
                                </div>

                                {/* A glance at the actual table names, so the card is concrete. */}
                                <div className="flex flex-wrap gap-1.5 mt-3">
                                    {template.tables.slice(0, 4).map(table => (
                                        <span key={table} className="px-2 py-0.5 rounded bg-ink-100 text-ink-600 text-[11px] font-mono transition-colors group-hover:bg-brand-50 group-hover:text-brand-700">
                                            {table}
                                        </span>
                                    ))}
                                    {template.tables.length > 4 && (
                                        <span className="px-2 py-0.5 text-[11px] text-ink-400">
                                            +{template.tables.length - 4} more
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-2 mt-5">
                                    <button
                                        onClick={() => handleUse(template)}
                                        disabled={busyId !== null}
                                        className="brand-gradient brand-gradient-hover flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all"
                                    >
                                        {busyId === template.id
                                            ? <><Loader2 size={14} className="animate-spin" /> Opening...</>
                                            : <>Use template <ArrowRight size={14} /></>}
                                    </button>
                                    <button
                                        onClick={() => openPreview(template)}
                                        className="px-3 py-2 rounded-lg border border-ink-300 text-ink-600 hover:border-brand-400 hover:text-brand-700 transition-colors"
                                        title={`Preview the ${template.name} diagram`}
                                        aria-label={`Preview the ${template.name} diagram`}
                                    >
                                        <Eye size={15} />
                                    </button>
                                </div>
                            </Reveal>
                        ))}
                    </div>
                )}
            </div>

            {/*
                Preview: the diagram, and only the diagram.

                It used to sit beside a pane of the template's raw SQL, which was the wrong
                thing to spend half a dialog on. Someone deciding between twelve templates is
                reading the shape of the schema, not its DDL — and anyone who does want the SQL
                can open the template and export it, where they get their own edits with it
                rather than the pristine original.
            */}
            {preview && (
                <Modal
                    isOpen
                    onClose={() => setPreview(null)}
                    size="full"
                    title={preview.name}
                    subtitle={`${preview.tableCount} tables · ${preview.relationshipCount} relationships · ${preview.category}`}
                    icon={<Network size={17} className="text-brand-600 shrink-0" />}
                    footer={
                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
                            <GhostButton onClick={() => setPreview(null)}>Close</GhostButton>
                            <PrimaryButton onClick={() => { const t = preview; setPreview(null); handleUse(t); }}>
                                Use template <ArrowRight size={14} />
                            </PrimaryButton>
                        </div>
                    }
                >
                    {/* A definite height, not just a minimum: TemplateDiagram measures its own
                        container to work out how far to scale the schema down, so a box that
                        sizes itself from its contents would leave it measuring zero. */}
                    <div className="h-[50vh] min-h-[320px] sm:min-h-[380px] flex flex-col">
                        {isPreviewLoading || !preview.schema ? (
                            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-400">
                                <Loader2 size={15} className="animate-spin" /> Building preview...
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0">
                                <TemplateDiagram schema={preview.schema} />
                            </div>
                        )}
                    </div>
                </Modal>
            )}

        </section>
    );
};
