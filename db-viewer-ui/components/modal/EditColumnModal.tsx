"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Loader2, AlertCircle, KeyRound, AlertTriangle } from 'lucide-react';
import { dbService } from '@/services/api';
import { ColumnInfo } from '@/types';

const COLUMN_TYPES = ["VARCHAR", "INT", "DECIMAL", "BOOLEAN", "TEXT", "DATE", "TIME", "DATETIME"];
const VARCHAR_LENGTHS = [64, 128, 256];

interface EditColumnModalProps {
    isOpen: boolean;
    tableName: string;
    /** The column being edited, as reported by the backend. */
    column: ColumnInfo | null;
    /** All column names in the table, for the duplicate-name check. */
    existingColumns: string[];
    onClose: () => void;
    onSuccess: () => void;
}

/**
 * Splits a concrete column type such as `VARCHAR(128)` or `INTEGER` back into the base type
 * and length the form works with. An unrecognised type is preserved verbatim so opening the
 * modal on an exotic column and saving does not silently rewrite it.
 */
const parseType = (rawType: string): { base: string; length: number } => {
    const raw = (rawType || "").trim().toUpperCase();
    const match = raw.match(/^([A-Z ]+)\s*\(\s*(\d+)/);
    const base = (match ? match[1] : raw).trim();
    const length = match ? Number(match[2]) : 0;

    if (base === "INTEGER") return { base: "INT", length: 0 };
    if (base === "BOOL") return { base: "BOOLEAN", length: 0 };
    if (base === "VARCHAR" || base === "CHARACTER VARYING") {
        return { base: "VARCHAR", length: length || 128 };
    }
    return { base, length };
};

export const EditColumnModal = ({
    isOpen,
    tableName,
    column,
    existingColumns,
    onClose,
    onSuccess,
}: EditColumnModalProps) => {
    const original = useMemo(() => {
        if (!column) return null;
        const { base, length } = parseType(column.type);
        return {
            name: column.name,
            base,
            length: length || 128,
            notNull: column.notNull ?? column.not_null ?? false,
            isPk: column.isPk ?? column.is_pk ?? false,
        };
    }, [column]);

    const [name, setName] = useState("");
    const [base, setBase] = useState("VARCHAR");
    const [length, setLength] = useState(128);
    const [notNull, setNotNull] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);

    // Re-seed the form from the column each time the modal opens.
    useEffect(() => {
        if (isOpen && original) {
            setName(original.name);
            setBase(original.base);
            setLength(original.length);
            setNotNull(original.notNull);
            setError(null);
            setIsSaving(false);
        }
    }, [isOpen, original]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !isMounted || !original) return null;

    // An unrecognised existing type still needs to be selectable, or saving would rewrite it.
    const typeOptions = COLUMN_TYPES.includes(original.base)
        ? COLUMN_TYPES
        : [original.base, ...COLUMN_TYPES];

    const nameChanged = name.trim() !== original.name;
    const typeChanged = base !== original.base || (base === 'VARCHAR' && length !== original.length);
    const nullChanged = notNull !== original.notNull;
    const hasChanges = nameChanged || typeChanged || nullChanged;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();

        if (!trimmed) return setError("Column name is required.");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
            return setError("Use letters, digits and underscores, starting with a letter or underscore.");
        }
        if (nameChanged && existingColumns.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
            return setError(`"${trimmed}" already exists in ${tableName}.`);
        }
        if (!hasChanges) {
            onClose();
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            // Only send what actually changed - the backend treats omitted fields as
            // "leave alone", which keeps a no-op save from rebuilding the table.
            await dbService.updateColumn({
                tableName,
                columnName: original.name,
                newColumnName: nameChanged ? trimmed : undefined,
                columnType: typeChanged ? base : undefined,
                length: typeChanged && base === 'VARCHAR' ? length : undefined,
                notNull: nullChanged ? notNull : undefined,
            });
            onSuccess();
            onClose();
        } catch (err: unknown) {
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || "Failed to update the column. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="bg-white border border-zinc-200 rounded-xl w-full max-w-md shadow-2xl overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                            <Pencil size={16} className="text-blue-600" />
                            Edit Column
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            <span className="font-mono text-blue-600">{tableName}</span>
                            <span className="text-zinc-300"> . </span>
                            <span className="font-mono">{original.name}</span>
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {original.isPk && (
                        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
                            <KeyRound size={14} className="shrink-0 mt-px" />
                            <span>
                                This is the primary key. It can be renamed, but its type and
                                nullability are fixed &mdash; changing them would break row
                                identity and auto-numbering.
                            </span>
                        </div>
                    )}

                    <div>
                        <label htmlFor="edit-column-name" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                            Column name
                        </label>
                        <input
                            id="edit-column-name"
                            autoFocus
                            type="text"
                            className="w-full bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                            value={name}
                            onChange={(e) => { setName(e.target.value); setError(null); }}
                        />
                    </div>

                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label htmlFor="edit-column-type" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                                Data type
                            </label>
                            <select
                                id="edit-column-type"
                                disabled={original.isPk}
                                className="w-full bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed"
                                value={base}
                                onChange={(e) => setBase(e.target.value)}
                            >
                                {typeOptions.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>

                        {base === 'VARCHAR' && (
                            <div className="w-28 animate-in fade-in slide-in-from-left-2">
                                <label htmlFor="edit-column-length" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                                    Length
                                </label>
                                <select
                                    id="edit-column-length"
                                    disabled={original.isPk}
                                    className="w-full bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all disabled:bg-zinc-100 disabled:text-zinc-400 disabled:cursor-not-allowed"
                                    value={length}
                                    onChange={(e) => setLength(Number(e.target.value))}
                                >
                                    {(VARCHAR_LENGTHS.includes(length) ? VARCHAR_LENGTHS : [length, ...VARCHAR_LENGTHS])
                                        .map(len => <option key={len} value={len}>{len}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <label className={`flex items-start gap-3 p-3 rounded-md border transition-colors ${
                        original.isPk
                            ? 'border-zinc-200 bg-zinc-100 cursor-not-allowed opacity-60'
                            : 'border-zinc-200 bg-zinc-50 cursor-pointer hover:border-blue-300'
                    }`}>
                        <input
                            type="checkbox"
                            disabled={original.isPk}
                            checked={original.isPk ? true : notNull}
                            onChange={(e) => setNotNull(e.target.checked)}
                            className="mt-0.5 rounded border-zinc-300 bg-white text-blue-600 w-4 h-4 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="text-sm">
                            <span className="font-medium text-zinc-800">Required</span>
                            <span className="block text-xs text-zinc-500 mt-0.5">
                                Enforces <span className="font-mono">NOT NULL</span>. Existing empty
                                values are filled in with a type-appropriate default.
                            </span>
                        </span>
                    </label>

                    {typeChanged && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
                            <AlertTriangle size={14} className="shrink-0 mt-px" />
                            <span>
                                Changing the type rewrites the column. Values that do not fit the new
                                type may be converted or lost.
                            </span>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-600">
                            <AlertCircle size={14} className="shrink-0 mt-px" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-zinc-500 hover:text-zinc-900 text-sm hover:bg-zinc-100 rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving || !hasChanges}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-bold shadow-sm transition-all flex items-center gap-2"
                        >
                            {isSaving && <Loader2 size={14} className="animate-spin" />}
                            {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
};
