"use client";

import { useMemo, useState } from 'react';
import {
    FileSpreadsheet, FileCode2, KeyRound, Loader2, AlertTriangle, ChevronDown, Database, Link2, Info,
} from 'lucide-react';
import { Modal, ModalActions, PrimaryButton, GhostButton, Callout } from '@/components/ui/Modal';
import { ImportPlan, PlannedColumn } from '@/types';

/**
 * The staging step between dropping a file and having a database.
 *
 * An import used to be irreversible from the moment the file picker closed. That is tolerable
 * when the importer is right and destructive when it is not — and on a CSV it cannot always be
 * right, because every value in the file is a string and the types are a guess made from what
 * those strings look like. The guess that matters is the postcode column: `01234` is entirely
 * digits, so the obvious answer is `INT`, and the leading zero is gone from every row before the
 * canvas has even rendered. Nothing in the database can recover it.
 *
 * So the plan is shown first. The backend has parsed the file and created nothing; this dialog
 * shows what it found, why it chose each type, and a few real values to check it against.
 * Cancel throws the whole thing away.
 */

interface ImportPreviewModalProps {
    isOpen: boolean;
    plan: ImportPlan;
    isImporting: boolean;
    /** @param typeOverrides only the columns the user actually changed */
    onConfirm: (typeOverrides: Record<string, string>) => void;
    onClose: () => void;
}

/** The types offered per column, with whatever the file suggested folded in. */
const typeChoices = (offered: string[], current: string): string[] =>
    offered.some(t => t.toLowerCase() === current.toLowerCase()) ? offered : [current, ...offered];

const columnKey = (table: string, column: string) => `${table}.${column}`;

