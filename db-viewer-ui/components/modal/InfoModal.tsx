"use client";

import React, { useEffect, useState } from 'react';
import { Info, Mail, Github } from 'lucide-react';
import { dbService } from '@/services/api';
import { Modal, PrimaryButton } from '@/components/ui/Modal';

interface InfoModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * A short "what is this app for" blurb, plus who built it. Deliberately five lines - it is a
 * glance, not a manual. Help for a specific control belongs next to that control instead
 * (see NewTableHelpModal).
 */
const SUMMARY_LINES = [
    "Turn a .csv or .sql file into a live entity-relationship diagram you can explore.",
    "Every file you open is its own independent database, so two files can reuse the same table names.",
    "Create tables, add columns, and edit or delete rows straight from the canvas.",
    "Foreign keys are drawn for you, so you can see how your tables connect at a glance.",
    "Export any single table as CSV, or the whole file as a ready-to-run SQL script.",
];

const DEVELOPER = {
    name: "Srivatsa Nayak",
    email: "nayaksrivatsa15@gmail.com",
    github: "https://github.com/Srivatsa-Nayak",
};

export const InfoModal = ({ isOpen, onClose }: InfoModalProps) => {
    // Version comes from the backend's pom.xml, so the badge cannot drift from the build.
    const [version, setVersion] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen || version) return;
        let cancelled = false;
        dbService.getVersion().then(v => { if (!cancelled) setVersion(v); });
        return () => { cancelled = true; };
    }, [isOpen, version]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="lg"
            icon={<Info size={18} className="text-brand-600 shrink-0" />}
            title={
                <span className="flex items-center gap-2">
                    About SQL Visualizer
                    {version && (
                        <span className="px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-[11px] font-mono font-semibold">
                            v{version}
                        </span>
                    )}
                </span>
            }
            footer={<div className="flex justify-end"><PrimaryButton onClick={onClose}>Got it</PrimaryButton></div>}
        >
            <ul className="space-y-3 text-sm text-ink-600">
                {SUMMARY_LINES.map((line, i) => (
                    <li key={i} className="flex gap-3 leading-relaxed">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand-600 shrink-0" />
                        <span>{line}</span>
                    </li>
                ))}
            </ul>

            <div className="mt-6 pt-5 border-t border-ink-200">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400 mb-3">
                    Built by
                </p>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full brand-gradient text-white flex items-center justify-center font-bold text-sm shrink-0">
                        SN
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900">{DEVELOPER.name}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                            <a
                                href={`mailto:${DEVELOPER.email}`}
                                className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-brand-600 transition-colors min-w-0"
                            >
                                <Mail size={12} className="shrink-0" />
                                <span className="truncate">{DEVELOPER.email}</span>
                            </a>
                            <a
                                href={DEVELOPER.github}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-brand-600 transition-colors"
                            >
                                <Github size={12} className="shrink-0" />
                                <span>Srivatsa-Nayak</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};
