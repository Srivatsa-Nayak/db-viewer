import React, { useEffect, useState } from 'react';
import { X, Info, Mail, Github } from 'lucide-react';
import { dbService } from '@/services/api';

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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center bg-white rounded-t-xl">
                    <h3 className="font-bold text-zinc-900 flex items-center gap-2 text-lg">
                        <Info size={20} className="text-blue-600" />
                        About SQL Visualizer
                        {version && (
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-[11px] font-mono font-semibold">
                                v{version}
                            </span>
                        )}
                    </h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 transition-colors" aria-label="Close">
                        <X className="text-zinc-400 hover:text-zinc-900" size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    <ul className="space-y-3 text-sm text-zinc-600">
                        {SUMMARY_LINES.map((line, i) => (
                            <li key={i} className="flex gap-3 leading-relaxed">
                                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
                                <span>{line}</span>
                            </li>
                        ))}
                    </ul>

                    {/* Credits */}
                    <div className="mt-6 pt-5 border-t border-zinc-200">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-3">
                            Built by
                        </p>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
                                SN
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-zinc-900">{DEVELOPER.name}</p>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                                    <a
                                        href={`mailto:${DEVELOPER.email}`}
                                        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-600 transition-colors"
                                    >
                                        <Mail size={12} className="shrink-0" />
                                        <span className="truncate">{DEVELOPER.email}</span>
                                    </a>
                                    <a
                                        href={DEVELOPER.github}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-600 transition-colors"
                                    >
                                        <Github size={12} className="shrink-0" />
                                        <span>Srivatsa-Nayak</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-200 bg-white rounded-b-xl flex justify-end">
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
