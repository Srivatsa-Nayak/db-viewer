"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Columns, Loader2, AlertCircle, Info } from 'lucide-react';
import { dbService } from '@/services/api';
import { Callout, GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';

const COLUMN_TYPES = ["VARCHAR", "INT", "DECIMAL", "BOOLEAN", "DATE", "TIME", "DATETIME"] as const;
const VARCHAR_LENGTHS = [64, 128, 256] as const;

const FIELD = 'w-full bg-white border border-ink-300 rounded-md py-2.5 sm:py-2 px-3 text-sm '
    + 'text-ink-900 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all';

interface AddColumnModalProps {
    isOpen: boolean;
    tableName: string;
    /** Names already used by the table, so a duplicate is caught before the round trip. */
    existingColumns: string[];
    onClose: () => void;
    onSuccess: () => void;
}

/** Modal for adding a column to a table. Opened from the `+` on a table node's header. */
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
    const nameRef = useRef<HTMLInputElement>(null);

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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Add column"
            subtitle={<>to <span className="font-mono text-brand-600">{tableName}</span></>}
            icon={<Columns size={18} className="text-brand-600 shrink-0" />}
            closeOnBackdrop={false}
            initialFocusRef={nameRef}
            onSubmit={handleSubmit}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose}>Cancel</GhostButton>
                    <PrimaryButton type="submit" disabled={isSaving}>
                        {isSaving && <Loader2 size={14} className="animate-spin" />}
                        {isSaving ? "Adding..." : "Add column"}
                    </PrimaryButton>
                </ModalActions>
            }
        >
            <div className="space-y-5">
                <div>
                    <label htmlFor="new-column-name" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                        Column name
                    </label>
                    <input
                        id="new-column-name"
                        ref={nameRef}
                        type="text"
                        className={`${FIELD} font-mono placeholder:text-ink-400`}
                        placeholder="e.g. created_at"
                        value={columnName}
                        onChange={(e) => { setColumnName(e.target.value); setError(null); }}
                    />
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1">
                        <label htmlFor="new-column-type" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                            Data type
                        </label>
                        <select
                            id="new-column-type"
                            className={FIELD}
                            value={columnType}
                            onChange={(e) => setColumnType(e.target.value)}
                        >
                            {COLUMN_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                        </select>
                    </div>

                    {columnType === 'VARCHAR' && (
                        <div className="sm:w-28">
                            <label htmlFor="new-column-length" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                                Length
                            </label>
                            <select
                                id="new-column-length"
                                className={FIELD}
                                value={length}
                                onChange={(e) => setLength(Number(e.target.value))}
                            >
                                {VARCHAR_LENGTHS.map(len => <option key={len} value={len}>{len}</option>)}
                            </select>
                        </div>
                    )}
                </div>

                <label className="flex items-start gap-3 p-3 rounded-md border border-ink-200 bg-ink-50 cursor-pointer hover:border-brand-300 transition-colors">
                    <input
                        type="checkbox"
                        checked={isNotNull}
                        onChange={(e) => setIsNotNull(e.target.checked)}
                        className="mt-0.5 rounded border-ink-300 bg-white text-brand-600 w-4 h-4 focus:ring-0 focus:ring-offset-0"
                    />
                    <span className="text-sm min-w-0">
                        <span className="font-medium text-ink-800 flex items-center gap-1.5">
                            Required
                            <Info size={12} className="text-ink-400" />
                        </span>
                        <span className="block text-xs text-ink-500 mt-0.5 leading-relaxed">
                            Adds <span className="font-mono">NOT NULL</span> with a type-appropriate default,
                            so existing rows stay valid.
                        </span>
                    </span>
                </label>

                {error && <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>}
            </div>
        </Modal>
    );
};
