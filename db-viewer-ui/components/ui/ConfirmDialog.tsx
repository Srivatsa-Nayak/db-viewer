"use client";

import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { DangerButton, GhostButton, Modal, ModalActions, PrimaryButton } from './Modal';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    /** The consequence, in a sentence. Say what is lost, not "are you sure?". */
    message: React.ReactNode;
    /** Secondary detail — the caveat that only matters once you have read the message. */
    detail?: React.ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    tone?: 'danger' | 'primary';
    isBusy?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

/**
 * Confirmation for a destructive action.
 *
 * The three of these in the app used to be copy-pasted overlays living inside whichever
 * component happened to trigger them, which is how two of them ended up unable to close on
 * Escape and one ended up rendering *underneath* the editor it was confirming an action in.
 */
export const ConfirmDialog = ({
    isOpen,
    title,
    message,
    detail,
    confirmLabel,
    cancelLabel = 'Cancel',
    tone = 'danger',
    isBusy = false,
    onConfirm,
    onClose,
}: ConfirmDialogProps) => {
    const Confirm = tone === 'danger' ? DangerButton : PrimaryButton;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            size="sm"
            accent={tone === 'danger' ? 'border-t-red-500' : 'border-t-brand-500'}
            icon={
                tone === 'danger'
                    ? <AlertTriangle size={18} className="text-red-500 shrink-0" />
                    : undefined
            }
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose} disabled={isBusy}>{cancelLabel}</GhostButton>
                    <Confirm onClick={onConfirm} disabled={isBusy}>
                        {isBusy && <Loader2 size={14} className="animate-spin" />}
                        {confirmLabel}
                    </Confirm>
                </ModalActions>
            }
        >
            <div className="text-sm text-ink-600 leading-relaxed">{message}</div>
            {detail && <p className="text-xs text-ink-400 mt-3 leading-relaxed">{detail}</p>}
        </Modal>
    );
};
