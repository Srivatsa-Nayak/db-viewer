"use client";

import React from 'react';
import { Plus, KeyRound, Link2, Pencil, Table } from 'lucide-react';
import { Modal, PrimaryButton } from '@/components/ui/Modal';

interface NewTableHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const STEPS = [
    {
        icon: <Table size={15} className="text-brand-600" />,
        title: 'Name the table',
        body: 'A dialog opens where you give the table a name, such as customers.',
    },
    {
        icon: <KeyRound size={15} className="text-brand-600" />,
        title: 'Define its columns',
        body: 'Each row is one column: a name, a type (with a length for VARCHAR), and the '
            + 'PK / NN toggles for primary key and NOT NULL. A new table starts with an id '
            + 'primary key, which auto-numbers itself as you add rows.',
    },
    {
        icon: <Link2 size={15} className="text-brand-600" />,
        title: 'Link it to an existing table',
        body: 'Set FK Table on any non-key column to point it at another table. That becomes '
            + 'a real foreign key, and the canvas draws it as an arrow between the two tables.',
    },
    {
        icon: <Plus size={15} className="text-brand-600" />,
        title: 'Create it',
        body: 'The table is created in this file’s database straight away and appears on the '
            + 'canvas. Nothing is staged — it runs a real CREATE TABLE.',
    },
    {
        icon: <Pencil size={15} className="text-brand-600" />,
        title: 'Change it afterwards',
        body: 'Use + on the table header to add a column, the pencil on any column to rename '
            + 'or retype it, and the pencil on the header to edit the rows.',
    },
];

/**
 * Contextual help for the canvas toolbar, sitting next to the New Table button.
 *
 * Deliberately different from the header's InfoModal: that one says what the app is, this one
 * says what the button beside it does.
 */
export const NewTableHelpModal = ({ isOpen, onClose }: NewTableHelpModalProps) => (
    <Modal
        isOpen={isOpen}
        onClose={onClose}
        size="lg"
        title="Creating a table"
        icon={
            <span className="w-6 h-6 rounded brand-gradient flex items-center justify-center shrink-0">
                <Plus size={14} className="text-white" />
            </span>
        }
        footer={<div className="flex justify-end"><PrimaryButton onClick={onClose}>Got it</PrimaryButton></div>}
    >
        <p className="text-sm text-ink-600 mb-5 leading-relaxed">
            <strong className="text-ink-900">New Table</strong> adds a table to the file
            you have open. Each file is its own database, so the table is only visible here.
        </p>

        <ol className="space-y-4">
            {STEPS.map((step, i) => (
                <li key={i} className="flex gap-3">
                    <span className="mt-0.5 w-7 h-7 rounded-full bg-brand-50 border border-brand-200 flex items-center justify-center shrink-0">
                        {step.icon}
                    </span>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900">{step.title}</p>
                        <p className="text-xs text-ink-500 leading-relaxed mt-0.5">{step.body}</p>
                    </div>
                </li>
            ))}
        </ol>
    </Modal>
);
