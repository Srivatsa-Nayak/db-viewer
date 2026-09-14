"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Loader2, AlertCircle, KeyRound, AlertTriangle } from 'lucide-react';
import { dbService } from '@/services/api';
import { ColumnInfo } from '@/types';
import { Callout, GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';

const COLUMN_TYPES = ["VARCHAR", "INT", "DECIMAL", "BOOLEAN", "TEXT", "DATE", "TIME", "DATETIME"];
const VARCHAR_LENGTHS = [64, 128, 256];

const FIELD = 'w-full bg-white border border-ink-300 rounded-md py-2.5 sm:py-2 px-3 text-sm text-ink-900 '
    + 'focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all '
    + 'disabled:bg-ink-100 disabled:text-ink-400 disabled:cursor-not-allowed';

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
            notNull: column.notNull ?? false,
            isPk: column.isPk ?? false,
        };
    }, [column]);

    const [name, setName] = useState("");
    const [base, setBase] = useState("VARCHAR");
    const [length, setLength] = useState(128);
    const [notNull, setNotNull] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const nameRef = useRef<HTMLInputElement>(null);

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

    // An unrecognised existing type still needs to be selectable, or saving would rewrite it.
    const typeOptions = original && !COLUMN_TYPES.includes(original.base)
        ? [original.base, ...COLUMN_TYPES]
        : COLUMN_TYPES;

    const nameChanged = Boolean(original) && name.trim() !== original!.name;
    const typeChanged = Boolean(original)
        && (base !== original!.base || (base === 'VARCHAR' && length !== original!.length));
    const nullChanged = Boolean(original) && notNull !== original!.notNull;
    const hasChanges = nameChanged || typeChanged || nullChanged;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!original) return;
        const trimmed = name.trim();

        if (!trimmed) return setError("Column name is required.");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
            return setError("Use letters, digits and underscores, starting with a letter or underscore.");
        }
        if (nameChanged && existingColumns.some(c => c.toLowerCase() === trimmed.toLowerCase())) {
            return setError(`"${trimmed}" already exists in ${tableName}.`);
        }
        if (!hasChanges) return onClose();

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

    if (!original) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit column"
            subtitle={
                <>
                    <span className="font-mono text-brand-600">{tableName}</span>
                    <span className="text-ink-300"> . </span>
                    <span className="font-mono">{original.name}</span>
                </>
            }
            icon={<Pencil size={16} className="text-brand-600 shrink-0" />}
            closeOnBackdrop={false}
            initialFocusRef={nameRef}
            onSubmit={handleSubmit}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose}>Cancel</GhostButton>
                    <PrimaryButton type="submit" disabled={isSaving || !hasChanges}>
                        {isSaving && <Loader2 size={14} className="animate-spin" />}
                        {isSaving ? "Saving..." : "Save changes"}
                    </PrimaryButton>
                </ModalActions>
            }
        >
            <div className="space-y-5">
                {original.isPk && (
                    <Callout tone="info" icon={<KeyRound size={14} />}>
                        This is the primary key. It can be renamed, but its type and nullability
                        are fixed &mdash; changing them would break row identity and auto-numbering.
                    </Callout>
                )}

                <div>
                    <label htmlFor="edit-column-name" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                        Column name
                    </label>
                    <input
                        id="edit-column-name"
                        ref={nameRef}
                        type="text"
                        className={`${FIELD} font-mono`}
                        value={name}
                        onChange={(e) => { setName(e.target.value); setError(null); }}
                    />
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                        <label htmlFor="edit-column-type" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                            Data type
                        </label>
                        <select
                            id="edit-column-type"
                            disabled={original.isPk}
                            className={FIELD}
                            value={base}
                            onChange={(e) => setBase(e.target.value)}
                        >
                            {typeOptions.map(type => <option key={type} value={type}>{type}</option>)}
                        </select>
                    </div>

                    {base === 'VARCHAR' && (
                        <div className="sm:w-28">
                            <label htmlFor="edit-column-length" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                                Length
                            </label>
                            <select
                                id="edit-column-length"
                                disabled={original.isPk}
                                className={FIELD}
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
                        ? 'border-ink-200 bg-ink-100 cursor-not-allowed opacity-60'
                        : 'border-ink-200 bg-ink-50 cursor-pointer hover:border-brand-300'
                }`}>
                    <input
                        type="checkbox"
                        disabled={original.isPk}
                        checked={original.isPk ? true : notNull}
                        onChange={(e) => setNotNull(e.target.checked)}
                        className="mt-0.5 rounded border-ink-300 bg-white text-brand-600 w-4 h-4 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-sm min-w-0">
                        <span className="font-medium text-ink-800">Required</span>
                        <span className="block text-xs text-ink-500 mt-0.5 leading-relaxed">
                            Enforces <span className="font-mono">NOT NULL</span>. Existing empty
                            values are filled in with a type-appropriate default.
                        </span>
                    </span>
                </label>

                {typeChanged && (
                    <Callout tone="warning" icon={<AlertTriangle size={14} />}>
                        Changing the type rewrites the column. Values that do not fit the new
                        type may be converted or lost.
                    </Callout>
                )}

                {error && <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>}
            </div>
        </Modal>
    );
};
