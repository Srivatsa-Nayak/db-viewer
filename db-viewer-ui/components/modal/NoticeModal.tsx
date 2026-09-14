"use client";

import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal, PrimaryButton } from '@/components/ui/Modal';

export type NoticeSeverity = 'error' | 'warning' | 'success';

export interface Notice {
    isOpen: boolean;
    severity: NoticeSeverity;
    title: string;
    message: string;
    /** Per-statement problems from an import; collapsed by default so the modal stays readable. */
    details?: string[];
}

const STYLES: Record<NoticeSeverity, {
    icon: React.ReactNode;
    accent: string;
    detailBox: string;
}> = {
    error: {
        icon: <AlertCircle size={20} className="text-red-500 shrink-0" />,
        accent: 'border-t-red-500',
        detailBox: 'bg-red-50 border-red-200 text-red-700',
    },
    warning: {
        icon: <AlertTriangle size={20} className="text-amber-500 shrink-0" />,
        accent: 'border-t-amber-500',
        detailBox: 'bg-amber-50 border-amber-200 text-amber-800',
    },
    success: {
        icon: <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />,
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
export const NoticeModal = ({ notice, onClose }: { notice: Notice; onClose: () => void }) => {
    // Starts collapsed every time. The page mounts this only while a notice is showing, so
    // the next notice gets a fresh component rather than the previous one's disclosure state.
    const [showDetails, setShowDetails] = useState(false);

    const style = STYLES[notice.severity];
    const details = notice.details ?? [];

    return (
        <Modal
            isOpen={notice.isOpen}
            onClose={onClose}
            size="lg"
            title={notice.title}
            icon={style.icon}
            accent={style.accent}
            footer={<div className="flex justify-end"><PrimaryButton onClick={onClose}>Close</PrimaryButton></div>}
        >
            <p className="text-sm text-ink-600 leading-relaxed">{notice.message}</p>

            {details.length > 0 && (
                <div className="mt-4">
                    <button
                        type="button"
                        onClick={() => setShowDetails(v => !v)}
                        aria-expanded={showDetails}
                        className="flex items-center gap-1.5 text-xs font-semibold text-ink-500 hover:text-ink-800 transition-colors"
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
        </Modal>
    );
};
