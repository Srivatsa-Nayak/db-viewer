"use client";

import React from 'react';
import { FileCode, Loader2, Plus, Sparkles } from 'lucide-react';

/** What the editor shows with no file open: restoring the last session, or a way to start. */
export const EmptyEditorState = ({ isRestoring, isLoadingExample, onLoadExample, onNewFile }: {
    isRestoring: boolean;
    isLoadingExample: boolean;
    onLoadExample: () => void;
    onNewFile: () => void;
}) => {
    if (isRestoring) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-surface text-ink-400 gap-3">
                <Loader2 size={28} className="animate-spin text-brand-500" />
                <p className="text-sm text-ink-500">Restoring your files...</p>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col items-center justify-center bg-surface text-ink-400 gap-4 px-6">
            <div className="w-16 h-16 bg-ink-100 rounded-full flex items-center justify-center shadow-inner">
                <FileCode size={32} className="opacity-40" />
            </div>
            <div className="text-center max-w-sm">
                <p className="text-base font-semibold text-ink-700 mb-1">Nothing open yet</p>
                <p className="text-sm text-ink-500 mb-5 leading-relaxed">
                    Load the example to see what a schema looks like here, or start
                    an empty file of your own.
                </p>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
                    <button
                        onClick={onLoadExample}
                        disabled={isLoadingExample}
                        className="px-4 py-2.5 brand-gradient brand-gradient-hover disabled:opacity-60 text-white rounded-md text-sm font-semibold flex items-center justify-center gap-2 shadow-glow-sm transition-all"
                    >
                        {isLoadingExample
                            ? <Loader2 size={16} className="animate-spin" />
                            : <Sparkles size={16} />}
                        Show me an example
                    </button>
                    <button
                        onClick={onNewFile}
                        className="px-4 py-2.5 bg-surface border border-ink-300 hover:bg-ink-50 text-ink-700 rounded-md text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
                    >
                        <Plus size={16} /> New file
                    </button>
                </div>
            </div>
        </div>
    );
};
