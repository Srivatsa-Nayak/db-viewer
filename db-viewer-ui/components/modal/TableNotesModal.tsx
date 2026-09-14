"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, StickyNote, AlertCircle } from 'lucide-react';
import { dbService, TableNote } from '@/services/api';
import { Callout, Modal } from '@/components/ui/Modal';

interface TableNotesModalProps {
    isOpen: boolean;
    tableName: string;
    onClose: () => void;
    /** Lets the table node refresh its badge count. */
    onChanged?: () => void;
}

/** A to-do list attached to one table. */
export const TableNotesModal = ({ isOpen, tableName, onClose, onChanged }: TableNotesModalProps) => {
    const [notes, setNotes] = useState<TableNote[]>([]);
    const [draft, setDraft] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSaving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const draftRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setNotes(await dbService.getTableNotes(tableName));
            setError(null);
        } catch {
            setError('Could not load the notes for this table.');
        } finally {
            setLoading(false);
        }
    }, [tableName]);

    useEffect(() => {
        if (isOpen) {
            setDraft('');
            load();
        }
    }, [isOpen, load]);

    const mutate = async (action: () => Promise<unknown>) => {
        setSaving(true);
        try {
            await action();
            await load();
            onChanged?.();
            setError(null);
        } catch (err: unknown) {
            const message = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || 'That did not work. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        const text = draft.trim();
        if (!text) return;
        setDraft('');
        await mutate(() => dbService.addTableNote(tableName, text));
    };

    const open = notes.filter(n => !n.done);
    const done = notes.filter(n => n.done);

    const renderNote = (note: TableNote) => (
        <li key={note.id} className="flex items-start gap-2.5 group px-1 py-1.5 rounded hover:bg-ink-50">
            <input
                type="checkbox"
                checked={Boolean(note.done)}
                aria-label={note.done ? `Reopen "${note.note}"` : `Mark "${note.note}" done`}
                onChange={e => mutate(() => dbService.setTableNoteDone(note.id, e.target.checked))}
                className="mt-0.5 rounded border-ink-300 text-brand-600 w-4 h-4 focus:ring-0 shrink-0 cursor-pointer"
            />
            <span className={`flex-1 text-sm leading-relaxed break-words ${
                note.done ? 'text-ink-400 line-through' : 'text-ink-700'
            }`}>
                {note.note}
            </span>
            <button
                type="button"
                onClick={() => mutate(() => dbService.deleteTableNote(note.id))}
                // Always reachable on touch, where there is no hover to reveal it.
                className="p-1 text-ink-300 hover:text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 transition-opacity shrink-0"
                aria-label={`Delete note "${note.note}"`}
            >
                <Trash2 size={13} />
            </button>
        </li>
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Notes"
            subtitle={<>on <span className="font-mono text-brand-600">{tableName}</span></>}
            icon={<StickyNote size={17} className="text-amber-500 shrink-0" />}
            initialFocusRef={draftRef}
            footer={
                <form onSubmit={handleAdd} className="flex gap-2">
                    <input
                        ref={draftRef}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder="e.g. add an index on customer_id"
                        aria-label="New note"
                        maxLength={2000}
                        className="flex-1 min-w-0 bg-white border border-ink-300 rounded-md py-2.5 sm:py-2 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <button
                        type="submit"
                        disabled={isSaving || !draft.trim()}
                        className="px-3 py-2 brand-gradient brand-gradient-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium flex items-center gap-1.5 transition-all shrink-0"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Add
                    </button>
                </form>
            }
        >
            {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink-400">
                    <Loader2 size={16} className="animate-spin" /> Loading...
                </div>
            ) : notes.length === 0 ? (
                <p className="text-sm text-ink-400 text-center py-8 leading-relaxed">
                    No notes yet. Jot down what still needs doing on this table —
                    it will be here when you come back.
                </p>
            ) : (
                <>
                    <ul className="space-y-0.5">{open.map(renderNote)}</ul>
                    {done.length > 0 && (
                        <>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400 mt-5 mb-1 px-1">
                                Done ({done.length})
                            </p>
                            <ul className="space-y-0.5">{done.map(renderNote)}</ul>
                        </>
                    )}
                </>
            )}

            {error && (
                <div className="mt-3">
                    <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>
                </div>
            )}
        </Modal>
    );
};
