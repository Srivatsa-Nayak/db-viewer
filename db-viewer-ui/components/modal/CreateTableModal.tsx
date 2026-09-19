"use client";

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Table2, Loader2, AlertCircle } from 'lucide-react';
import { dbService, NewTableColumn } from '@/services/api';
import { Callout, GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    existingTables: string[];
}

const COLUMN_TYPES = ["INT", "VARCHAR", "TEXT", "BOOLEAN", "DATE", "TIME", "DATETIME"] as const;
const VARCHAR_LENGTHS = [64, 128, 256] as const;

const newColumn = (): NewTableColumn => ({
    name: "", type: "VARCHAR", length: 128, is_pk: false, not_null: false, ref_table: "", ref_col: "",
});

const startingColumns = (): NewTableColumn[] => ([
    { name: "id", type: "INT", is_pk: true, not_null: true, length: 0, ref_table: "", ref_col: "" },
]);

const FIELD = 'w-full bg-surface border border-ink-300 rounded-md px-2 py-2 text-sm text-ink-900 '
    + 'focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all';

const MICRO_LABEL = 'text-[10px] font-semibold text-ink-400 uppercase tracking-wide block mb-1';

export const CreateTableModal = ({ isOpen, onClose, onSuccess, existingTables }: Props) => {
    const [tableName, setTableName] = useState("");
    const [columns, setColumns] = useState<NewTableColumn[]>(startingColumns);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setTableName("");
            setColumns(startingColumns());
            setError(null);
            setIsSaving(false);
        }
    }, [isOpen]);

    const updateColumn = (
        idx: number,
        field: keyof NewTableColumn,
        value: NewTableColumn[keyof NewTableColumn],
    ) => {
        setColumns(prev => prev.map((col, i) => {
            if (i !== idx) return col;
            const next = { ...col, [field]: value };

            if (field === 'type') {
                // Length only means anything for VARCHAR; carry a sensible default in.
                next.length = value === 'VARCHAR' ? (col.length || 128) : undefined;
            }
            if (field === 'ref_table') {
                next.ref_col = value ? (col.ref_col || 'id') : '';
            }
            if (field === 'is_pk' && value === true) {
                // A primary key cannot also be a foreign key into another table.
                next.ref_table = '';
                next.ref_col = '';
            }
            return next;
        }));
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const name = tableName.trim();
        if (!name) return setError("Table name is required.");
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            return setError("Use letters, digits and underscores, starting with a letter or underscore.");
        }
        if (existingTables.some(t => t.toLowerCase() === name.toLowerCase())) {
            return setError(`A table called "${name}" already exists in this file.`);
        }
        if (columns.length === 0) return setError("A table needs at least one column.");
        if (columns.some(c => !c.name.trim())) return setError("Every column needs a name.");

        const names = columns.map(c => c.name.trim().toLowerCase());
        if (new Set(names).size !== names.length) {
            return setError("Duplicate column names are not allowed (e.g. two 'id' columns).");
        }

        setIsSaving(true);
        try {
            await dbService.createTable(name, columns);
            onSuccess();
            onClose();
        } catch (err: unknown) {
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || "Failed to create the table.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="full"
            title="Create new table"
            subtitle="Define its columns, types and constraints."
            icon={<Table2 size={18} className="text-brand-600 shrink-0" />}
            closeOnBackdrop={false}
            onSubmit={handleSubmit}
            footer={
                <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-3">
                    <p className="text-xs text-ink-400 text-center sm:text-left">
                        PK = primary key &middot; NN = <span className="font-mono">NOT NULL</span>
                    </p>
                    <ModalActions>
                        <GhostButton onClick={onClose}>Cancel</GhostButton>
                        <PrimaryButton type="submit" disabled={isSaving}>
                            {isSaving && <Loader2 size={14} className="animate-spin" />}
                            {isSaving ? 'Creating...' : 'Create table'}
                        </PrimaryButton>
                    </ModalActions>
                </div>
            }
        >
            <div className="mb-6">
                <label htmlFor="create-table-name" className={MICRO_LABEL}>Table name</label>
                <input
                    id="create-table-name"
                    className={`${FIELD} font-mono py-2.5 placeholder:text-ink-400`}
                    placeholder="e.g. user_profiles"
                    value={tableName}
                    onChange={e => { setTableName(e.target.value); setError(null); }}
                />
            </div>

            <div className="flex justify-between items-center border-b border-ink-200 pb-2 mb-3">
                <span className={`${MICRO_LABEL} mb-0`}>Columns ({columns.length})</span>
                <button
                    type="button"
                    onClick={() => setColumns(prev => [...prev, newColumn()])}
                    className="text-xs font-semibold flex items-center gap-1 text-brand-600 hover:text-brand-700"
                >
                    <Plus size={14} /> Add column
                </button>
            </div>

            <div className="space-y-3">
                {columns.map((col, idx) => (
                    // Stacks on a phone, lays out in a row from `lg` up. The old fixed
                    // 12-column grid put five controls side by side at every width, which
                    // squeezed each one to about 40px on a narrow screen.
                    <div
                        key={idx}
                        className="rounded-lg border border-ink-200 bg-ink-50/60 p-3 hover:border-brand-300 transition-colors"
                    >
                        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                            <div className="lg:w-44">
                                <label className={MICRO_LABEL}>Name</label>
                                <input
                                    className={`${FIELD} font-mono placeholder:text-ink-400`}
                                    placeholder="id"
                                    value={col.name}
                                    onChange={e => updateColumn(idx, 'name', e.target.value)}
                                />
                            </div>

                            <div className="flex gap-2 lg:w-56">
                                <div className="flex-1">
                                    <label className={MICRO_LABEL}>Type</label>
                                    <select
                                        className={FIELD}
                                        value={col.type}
                                        onChange={e => updateColumn(idx, 'type', e.target.value)}
                                    >
                                        {COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                {col.type === 'VARCHAR' && (
                                    <div className="w-24">
                                        <label className={MICRO_LABEL}>Length</label>
                                        <select
                                            className={FIELD}
                                            value={col.length || 128}
                                            onChange={e => updateColumn(idx, 'length', parseInt(e.target.value))}
                                        >
                                            {VARCHAR_LENGTHS.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-4 lg:gap-3 lg:pb-2.5">
                                {([['is_pk', 'PK'], ['not_null', 'NN']] as const).map(([field, label]) => (
                                    <label
                                        key={field}
                                        className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${
                                            col[field] ? 'text-brand-700 font-semibold' : 'text-ink-500'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={Boolean(col[field])}
                                            onChange={e => updateColumn(idx, field, e.target.checked)}
                                            className="rounded bg-surface border-ink-300 text-brand-600 focus:ring-0 w-4 h-4"
                                        />
                                        {label}
                                    </label>
                                ))}
                            </div>

                            <div className="flex-1 min-w-0">
                                {!col.is_pk && (
                                    <div className="flex gap-2">
                                        <div className="flex-1 min-w-0">
                                            <label className={MICRO_LABEL}>References table</label>
                                            <select
                                                className={FIELD}
                                                value={col.ref_table || ""}
                                                onChange={e => updateColumn(idx, 'ref_table', e.target.value)}
                                            >
                                                <option value="">— none —</option>
                                                {existingTables.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                        {col.ref_table && (
                                            <div className="w-28">
                                                <label className={MICRO_LABEL}>Its column</label>
                                                <input
                                                    className={`${FIELD} font-mono placeholder:text-ink-400`}
                                                    placeholder="id"
                                                    value={col.ref_col || ""}
                                                    onChange={e => updateColumn(idx, 'ref_col', e.target.value)}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="lg:pb-1">
                                <button
                                    type="button"
                                    onClick={() => setColumns(prev => prev.filter((_, i) => i !== idx))}
                                    // A table with no columns cannot be created, so the last
                                    // row's delete is disabled rather than leading to a
                                    // validation error the user has to discover.
                                    disabled={columns.length === 1}
                                    className="w-full lg:w-auto flex items-center justify-center gap-1.5 p-2 text-ink-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-400"
                                    aria-label={`Remove column ${col.name || idx + 1}`}
                                    title={columns.length === 1 ? 'A table needs at least one column' : 'Remove column'}
                                >
                                    <Trash2 size={16} />
                                    <span className="lg:hidden text-xs font-medium">Remove column</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {error && (
                <div className="mt-4">
                    <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>
                </div>
            )}
        </Modal>
    );
};
