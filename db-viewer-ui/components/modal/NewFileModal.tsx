"use client";

import React, { useRef, useState } from 'react';
import { FileCode } from 'lucide-react';
import { GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';

interface NewFileModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (fileName: string) => void;
    defaultName: string;
}

export const NewFileModal = ({ isOpen, onClose, onConfirm, defaultName }: NewFileModalProps) => {
    // Seeded once, at mount. The page renders this dialog only while it is open, so
    // mounting *is* the reset — which is also why the old `key`-bumping trick that used to
    // force a remount (and threw away the dialog's focus bookkeeping with it) is gone.
    const [fileName, setFileName] = useState(defaultName);
    const inputRef = useRef<HTMLInputElement>(null);

    const trimmed = fileName.trim();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!trimmed) return;
        onConfirm(trimmed.toLowerCase().endsWith('.sql') ? trimmed : `${trimmed}.sql`);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="New SQL file"
            subtitle="Starts an empty database of its own."
            icon={<FileCode size={18} className="text-brand-600 shrink-0" />}
            size="md"
            closeOnBackdrop={false}
            initialFocusRef={inputRef}
            onSubmit={handleSubmit}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose}>Cancel</GhostButton>
                    <PrimaryButton type="submit" disabled={!trimmed}>Create</PrimaryButton>
                </ModalActions>
            }
        >
            <label htmlFor="new-file-name" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                File name
            </label>
            <div className="relative">
                <FileCode className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" size={16} />
                <input
                    id="new-file-name"
                    ref={inputRef}
                    type="text"
                    className="w-full bg-white border border-ink-300 rounded-md py-2.5 pl-10 pr-4 text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all font-mono text-sm"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    onFocus={(e) => e.target.select()}
                />
            </div>
            <p className="text-xs text-ink-400 mt-2">
                <span className="font-mono">.sql</span> is added for you if you leave it off.
            </p>
        </Modal>
    );
};
