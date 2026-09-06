"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Columns, Loader2, AlertCircle, Info } from 'lucide-react';
import { dbService } from '@/services/api';

const COLUMN_TYPES = ["VARCHAR", "INT", "DECIMAL", "BOOLEAN", "DATE", "TIME", "DATETIME"] as const;
const VARCHAR_LENGTHS = [64, 128, 256] as const;

interface AddColumnModalProps {
    isOpen: boolean;
    tableName: string;
    /** Names already used by the table, so a duplicate is caught before the round trip. */
    existingColumns: string[];
    onClose: () => void;
    onSuccess: () => void;
}

/**
 * Modal for adding a column to a table.
 *
 * Rendered through a portal on `document.body` rather than inline: a table node lives
 * inside React Flow's transformed viewport, and a `position: fixed` element inside a
 * transformed ancestor is positioned against that ancestor instead of the viewport.
 */
export const AddColumnModal = ({
    isOpen,
    tableName,
    existingColumns,
    onClose,
    onSuccess,
}: AddColumnModalProps) => {
    const [columnName, setColumnName] = useState("");
    const [columnType, setColumnType] = useState<string>("VARCHAR");
    const [length, setLength] = useState(128);
    const [isNotNull, setIsNotNull] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // `document` only exists in the browser, so the portal waits for mount.
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => setIsMounted(true), []);

    // Start from a clean form every time the modal is opened.
    useEffect(() => {
        if (isOpen) {
            setColumnName("");
            setColumnType("VARCHAR");
            setLength(128);
            setIsNotNull(false);
            setError(null);
            setIsSaving(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    const validate = (name: string): string | null => {
        if (!name) return "Column name is required.";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            return "Use letters, digits and underscores, starting with a letter or underscore.";
        }
        if (existingColumns.some(c => c.toLowerCase() === name.toLowerCase())) {
            return `"${name}" already exists in ${tableName}.`;
        }
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = columnName.trim();

        const validationError = validate(name);
        if (validationError) {
            setError(validationError);
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            await dbService.addColumn({
                tableName,
                columnName: name,
                columnType,
                length: columnType === 'VARCHAR' ? length : undefined,
                notNull: isNotNull,
            });
            onSuccess();
            onClose();
        } catch (err: unknown) {
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || "Failed to add the column. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen || !isMounted) return null;

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
                            <Columns size={18} className="text-blue-600" />
                            Add Column
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            to <span className="font-mono text-blue-600">{tableName}</span>
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

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label htmlFor="new-column-name" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                            Column name
                        </label>
                        <input
                            id="new-column-name"
                            autoFocus
                            type="text"
                            className="w-full bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 placeholder-zinc-400 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                            placeholder="e.g. created_at"
                            value={columnName}
                            onChange={(e) => { setColumnName(e.target.value); setError(null); }}
                        />
                    </div>

                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label htmlFor="new-column-type" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                                Data type
                            </label>
                            <select
                                id="new-column-type"
                                className="w-full bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                                value={columnType}
                                onChange={(e) => setColumnType(e.target.value)}
                            >
                                {COLUMN_TYPES.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>

                        {columnType === 'VARCHAR' && (
                            <div className="w-28 animate-in fade-in slide-in-from-left-2">
                                <label htmlFor="new-column-length" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                                    Length
                                </label>
                                <select
                                    id="new-column-length"
                                    className="w-full bg-white border border-zinc-300 rounded-md py-2 px-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                                    value={length}
                                    onChange={(e) => setLength(Number(e.target.value))}
                                >
                                    {VARCHAR_LENGTHS.map(len => (
                                        <option key={len} value={len}>{len}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <label className="flex items-start gap-3 p-3 rounded-md border border-zinc-200 bg-zinc-50 cursor-pointer hover:border-blue-300 transition-colors">
                        <input
                            type="checkbox"
                            checked={isNotNull}
                            onChange={(e) => setIsNotNull(e.target.checked)}
                            className="mt-0.5 rounded border-zinc-300 bg-white text-blue-600 w-4 h-4 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="text-sm">
                            <span className="font-medium text-zinc-800 flex items-center gap-1.5">
                                Required
                                <Info size={12} className="text-zinc-400" />
                            </span>
                            <span className="block text-xs text-zinc-500 mt-0.5">
                                Adds <span className="font-mono">NOT NULL</span> with a type-appropriate default,
                                so existing rows stay valid.
                            </span>
                        </span>
                    </label>

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
                            disabled={isSaving}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md text-sm font-bold shadow-sm transition-all flex items-center gap-2"
                        >
                            {isSaving && <Loader2 size={14} className="animate-spin" />}
                            {isSaving ? "Adding..." : "Add Column"}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
};