export const ImportPreviewModal = ({
    isOpen, plan, isImporting, onConfirm, onClose,
}: ImportPreviewModalProps) => {
    // Keyed by `table.column`, which the backend accepts for both file kinds. Only what the user
    // changed is ever sent — an override that merely repeats the inference would pin a decision
    // the importer is entitled to make better next time.
    const [overrides, setOverrides] = useState<Record<string, string>>({});
    const [showNotes, setShowNotes] = useState(false);

    const isCsv = plan.type === 'csv';
    const columnCount = useMemo(
        () => plan.tables.reduce((total, table) => total + table.columns.length, 0),
        [plan.tables]
    );

    const typeFor = (table: string, column: PlannedColumn) =>
        overrides[columnKey(table, column.name)] ?? column.type;

    const setType = (table: string, column: PlannedColumn, type: string) => {
        setOverrides(previous => {
            const next = { ...previous };
            if (type === column.type) delete next[columnKey(table, column.name)];
            else next[columnKey(table, column.name)] = type;
            return next;
        });
    };

    const changedCount = Object.keys(overrides).length;
    const hasNothingToCreate = plan.tables.length === 0;

    /**
     * What each foreign key points at, for the third column of a script's preview.
     *
     * A CSV fills that column with the inference's reasoning and some real values. A script has
     * neither — its types are declared, not guessed — so the honest options were to leave a
     * column of em-dashes or to put the thing the user actually cannot see anywhere else in it:
     * which columns are about to become the edges on the canvas.
     */
    const foreignKeyTargets = useMemo(() => {
        const targets: Record<string, string> = {};
        for (const rel of plan.relationships) {
            targets[columnKey(rel.sourceTable, rel.sourceColumn)] =
                `${rel.targetTable}.${rel.targetColumn}`;
        }
        return targets;
    }, [plan.relationships]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="full"
            title="Check before importing"
            subtitle={plan.fileName}
            icon={isCsv
                ? <FileSpreadsheet size={18} className="text-brand-600" />
                : <FileCode2 size={18} className="text-brand-600" />}
            // The dialog holds unsaved decisions; a stray click on the backdrop must not discard
            // them along with the import.
            closeOnBackdrop={false}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose} disabled={isImporting}>Cancel</GhostButton>
                    <PrimaryButton
                        onClick={() => onConfirm(overrides)}
                        disabled={isImporting || hasNothingToCreate}
                    >
                        {isImporting && <Loader2 size={15} className="animate-spin" />}
                        {isImporting
                            ? 'Importing...'
                            : `Import ${plan.tables.length} table${plan.tables.length === 1 ? '' : 's'}`}
                    </PrimaryButton>
                </ModalActions>
            }
        >
            <div className="space-y-4">
                {/* What the file is, in one line. The dialect is the part worth surfacing: the
                    whole translation hangs off it, and a wrong reading shows up here rather than
                    as a table that silently did not arrive. */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-ink-100 text-ink-700 font-medium">
                        <Database size={12} className="text-ink-400" />
                        {isCsv ? 'CSV file' : `Read as ${plan.dialectLabel}`}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-ink-100 text-ink-700 font-medium">
                        {plan.tables.length} table{plan.tables.length === 1 ? '' : 's'}, {columnCount} column{columnCount === 1 ? '' : 's'}
                    </span>
                    {plan.relationships.length > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-ink-100 text-ink-700 font-medium">
                            <Link2 size={12} className="text-ink-400" />
                            {plan.relationships.length} relationship{plan.relationships.length === 1 ? '' : 's'}
                        </span>
                    )}
                    <span className="px-2 py-1 rounded-md bg-ink-100 text-ink-700 font-medium">
                        {isCsv
                            ? `${plan.dataRowCount} row${plan.dataRowCount === 1 ? '' : 's'}`
                            : `${plan.statementCount} statement${plan.statementCount === 1 ? '' : 's'}`}
                    </span>
                    {changedCount > 0 && (
                        <span className="px-2 py-1 rounded-md bg-brand-50 text-brand-700 font-semibold">
                            {changedCount} type{changedCount === 1 ? '' : 's'} changed
                        </span>
                    )}
                </div>

                {hasNothingToCreate && (
                    <Callout tone="error" icon={<AlertTriangle size={14} />}>
                        Nothing in this file could be read as a table, so importing it would leave
                        you with an empty diagram.
                    </Callout>
                )}

                {isCsv && (
                    <Callout tone="info">
                        Types below are inferred from the values in the file — change any that are
                        wrong. The one that most often needs it is an identifier made only of
                        digits: a postcode or a phone number stored as a number loses its leading
                        zeros, and they cannot be recovered afterwards.
                    </Callout>
                )}

                {plan.tables.map(table => (
                    <section key={table.name} className="border border-line rounded-lg overflow-hidden">
                        <header className="px-3 py-2 bg-ink-50 border-b border-line flex items-center gap-2">
                            <Database size={13} className="text-brand-600 shrink-0" />
                            <h3 className="font-mono text-sm font-semibold text-ink-900 truncate">
                                {table.name}
                            </h3>
                            <span className="text-[11px] text-ink-500 ml-auto shrink-0">
                                {table.columns.length} column{table.columns.length === 1 ? '' : 's'}
                            </span>
                        </header>

                        <div className="overflow-x-auto scroll-slim">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="text-left text-ink-500">
                                        <th className="px-3 py-2 font-medium">Column</th>
                                        <th className="px-3 py-2 font-medium w-[170px]">Type</th>
                                        <th className="px-3 py-2 font-medium">
                                            {isCsv ? 'Why, and what the file holds' : 'Role in the schema'}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {table.columns.map(column => {
                                        const value = typeFor(table.name, column);
                                        const changed = value !== column.type;
                                        // A primary key's type is not the user's to change: it
                                        // carries identity and auto-increment, and the importer
                                        // rewrites it to an integer key regardless.
                                        const locked = column.primaryKey;

                                        return (
                                            <tr key={column.name} className="border-t border-ink-200 align-top">
                                                <td className="px-3 py-2">
                                                    <span className="flex items-center gap-1.5 font-mono text-ink-900">
                                                        {column.primaryKey && (
                                                            <KeyRound size={11} className="text-key-pk shrink-0" />
                                                        )}
                                                        <span className="truncate">{column.name}</span>
                                                    </span>
                                                    {column.nullable && (
                                                        <span className="block text-[10px] text-ink-400 mt-0.5">
                                                            some rows are empty
                                                        </span>
                                                    )}
                                                </td>

                                                <td className="px-3 py-2">
                                                    {locked ? (
                                                        <span className="font-mono text-ink-500">{column.type}</span>
                                                    ) : (
                                                        <select
                                                            value={value}
                                                            onChange={(e) => setType(table.name, column, e.target.value)}
                                                            aria-label={`Type for ${column.name}`}
                                                            className={`w-full bg-surface border rounded-md px-2 py-1.5 font-mono text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
                                                                changed ? 'border-brand-500' : 'border-ink-300'
                                                            }`}
                                                        >
                                                            {typeChoices(plan.typeOptions, column.type).map(option => (
                                                                <option key={option} value={option}>{option}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </td>

                                                <td className="px-3 py-2 text-ink-500 leading-relaxed">
                                                    {column.primaryKey && (
                                                        <span className="block text-key-pk font-medium">
                                                            primary key
                                                        </span>
                                                    )}
                                                    {foreignKeyTargets[columnKey(table.name, column.name)] && (
                                                        <span className="flex items-center gap-1 text-key-fk font-medium">
                                                            <Link2 size={11} className="shrink-0" />
                                                            <span className="font-mono">
                                                                {foreignKeyTargets[columnKey(table.name, column.name)]}
                                                            </span>
                                                        </span>
                                                    )}
                                                    {column.reason && <span className="block">{column.reason}</span>}
                                                    {column.samples.length > 0 && (
                                                        <span className="mt-1 flex flex-wrap gap-1">
                                                            {column.samples.map((sample, i) => (
                                                                <code
                                                                    key={`${sample}-${i}`}
                                                                    className="px-1.5 py-0.5 rounded bg-ink-100 text-ink-700 font-mono text-[10px]"
                                                                >
                                                                    {sample}
                                                                </code>
                                                            ))}
                                                        </span>
                                                    )}
                                                    {!column.reason && column.samples.length === 0
                                                        && !column.primaryKey
                                                        && !foreignKeyTargets[columnKey(table.name, column.name)] && (
                                                        <span className="text-ink-400">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ))}

                {/* Collapsed by default, because on a real dump this is forty lines about
                    triggers and storage engines — but never hidden, because a table that is
                    quietly missing afterwards is explained in here.

                    A CSV's notes are a different kind of thing: nothing about a CSV can fail to
                    import, so they describe what the importer decided rather than what it had to
                    give up on, and dressing them as warnings would cry wolf. */}
                {plan.notes.length > 0 && (
                    <div className="border border-line rounded-lg overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setShowNotes(v => !v)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink-700 hover:bg-ink-50 transition-colors"
                            aria-expanded={showNotes}
                        >
                            {isCsv
                                ? <Info size={13} className="text-brand-600 shrink-0" />
                                : <AlertTriangle size={13} className="text-tone-warn-ink shrink-0" />}
                            {isCsv
                                ? `${plan.notes.length} thing${plan.notes.length === 1 ? '' : 's'} worth knowing`
                                : `${plan.notes.length} thing${plan.notes.length === 1 ? '' : 's'} in this file cannot be imported`}
                            <ChevronDown
                                size={14}
                                className={`ml-auto shrink-0 transition-transform ${showNotes ? 'rotate-180' : ''}`}
                            />
                        </button>
                        {showNotes && (
                            <ul className="border-t border-line max-h-48 overflow-y-auto scroll-slim divide-y divide-ink-200">
                                {plan.notes.map((note, i) => (
                                    <li
                                        key={i}
                                        className={`px-3 py-2 text-[11px] text-ink-600 leading-relaxed ${
                                            isCsv ? '' : 'font-mono'
                                        }`}
                                    >
                                        {note}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
};
