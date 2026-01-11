import React, { useState, useEffect } from 'react';
import { X, Download, FileText } from 'lucide-react';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (fileName: string) => void;
    defaultName: string;
}

export const ExportModal = ({ isOpen, onClose, onConfirm, defaultName }: ExportModalProps) => {
    const [fileName, setFileName] = useState("");

    // Reset filename when modal opens
    useEffect(() => {
        if (isOpen) {
            setFileName(defaultName ? `modified_${defaultName}` : 'database_dump.sql');
        }
    }, [isOpen, defaultName]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault(); // Prevent form reload
        if (!fileName.trim()) return;
        
        // Ensure it ends in .sql
        let finalName = fileName;
        if (!finalName.toLowerCase().endsWith('.sql')) {
            finalName += '.sql';
        }
        
        onConfirm(finalName);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">
                
                {/* Header */}
                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <Download size={18} className="text-indigo-400" /> 
                        Export Database
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">
                            Filename
                        </label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-2.5 text-slate-500" size={16} />
                            <input 
                                autoFocus
                                type="text"
                                className="w-full bg-slate-800 border border-slate-600 rounded-md py-2 pl-10 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all font-mono text-sm"
                                value={fileName}
                                onChange={(e) => setFileName(e.target.value)}
                            />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-2">
                            The file will be saved to your downloads folder.
                        </p>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button 
                            type="button"
                            onClick={onClose} 
                            className="px-4 py-2 text-slate-300 hover:text-white text-sm hover:bg-slate-800 rounded-md transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit"
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
                        >
                            <Download size={16} />
                            Export SQL
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};