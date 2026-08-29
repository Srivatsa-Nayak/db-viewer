import React, { useState } from 'react';
import { X, FileCode } from 'lucide-react';

interface NewFileModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (fileName: string) => void;
    defaultName: string;
}

export const NewFileModal = ({ isOpen, onClose, onConfirm, defaultName }: NewFileModalProps) => {
    const [fileName, setFileName] = useState(defaultName);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault(); // Prevent form reload
        if (!fileName.trim()) return;

        // Ensure it ends in .sql
        let finalName = fileName.trim();
        if (!finalName.toLowerCase().endsWith('.sql')) {
            finalName += '.sql';
        }

        onConfirm(finalName);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="p-4 border-b border-zinc-200 flex justify-between items-center bg-white">
                    <h3 className="font-bold text-zinc-900 flex items-center gap-2">
                        <FileCode size={18} className="text-blue-600" />
                        New SQL File
                    </h3>
                    <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                            File name
                        </label>
                        <div className="relative">
                            <FileCode className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                            <input
                                autoFocus
                                type="text"
                                className="w-full bg-white border border-zinc-300 rounded-md py-2 pl-10 pr-4 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono text-sm"
                                value={fileName}
                                onChange={(e) => setFileName(e.target.value)}
                                onFocus={(e) => e.target.select()}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-zinc-500 hover:text-zinc-900 text-sm hover:bg-zinc-100 rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-bold shadow-sm transition-all"
                        >
                            Create
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
