"use client";

import React from 'react';
import { X, Plus, KeyRound, Link2, Pencil, Table } from 'lucide-react';

interface NewTableHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Contextual help for the canvas toolbar, sitting next to the New Table button.
 *
 * Deliberately different from the header's InfoModal: that one says what the app is, this one
 * says what the button beside it does.
 */
export const NewTableHelpModal = ({ isOpen, onClose }: NewTableHelpModalProps) => {
    if (!isOpen) return null;

    const steps = [
        {
            icon: <Table size={15} className="text-blue-600" />,
            title: 'Name the table',
            body: 'A dialog opens where you give the table a name, such as customers.',
        },
        {
            icon: <KeyRound size={15} className="text-blue-600" />,
            title: 'Define its columns',
            body: 'Each row is one column: a name, a type (with a length for VARCHAR), and the '
                + 'PK / NN toggles for primary key and NOT NULL. A new table starts with an id '
                + 'primary key, which auto-numbers itself as you add rows.',
        },
        {
            icon: <Link2 size={15} className="text-blue-600" />,
            title: 'Link it to an existing table',
            body: 'Set FK Table on any non-key column to point it at another table. That becomes '
                + 'a real foreign key, and the canvas draws it as an arrow between the two tables.',
        },
        {
            icon: <Plus size={15} className="text-blue-600" />,
            title: 'Create it',
            body: 'The table is created in this file’s database straight away and appears on the '
                + 'canvas. Nothing is staged — it runs a real CREATE TABLE.',
        },
        {
            icon: <Pencil size={15} className="text-blue-600" />,
            title: 'Change it afterwards',
            body: 'Use + on the table header to add a column, the pencil on any column to rename '
                + 'or retype it, and the pencil on the header to edit the rows.',
        },
    ];

    return (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center rounded-t-xl">
                    <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                        <span className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center shrink-0">
                            <Plus size={14} className="text-white" />
                        </span>
                        Creating a table
                    </h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 transition-colors" aria-label="Close">
                        <X className="text-zinc-400 hover:text-zinc-900" size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    <p className="text-sm text-zinc-600 mb-5 leading-relaxed">
                        <strong className="text-zinc-900">New Table</strong> adds a table to the file
                        you have open. Each file is its own database, so the table is only visible
                        here.
                    </p>

                    <ol className="space-y-4">
                        {steps.map((step, i) => (
                            <li key={i} className="flex gap-3">
                                <span className="mt-0.5 w-7 h-7 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center shrink-0">
                                    {step.icon}
                                </span>
                                <div>
                                    <p className="text-sm font-semibold text-zinc-900">{step.title}</p>
                                    <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">{step.body}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-200 rounded-b-xl flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium shadow-sm transition-all"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
};
