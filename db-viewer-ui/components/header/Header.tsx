import { useEffect, useRef, useState } from 'react';
import { dbService } from '@/services/api';
import { Upload, RefreshCw, FileText, Trash2, Database, Download, HelpCircle, FileCode, Image as ImageIcon, ChevronDown } from 'lucide-react';

interface HeaderProps {
    onUpload: (file: File) => void;
    onRefresh: () => void;
    onClear: () => void;
    onShowInfo: () => void;
    /** Downloads the canvas as a PNG. Owned by the page, which holds the nodes. */
    onExportImage: () => void;
    isUploading: boolean;
    fileName: string | null;
    isImported: boolean;
    hasData: boolean;
}


export const Header = ({ onUpload, onRefresh, onClear, onShowInfo, onExportImage, isUploading, fileName, isImported, hasData }: HeaderProps) => {
    const [isExportOpen, setExportOpen] = useState(false);
    const exportRef = useRef<HTMLDivElement>(null);

    // Close the menu on an outside click or Escape.
    useEffect(() => {
        if (!isExportOpen) return;
        const onPointerDown = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
                setExportOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setExportOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isExportOpen]);

    const handleExport = () => {
        let downloadName = fileName || 'database_dump.sql';
        if (isImported) {
            downloadName = `modified_${downloadName}`;
        }
        if (!downloadName.toLowerCase().endsWith('.sql')) {
            downloadName += '.sql';
        }

        try {
            const url = dbService.getDatabaseExportUrl(downloadName);

            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', downloadName);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    return (
        <div className="h-16 bg-blue-600 border-b border-blue-700 flex items-center justify-between px-6 shadow-md z-50 animate-fade-up">
            {/* Logo */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm card-hover btn-animated">
                    <Database size={18} className="text-blue-600" />
                </div>
                <h1 className="text-white font-semibold text-xl tracking-tight">
                    SQL <span className="text-blue-100">Visualizer</span>
                </h1>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">

                {/* 1. FILE BADGE (Purely Informational now) */}
                {fileName && (
                    <div className="flex items-center gap-2 bg-blue-700/40 border border-blue-400/40 rounded-md px-3 py-1 animate-in fade-in slide-in-from-top-2 duration-300 mr-2 card-hover animate-fade-up">
                        <FileText size={14} className="text-blue-100" />
                        <span className="text-xs font-medium max-w-[150px] truncate text-blue-50" title={fileName}>
                            {fileName}
                        </span>
                    </div>
                )}

                {/* 2. UPLOAD BUTTON (Always Visible) */}
                <input
                    type="file"
                    id="fileUpload"
                    className="hidden"
                    accept=".csv, .sql"
                    value="" // Reset so you can upload same file again
                    onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
                <label
                    htmlFor="fileUpload"
                    className="flex items-center gap-2 bg-white hover:bg-blue-50 px-4 py-2 rounded-md text-sm font-semibold cursor-pointer transition-colors text-blue-700 shadow-sm btn-animated card-hover"
                >
                    {isUploading ? (
                        <span className="animate-pulse">Uploading...</span>
                    ) : (
                        <>
                            <Upload size={16} />
                            <span>Import</span>
                        </>
                    )}
                </label>

                {/* 3. REFRESH BUTTON */}
                <button
                    onClick={onRefresh}
                    className="p-2 bg-blue-700/40 rounded-md hover:bg-blue-700/70 text-blue-50 hover:text-white transition-colors border border-blue-400/40 btn-animated"
                    title="Refresh Schema"
                >
                    <RefreshCw size={18} />
                </button>
                {/* 3. EXPORT MENU: SQL script or a picture of the diagram */}
                {hasData && (
                    <div className="relative" ref={exportRef}>
                        <button
                            onClick={() => setExportOpen(v => !v)}
                            className="flex items-center gap-2 bg-blue-700/40 hover:bg-blue-700/70 text-blue-50 hover:text-white border border-blue-400/40 px-3 py-2 rounded-md text-sm font-medium transition-colors btn-animated card-hover"
                            title="Export this file"
                            aria-haspopup="menu"
                            aria-expanded={isExportOpen}
                        >
                            <Download size={16} />
                            <span className="hidden sm:inline">Export</span>
                            <ChevronDown size={14} className={`transition-transform ${isExportOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isExportOpen && (
                            <div
                                role="menu"
                                className="absolute right-0 mt-2 w-72 bg-white border border-zinc-200 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150"
                            >
                                <button
                                    role="menuitem"
                                    onClick={() => { setExportOpen(false); handleExport(); }}
                                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
                                >
                                    <FileCode size={16} className="text-blue-600 mt-0.5 shrink-0" />
                                    <span>
                                        <span className="block text-sm font-medium text-zinc-900">SQL script</span>
                                        <span className="block text-xs text-zinc-500 mt-0.5">
                                            Schema and data, ready to re-import or run elsewhere.
                                        </span>
                                    </span>
                                </button>

                                <div className="h-px bg-zinc-100" />

                                <button
                                    role="menuitem"
                                    onClick={() => { setExportOpen(false); onExportImage(); }}
                                    className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors"
                                >
                                    <ImageIcon size={16} className="text-blue-600 mt-0.5 shrink-0" />
                                    <span>
                                        <span className="block text-sm font-medium text-zinc-900">Diagram image (PNG)</span>
                                        <span className="block text-xs text-zinc-500 mt-0.5">
                                            The whole canvas as a picture - best for reading the
                                            tables offline or pasting into a doc.
                                        </span>
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {/* 4. CLEAR DATABASE BUTTON (Only visible if there is data) */}
                {hasData && (
                    <button
                        onClick={onClear}
                        className="p-2 bg-red-500/20 hover:bg-red-500/40 border border-red-300/50 rounded-md text-red-50 hover:text-white transition-colors ml-1 btn-animated card-hover"
                        title="Clear Database"
                    >
                        <Trash2 size={18} />
                    </button>
                )}
                {/* 6. INFO / HELP (NEW) */}
                <button
                    onClick={onShowInfo}
                    className="p-2 text-blue-200 hover:text-white transition-colors ml-1 btn-animated"
                    title="Help & Info"
                >
                    <HelpCircle size={20} />
                </button>
            </div>
        </div>
    );
};
