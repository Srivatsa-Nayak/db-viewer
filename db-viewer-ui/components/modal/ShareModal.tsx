"use client";

import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Check, Copy, Link2, Eye } from 'lucide-react';
import { shareService } from '@/services/api';
import { Callout, GhostButton, Modal, PrimaryButton } from '@/components/ui/Modal';

interface ShareModalProps {
    isOpen: boolean;
    fileName: string | null;
    onClose: () => void;
    /** Called when the backend refuses because the user has no account. */
    onNeedsAccount: () => void;
}

export const ShareModal = ({ isOpen, fileName, onClose, onNeedsAccount }: ShareModalProps) => {
    const [link, setLink] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!isOpen || !fileName) return;

        let cancelled = false;
        setBusy(true);
        setError(null);
        setLink(null);
        setCopied(false);

        shareService.create(fileName)
            .then(result => {
                if (cancelled) return;
                setToken(result.token);
                setLink(shareService.linkFor(result.token));
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const status = err && typeof err === 'object' && 'response' in err
                    ? (err as { response?: { status?: number } }).response?.status
                    : undefined;
                if (status === 401) {
                    onClose();
                    onNeedsAccount();
                    return;
                }
                const message = err && typeof err === 'object' && 'response' in err
                    ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                    : undefined;
                setError(message || 'Could not create the share link.');
            })
            .finally(() => { if (!cancelled) setBusy(false); });

        return () => { cancelled = true; };
    }, [isOpen, fileName, onClose, onNeedsAccount]);

    const handleCopy = async () => {
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError('Could not copy automatically — select the link and copy it manually.');
        }
    };

    const handleRevoke = async () => {
        if (!token) return;
        setBusy(true);
        try {
            await shareService.revoke(token);
            setLink(null);
            setToken(null);
            onClose();
        } catch {
            setError('Could not revoke the link.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="lg"
            title="Share this file"
            subtitle={<span className="font-mono">{fileName}</span>}
            icon={<Link2 size={18} className="text-brand-600 shrink-0" />}
            footer={
                <div className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-2">
                    <GhostButton
                        onClick={handleRevoke}
                        disabled={!token || isBusy}
                        className="!text-tone-error-ink hover:!bg-tone-error-bg"
                    >
                        Revoke link
                    </GhostButton>
                    <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                </div>
            }
        >
            <div className="space-y-4">
                {isBusy && !link && (
                    <div className="flex items-center gap-2 text-sm text-ink-500 py-4 justify-center">
                        <Loader2 size={16} className="animate-spin" /> Creating link...
                    </div>
                )}

                {link && (
                    <>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                readOnly
                                value={link}
                                aria-label="Share link"
                                onFocus={e => e.target.select()}
                                className="flex-1 min-w-0 bg-ink-50 border border-ink-300 rounded-md py-2.5 px-3 text-xs text-ink-700 font-mono focus:outline-none focus:border-brand-500"
                            />
                            <PrimaryButton onClick={handleCopy} className="shrink-0">
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? 'Copied' : 'Copy'}
                            </PrimaryButton>
                        </div>

                        <Callout tone="info" icon={<Eye size={14} />}>
                            Anyone with this link can <strong>view</strong> the schema — no account
                            needed. They cannot edit anything, and the link stops working if you
                            delete the file or revoke it.
                        </Callout>
                    </>
                )}

                {error && (
                    <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>
                )}
            </div>
        </Modal>
    );
};
