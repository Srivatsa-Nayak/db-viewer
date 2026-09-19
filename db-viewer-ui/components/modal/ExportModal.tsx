"use client";

import { useMemo, useState } from 'react';
import {
    FileCode2, Image as ImageIcon, GitBranch, Table2, Download, Copy, Check, Lock, Loader2,
} from 'lucide-react';
import { Modal, ModalActions, PrimaryButton, GhostButton, Callout } from '@/components/ui/Modal';
import { SQL_DIALECTS } from '@/services/api';
import {
    baseFileName, copyText, downloadText, toDbml, toMermaid, toMermaidMarkdown,
} from '@/services/exportDiagram';
import { Relationship, SqlDialectId, TableInfo } from '@/types';

/**
 * Every way out of the app, in one dialog.
 *
 * They used to be two menu items — a PNG and "the" SQL script — which worked while there was
 * only one of each. There is not: a SQL export has to be told which engine it is for (the four
 * spellings of an auto-incrementing key are mutually unacceptable), and a diagram is as often
 * wanted as text for a README as it is as a picture. A menu line cannot ask a question, so the
 * choice moved somewhere with room to explain itself.
 */

type Format = 'sql' | 'png' | 'mermaid' | 'dbml';

interface ExportModalProps {
    isOpen: boolean;
    fileName: string;
    tables: Pick<TableInfo, 'name' | 'columns'>[];
    relationships: Relationship[];
    /**
     * Every export needs an account, PNG and the text formats included. Nothing here reaches
     * the backend for Mermaid, DBML or the PNG — they are generated in the browser from data
     * already on screen — but "exporting" means taking data out of the app, and that line does
     * not move just because a particular format happens to be free to *produce*.
     */
    hasAccount: boolean;
    onExportSql: (dialect: SqlDialectId) => Promise<void> | void;
    onExportImage: () => Promise<void> | void;
    onNeedsAccount: () => void;
    onClose: () => void;
}

const FORMATS: { id: Format; label: string; hint: string; icon: React.ReactNode }[] = [
    { id: 'sql', label: 'SQL script', hint: 'Schema and data, for a specific engine', icon: <FileCode2 size={15} /> },
    { id: 'mermaid', label: 'Mermaid', hint: 'Renders in GitHub, Jira and Notion', icon: <GitBranch size={15} /> },
    { id: 'dbml', label: 'DBML', hint: 'For dbdiagram.io and dbdocs', icon: <Table2 size={15} /> },
    { id: 'png', label: 'Image', hint: 'A picture of the canvas', icon: <ImageIcon size={15} /> },
];

