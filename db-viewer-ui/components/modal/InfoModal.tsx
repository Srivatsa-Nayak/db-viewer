import React from 'react';
import { X, Info, Database, Download, Plus } from 'lucide-react';

interface InfoModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const InfoModal = ({ isOpen, onClose }: InfoModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center bg-white rounded-t-xl">
                    <h3 className="font-bold text-zinc-900 flex items-center gap-2 text-lg">
                        <Info size={20} className="text-blue-600" />
                        SQL Visualizer Guide
                    </h3>
                    <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 transition-colors">
                        <X className="text-zinc-400 hover:text-zinc-900" size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-6 text-sm text-zinc-600">

                    <div className="space-y-2">
                        <h4 className="font-bold text-zinc-900 flex items-center gap-2">
                            <Database size={16} className="text-blue-600"/>
                            1. Visualizing Schema
                        </h4>
                        <p className="leading-relaxed">
                            Upload a <code className="bg-zinc-100 px-1 py-0.5 rounded text-zinc-700 font-mono">.sql</code> or <code className="bg-zinc-100 px-1 py-0.5 rounded text-zinc-700 font-mono">.csv</code> file to automatically generate an interactive diagram. You can drag tables to rearrange them.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <h4 className="font-bold text-zinc-900 flex items-center gap-2">
                            <Plus size={16} className="text-blue-600"/>
                            2. Editing & Creating
                        </h4>
                        <ul className="list-disc pl-5 space-y-1 text-zinc-500">
                            <li>Click <strong>New Table</strong> to add entities manually.</li>
                            <li>Define columns, types (e.g. <code className="text-xs font-mono">VARCHAR(128)</code>), and constraints.</li>
                            <li>Drag from the <span className="text-blue-600 font-bold">●</span> handle of one table to another to create Foreign Key relationships.</li>
                        </ul>
                    </div>

                    <div className="space-y-2">
                        <h4 className="font-bold text-zinc-900 flex items-center gap-2">
                            <Download size={16} className="text-blue-600"/>
                            3. Exporting
                        </h4>
                        <p className="leading-relaxed">
                            Once you are done modifying your schema, click the <strong>Export SQL</strong> button in the header. This will download a ready-to-use SQL script containing all your <code className="font-mono">CREATE TABLE</code> statements.
                        </p>
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
