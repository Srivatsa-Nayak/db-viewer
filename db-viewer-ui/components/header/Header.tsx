import { dbService } from '@/services/api';
import { Upload, RefreshCw, FileText, Trash2, Database, Download, HelpCircle } from 'lucide-react';

interface HeaderProps {
    onUpload: (file: File) => void;
    onRefresh: () => void;
    onClear: () => void;
    onShowInfo: () => void;
    isUploading: boolean;
    fileName: string | null;
    isImported: boolean;
    hasData: boolean;
}


export const Header = ({ onUpload, onRefresh, onClear, onShowInfo, isUploading, fileName, isImported, hasData }: HeaderProps) => {

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
                {/* 3. DOWNLOAD SQL BUTTON */}
                {hasData && (
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 bg-blue-700/40 hover:bg-blue-700/70 text-blue-50 hover:text-white border border-blue-400/40 px-3 py-2 rounded-md text-sm font-medium transition-colors btn-animated card-hover"
                        title="Download Modified SQL"
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export</span>
                    </button>
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