export const ExportModal = ({
    isOpen, fileName, tables, relationships, hasAccount,
    onExportSql, onExportImage, onNeedsAccount, onClose,
}: ExportModalProps) => {
    const [format, setFormat] = useState<Format>('sql');
    const [dialect, setDialect] = useState<SqlDialectId>('postgres');
    const [isBusy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const source = useMemo(() => ({ tables, relationships }), [tables, relationships]);

    // Generated on demand and only for the tab being looked at: on a large schema both of these
    // are a few hundred kilobytes of string, and there is no reason to build the one nobody
    // opened.
    const preview = useMemo(() => {
        if (format === 'mermaid') return toMermaid(source);
        if (format === 'dbml') return toDbml(source);
        return '';
    }, [format, source]);

    const base = baseFileName(fileName);

    const copy = async () => {
        if (needsAccount) return onNeedsAccount();
        const ok = await copyText(preview);
        setCopied(ok);
        setError(ok ? null : 'The clipboard is not available here — use Download instead.');
        if (ok) window.setTimeout(() => setCopied(false), 1800);
    };

    const download = async () => {
        setError(null);
        try {
            if (format === 'mermaid') {
                // Markdown rather than a bare .mmd: the destination is nearly always a README or
                // a ticket, and a fenced block is what renders there.
                downloadText(toMermaidMarkdown(source, fileName), `${base}.md`, 'text/markdown');
                return;
            }
            if (format === 'dbml') {
                downloadText(toDbml(source), `${base}.dbml`);
                return;
            }
            setBusy(true);
            if (format === 'png') await onExportImage();
            else await onExportSql(dialect);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'That export could not be produced.');
        } finally {
            setBusy(false);
        }
    };

    // Every format is gated the same way now. PNG, Mermaid and DBML never touch the backend -
    // there is nothing there to answer 401 - so the UI is the only place this can be enforced,
    // and it has to check `format` no more than SQL used to: an account check that only fires
    // for one of four buttons is a check three of them silently skip.
    const needsAccount = !hasAccount;
    const isTextFormat = format === 'mermaid' || format === 'dbml';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            title="Export"
            subtitle={fileName}
            icon={<Download size={18} className="text-brand-600" />}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose}>Close</GhostButton>
                    {isTextFormat && (
                        <GhostButton onClick={copy}>
                            {copied ? <Check size={15} /> : <Copy size={15} />}
                            {copied ? 'Copied' : needsAccount ? 'Sign in to copy' : 'Copy to clipboard'}
                        </GhostButton>
                    )}
                    <PrimaryButton
                        onClick={needsAccount ? onNeedsAccount : download}
                        disabled={isBusy || tables.length === 0}
                    >
                        {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                        {needsAccount ? 'Sign in to export' : 'Download'}
                    </PrimaryButton>
                </ModalActions>
            }
        >
            <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {FORMATS.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            onClick={() => { setFormat(option.id); setError(null); }}
                            aria-pressed={format === option.id}
                            className={`p-3 rounded-lg border text-left transition-all ${
                                format === option.id
                                    ? 'border-brand-500 bg-brand-50 shadow-glow-sm'
                                    : 'border-line bg-surface hover:border-brand-300'
                            }`}
                        >
                            <span className={`flex items-center gap-2 text-sm font-semibold ${
                                format === option.id ? 'text-brand-700' : 'text-ink-800'
                            }`}>
                                {option.icon}
                                {option.label}
                                {!hasAccount && (
                                    <Lock size={11} className="text-ink-400 ml-auto" />
                                )}
                            </span>
                            <span className="block mt-1 text-[11px] text-ink-500 leading-snug">
                                {option.hint}
                            </span>
                        </button>
                    ))}
                </div>

                {format === 'sql' && (
                    <div className="space-y-3">
                        <div>
                            <label htmlFor="export-dialect" className="block text-xs font-medium text-ink-700 mb-1.5">
                                Which engine is this for?
                            </label>
                            <select
                                id="export-dialect"
                                value={dialect}
                                onChange={(e) => setDialect(e.target.value as SqlDialectId)}
                                className="w-full bg-surface border border-ink-300 rounded-md py-2.5 sm:py-2 px-3 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                            >
                                {SQL_DIALECTS.map(option => (
                                    <option key={option.id} value={option.id}>
                                        {option.label} — {option.hint}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <Callout tone="info">
                            The script is rebuilt in that engine&apos;s own syntax rather than
                            copied out of the workspace. It matters more than it looks:{' '}
                            <code className="font-mono">AUTOINCREMENT</code>,{' '}
                            <code className="font-mono">SERIAL</code>,{' '}
                            <code className="font-mono">IDENTITY(1,1)</code> and{' '}
                            <code className="font-mono">AUTO_INCREMENT</code> are four spellings of
                            one idea and no engine accepts another&apos;s. Tables are written
                            parents-first, so the foreign keys load in order.
                        </Callout>
                    </div>
                )}

                {format === 'png' && (
                    <Callout tone="info">
                        A picture of the whole diagram, sized to the tables rather than to the
                        window — nothing is cut off by however you happen to be scrolled. It
                        follows the theme you are using, so a dark canvas exports dark.
                    </Callout>
                )}

                {isTextFormat && (
                    <div className="space-y-2">
                        <Callout tone="info">
                            {format === 'mermaid'
                                ? 'Paste this into a GitHub README, a Jira ticket or a Notion page and it renders as a diagram. Download gives you a Markdown file with the fence already around it.'
                                : 'Database Markup Language. Paste it into dbdiagram.io for an editable diagram, or commit it beside the code as the schema of record.'}
                        </Callout>
                        <pre className="max-h-64 overflow-auto scroll-slim rounded-lg border border-line bg-ink-50 p-3 text-[11px] leading-relaxed font-mono text-ink-800">
                            {preview || '-- nothing to export yet'}
                        </pre>
                    </div>
                )}

                {/* One callout for the whole dialog rather than one per format: the rule is
                    the same regardless of which tile is selected, and four copies of it are
                    four chances for one to say something the others don't. */}
                {needsAccount && (
                    <Callout tone="warning" icon={<Lock size={13} />}>
                        Exporting needs an account, whichever format you pick — sign in to
                        download or copy this.
                    </Callout>
                )}

                {error && <Callout tone="error">{error}</Callout>}
            </div>
        </Modal>
    );
};
