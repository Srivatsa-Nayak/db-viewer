"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Plus, Trash2, StickyNote, AlertCircle } from 'lucide-react';
import { dbService, TableNote } from '@/services/api';

interface TableNotesModalProps {
    isOpen: boolean;
    tableName: string;
    onClose: () => void;
    /** Lets the table node refresh its badge count. */
    onChanged?: () => void;
}

/**
 * A to-do list attached to one table.
 *
 * Portalled, like the other modals opened from a table node: the node lives inside React Flow's
 * transformed viewport, where a `position: fixed` element would anchor to the canvas pane.
 */
export const TableNotesModal = ({ isOpen, tableName, onClose, onChanged }: TableNotesModalProps) => {
    const [notes, setNotes] = useState<TableNote[]>([]);
    const [draft, setDraft] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isSaving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isMounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

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

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !isMounted) return null;

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
        <li key={note.id} className="flex items-start gap-2.5 group px-1 py-1.5 rounded hover:bg-zinc-50">
            <input
                type="checkbox"
                checked={Boolean(note.done)}
                onChange={e => mutate(() => dbService.setTableNoteDone(note.id, e.target.checked))}
                className="mt-0.5 rounded border-zinc-300 text-blue-600 w-4 h-4 focus:ring-0 shrink-0 cursor-pointer"
            />
            <span className={`flex-1 text-sm leading-relaxed break-words ${
                note.done ? 'text-zinc-400 line-through' : 'text-zinc-700'
            }`}>
                {note.note}
            </span>
            <button
                onClick={() => mutate(() => dbService.deleteTableNote(note.id))}
                className="p-1 text-zinc-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                title="Delete note"
            >
                <Trash2 size={13} />
            </button>
        </li>
    );

    return createPortal(
        <div
            className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="bg-white border border-zinc-200 rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[80vh]"
                onMouseDown={e => e.stopPropagation()}
            >
                <div className="p-4 border-b border-zinc-200 flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                            <StickyNote size={17} className="text-amber-500" />
                            Notes
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            on <span className="font-mono text-blue-600">{tableName}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
                            <Loader2 size={16} className="animate-spin" /> Loading...
                        </div>
                    ) : notes.length === 0 ? (
                        <p className="text-sm text-zinc-400 text-center py-8 leading-relaxed">
                            No notes yet. Jot down what still needs doing on this table —
                            it will be here when you come back.
                        </p>
                    ) : (
                        <>
                            <ul className="space-y-0.5">{open.map(renderNote)}</ul>
                            {done.length > 0 && (
                                <>
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mt-5 mb-1 px-1">
                                        Done ({done.length})
                                    </p>
                                    <ul className="space-y-0.5">{done.map(renderNote)}</ul>
                                </>
                            )}
                        </>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 p-3 mt-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-600">
                            <AlertCircle size={14} className="shrink-0 mt-px" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>

                <form onSubmit={handleAdd} className="p-4 border-t border-zinc-200 flex gap-2">
                    <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        placeholder="e.g. add an index on customer_id"
                        maxLength={2000}
                        className="flex-1 bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                        type="submit"
                        disabled={isSaving || !draft.trim()}
                        className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium flex items-center gap-1.5 transition-colors"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        Add
                    </button>
                </form>
            </div>
        </div>,
        document.body
    );
};
