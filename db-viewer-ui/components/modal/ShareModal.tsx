"use client";

import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Check, Copy, Link2, Eye } from 'lucide-react';
import { shareService } from '@/services/api';

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

    if (!isOpen) return null;

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
        <div className="fixed inset-0 bg-black/60 z-[130] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">

                <div className="p-4 border-b border-zinc-200 flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                            <Link2 size={18} className="text-blue-600" />
                            Share this file
                        </h3>
                        <p className="text-xs text-zinc-500 mt-1">
                            <span className="font-mono">{fileName}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {isBusy && !link && (
                        <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center">
                            <Loader2 size={16} className="animate-spin" /> Creating link...
                        </div>
                    )}

                    {link && (
                        <>
                            <div className="flex gap-2">
                                <input
                                    readOnly
                                    value={link}
                                    onFocus={e => e.target.select()}
                                    className="flex-1 bg-zinc-50 border border-zinc-300 rounded-md py-2 px-3 text-xs text-zinc-700 font-mono focus:outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={handleCopy}
                                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium flex items-center gap-1.5 shrink-0 transition-colors"
                                >
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>

                            <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
                                <Eye size={14} className="shrink-0 mt-px" />
                                <span>
                                    Anyone with this link can <strong>view</strong> the schema — no account
                                    needed. They cannot edit anything, and the link stops working if you
                                    close the file or revoke it.
                                </span>
                            </div>
                        </>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-600">
                            <AlertCircle size={14} className="shrink-0 mt-px" />
                            <span>{error}</span>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-zinc-200 flex justify-between items-center">
                    <button
                        onClick={handleRevoke}
                        disabled={!token || isBusy}
                        className="px-3 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        Revoke link
                    </button>
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium shadow-sm transition-all"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};
