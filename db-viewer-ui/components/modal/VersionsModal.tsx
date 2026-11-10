"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, GitCompare, History, Loader2, Lock, RotateCcw, Save, Terminal, Trash2 } from 'lucide-react';
import { Callout, GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';
import { dbService, isAuthRequired, snapshotService, type SnapshotSummary } from '@/services/api';
import { errorMessage } from '@/services/errors';
import { copyText } from '@/services/exportDiagram';
import { describeChange, diffSchemas, migrationScript, type SchemaSide } from '@/services/schemaDiff';

/**
 * Versions of the open file, and comparing it with something else.
 *
 * Two halves that meet in the middle. **Versions** (account-only) are saved copies of the file
 * on the server, which can be restored. **Compare** works on any two schemas — a saved version,
 * or another open file — and needs no account when the other side is a file: it is computed in
 * the browser (`services/schemaDiff.ts`). Both sides of a comparison read as "from that, to
 * this file", so the migration draft always turns the other side into what is open now.
 */
type Target = { kind: 'version'; id: number; label: string } | { kind: 'file'; id: string; label: string };

const formatSize = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

const formatDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export const VersionsModal = ({
    isOpen, onClose, fileName, current, otherFiles, hasAccount, onNeedsAccount, onRestored, onOpenInScratchpad,
}: {
    isOpen: boolean;
    onClose: () => void;
    fileName: string;
    /** The open file's schema, as the canvas has it. */
    current: SchemaSide;
    otherFiles: { id: string; name: string }[];
    hasAccount: boolean;
    onNeedsAccount: () => void;
    /** After a restore: re-read the file. */
    onRestored: () => Promise<void> | void;
    onOpenInScratchpad: (sql: string) => void;
}) => {
    const [versions, setVersions] = useState<SnapshotSummary[]>([]);
    const [isLoading, setLoading] = useState(hasAccount);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [confirmRestore, setConfirmRestore] = useState<number | null>(null);
    const [target, setTarget] = useState<Target | null>(null);
    const [other, setOther] = useState<SchemaSide | null>(null);
    const [copied, setCopied] = useState(false);

    const fail = (e: unknown, fallback: string) => {
        if (isAuthRequired(e)) { onNeedsAccount(); return; }
        setError(errorMessage(e) || fallback);
    };

    const refresh = useCallback(async () => {
        if (!hasAccount) return;
        try {
            setVersions(await snapshotService.list());
        } catch (e) {
            setError(errorMessage(e) || 'The versions could not be listed.');
        } finally {
            setLoading(false);
        }
    }, [hasAccount]);

    // Loading is a side effect of opening; the dialog mounts only while open.
    useEffect(() => { void refresh(); }, [refresh]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasAccount) return onNeedsAccount();
        setBusy('save'); setError(null); setNotice(null);
        try {
            await snapshotService.create(name.trim());
            setName('');
            setNotice('Saved. You can restore this version, or compare the file with it later.');
            await refresh();
        } catch (err) {
            fail(err, 'The version could not be saved.');
        } finally {
            setBusy(null);
        }
    };

    const restore = async (id: number) => {
        setBusy(`restore-${id}`); setError(null); setNotice(null);
        try {
            await snapshotService.restore(id);
            setConfirmRestore(null);
            await onRestored();
            setNotice('Restored. The canvas shows the file as it was in that version.');
        } catch (err) {
            fail(err, 'That version could not be restored.');
        } finally {
            setBusy(null);
        }
    };

    const remove = async (id: number) => {
        setBusy(`delete-${id}`); setError(null);
        try {
            await snapshotService.remove(id);
            if (target?.kind === 'version' && target.id === id) { setTarget(null); setOther(null); }
            await refresh();
        } catch (err) {
            fail(err, 'That version could not be deleted.');
        } finally {
            setBusy(null);
        }
    };

    const compareWith = async (next: Target) => {
        setTarget(next); setOther(null); setError(null); setNotice(null); setCopied(false);
        setBusy('compare');
        try {
            const schema = next.kind === 'version'
                ? await snapshotService.schema(next.id)
                : await dbService.getSchemaOf(next.id);
            setOther(schema);
        } catch (err) {
            fail(err, 'That could not be read for comparing.');
            setTarget(null);
        } finally {
            setBusy(null);
        }
    };

    const changes = useMemo(() => (other ? diffSchemas(other, current) : []), [other, current]);
    const script = useMemo(
        () => (other && target ? migrationScript(changes, current, `From ${target.label} to ${fileName}`) : ''),
        [changes, current, other, target, fileName]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Versions and compare"
            subtitle={fileName}
            icon={<History size={18} className="text-brand-600 shrink-0" />}
            size="xl"
            footer={<ModalActions><GhostButton onClick={onClose}>Close</GhostButton></ModalActions>}
        >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <section aria-labelledby="versions-heading" className="min-w-0">
                    <h3 id="versions-heading" className="mb-2 text-xs font-bold uppercase text-ink-500">Saved versions</h3>
                    {!hasAccount ? (
                        <div className="rounded-lg border border-line p-4 text-sm text-ink-600">
                            <p className="mb-3 flex items-center gap-2"><Lock size={14} /> Saving versions needs a free account.</p>
                            <PrimaryButton onClick={onNeedsAccount}>Sign in or sign up</PrimaryButton>
                        </div>
                    ) : (
                        <>
                            <form onSubmit={save} className="mb-3 flex gap-2">
                                <input
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    maxLength={120}
                                    placeholder="Name this version (optional)"
                                    aria-label="Version name"
                                    className="min-w-0 flex-1 rounded-md border border-ink-300 bg-surface px-3 py-2 text-sm text-ink-900
                                               placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                />
                                <PrimaryButton type="submit" disabled={busy === 'save'}>
                                    {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                    Save now
                                </PrimaryButton>
                            </form>
                            {isLoading ? (
                                <p className="flex items-center gap-2 text-xs text-ink-500"><Loader2 size={13} className="animate-spin" /> Loading…</p>
                            ) : versions.length === 0 ? (
                                <p className="text-xs text-ink-500">
                                    None yet. A version keeps the tables, keys and rows as they are when you save
                                    it (not views or extra indexes), up to 10 per file.
                                </p>
                            ) : (
                                <ul className="divide-y divide-line rounded-lg border border-line">
                                    {versions.map(v => (
                                        <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium text-ink-900">{v.name}</p>
                                                <p className="text-[11px] text-ink-500">
                                                    {formatDate(v.createdAt)} · {v.tableCount} table{v.tableCount === 1 ? '' : 's'} · {formatSize(v.sizeBytes)}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button type="button" title="Compare the file now with this version"
                                                        onClick={() => compareWith({ kind: 'version', id: v.id, label: `"${v.name}"` })}
                                                        className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900">
                                                    <GitCompare size={14} />
                                                    <span className="sr-only">Compare with {v.name}</span>
                                                </button>
                                                {confirmRestore === v.id ? (
                                                    <button type="button" onClick={() => restore(v.id)} disabled={busy !== null}
                                                            className="rounded bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700">
                                                        {busy === `restore-${v.id}` ? 'Restoring…' : 'Replace the file'}
                                                    </button>
                                                ) : (
                                                    <button type="button" title="Restore: replace the file's tables and rows with this version"
                                                            onClick={() => { setConfirmRestore(v.id); setNotice(null); }}
                                                            className="rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900">
                                                        <RotateCcw size={14} />
                                                        <span className="sr-only">Restore {v.name}</span>
                                                    </button>
                                                )}
                                                <button type="button" title="Delete this version" onClick={() => remove(v.id)}
                                                        disabled={busy !== null}
                                                        className="rounded p-1.5 text-ink-400 hover:bg-tone-error-bg hover:text-red-600">
                                                    <Trash2 size={14} />
                                                    <span className="sr-only">Delete {v.name}</span>
                                                </button>
                                            </div>
                                            {confirmRestore === v.id && (
                                                <p className="basis-full text-[11px] text-ink-500">
                                                    The file&apos;s current tables and rows are replaced. Save a version of it first if
                                                    you may want it back. <button type="button" className="underline" onClick={() => setConfirmRestore(null)}>Cancel</button>
                                                </p>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {otherFiles.length > 0 && (
                        <div className="mt-5">
                            <h3 className="mb-2 text-xs font-bold uppercase text-ink-500">Compare with another open file</h3>
                            <div className="flex flex-wrap gap-1.5">
                                {otherFiles.map(f => (
                                    <button key={f.id} type="button"
                                            onClick={() => compareWith({ kind: 'file', id: f.id, label: f.name })}
                                            className={`rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors ${
                                                target?.kind === 'file' && target.id === f.id
                                                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                                                    : 'border-line text-ink-700 hover:bg-ink-50'}`}>
                                        {f.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </section>

                <section aria-labelledby="compare-heading" aria-live="polite" className="min-w-0">
                    <h3 id="compare-heading" className="mb-2 text-xs font-bold uppercase text-ink-500">
                        {target ? <>From {target.label} to this file</> : 'Comparison'}
                    </h3>
                    {!target ? (
                        <p className="text-xs text-ink-500">
                            Pick a version or another file to see what is different, with a migration draft
                            that turns that into this.
                        </p>
                    ) : busy === 'compare' || !other ? (
                        <p className="flex items-center gap-2 text-xs text-ink-500"><Loader2 size={13} className="animate-spin" /> Comparing…</p>
                    ) : changes.length === 0 ? (
                        <Callout tone="info">No differences in tables, columns or keys.</Callout>
                    ) : (
                        <>
                            <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto text-xs text-ink-700 scroll-slim">
                                {changes.map((c, i) => <li key={i} className="font-mono">{describeChange(c)}</li>)}
                            </ul>
                            <pre className="max-h-64 overflow-auto rounded-md border border-line bg-ink-50 p-3 font-mono text-[11px] leading-relaxed text-ink-800 scroll-slim">
                                {script}
                            </pre>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <GhostButton onClick={async () => { setCopied(await copyText(script)); }}>
                                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy script'}
                                </GhostButton>
                                <GhostButton onClick={() => { onOpenInScratchpad(script); onClose(); }}>
                                    <Terminal size={14} /> Open in the SQL panel
                                </GhostButton>
                            </div>
                        </>
                    )}
                </section>
            </div>

            {(error || notice) && (
                <div className="mt-4">
                    {error ? <Callout tone="error">{error}</Callout> : <Callout tone="info">{notice}</Callout>}
                </div>
            )}
        </Modal>
    );
};
