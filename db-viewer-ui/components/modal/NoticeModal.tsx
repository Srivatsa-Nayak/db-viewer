"use client";

import React, { useState } from 'react';
import { X, AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

export type NoticeSeverity = 'error' | 'warning' | 'success';

export interface Notice {
    isOpen: boolean;
    severity: NoticeSeverity;
    title: string;
    message: string;
    /** Per-statement problems from an import; collapsed by default so the modal stays readable. */
    details?: string[];
}

interface NoticeModalProps {
    notice: Notice;
    onClose: () => void;
}

const STYLES: Record<NoticeSeverity, {
    icon: React.ReactNode;
    accent: string;
    detailBox: string;
}> = {
    error: {
        icon: <AlertCircle size={22} className="text-red-500" />,
        accent: 'border-t-red-500',
        detailBox: 'bg-red-50 border-red-200 text-red-700',
    },
    warning: {
        icon: <AlertTriangle size={22} className="text-amber-500" />,
        accent: 'border-t-amber-500',
        detailBox: 'bg-amber-50 border-amber-200 text-amber-800',
    },
    success: {
        icon: <CheckCircle2 size={22} className="text-emerald-500" />,
        accent: 'border-t-emerald-500',
        detailBox: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    },
};

/**
 * One modal for anything the app needs to tell the user about an operation.
 *
 * It exists mainly for imports: a `.sql` dump is rarely fully portable, and statements that
 * could not be run used to be logged on the server and nowhere else - so a failed import looked
 * identical to an empty file.
 */
export const NoticeModal = ({ notice, onClose }: NoticeModalProps) => {
    const [showDetails, setShowDetails] = useState(false);

    if (!notice.isOpen) return null;

    const style = STYLES[notice.severity];
    const details = notice.details ?? [];

    return (
        <div className="fixed inset-0 bg-black/60 z-[130] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
            <div className={`bg-white border border-zinc-200 border-t-4 ${style.accent} rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]`}>

                <div className="p-4 border-b border-zinc-200 flex justify-between items-start gap-3">
                    <div className="flex gap-3">
                        <span className="mt-0.5 shrink-0">{style.icon}</span>
                        <div>
                            <h3 className="font-bold text-zinc-900">{notice.title}</h3>
                            <p className="text-sm text-zinc-600 mt-1 leading-relaxed">{notice.message}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors shrink-0"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {details.length > 0 && (
                    <div className="px-4 py-3 overflow-y-auto">
                        <button
                            onClick={() => setShowDetails(v => !v)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-800 transition-colors"
                        >
                            {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            {showDetails ? 'Hide' : 'Show'} {details.length} detail{details.length === 1 ? '' : 's'}
                        </button>

                        {showDetails && (
                            <ul className={`mt-2 space-y-1.5 p-3 rounded-md border text-[11px] font-mono leading-relaxed ${style.detailBox}`}>
                                {details.map((detail, i) => (
                                    <li key={i} className="break-words">{detail}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                <div className="p-4 border-t border-zinc-200 flex justify-end mt-auto">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium shadow-sm transition-all"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
