import { dbService } from '@/services/api';
import { Upload, RefreshCw, FileText, Trash2, Database, Download } from 'lucide-react';

interface HeaderProps {
    onUpload: (file: File) => void;
    onRefresh: () => void;
    onClear: () => void;
    isUploading: boolean;
    fileName: string | null;
    hasData: boolean; 
}


export const Header = ({ onUpload, onRefresh, onClear, isUploading, fileName, hasData }: HeaderProps) => {

    const handleDownloadSQL = () => {
        const url = dbService.getDatabaseExportUrl(fileName);
        window.open(url, '_blank');
    };
    
    return (
        <div className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shadow-md z-50">
            {/* Logo */}
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <Database size={18} className="text-white" />
                </div>
                <h1 className="text-slate-200 font-bold text-xl tracking-tight">
                    SQL <span className="text-indigo-500">Visualizer</span>
                </h1>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
                
                {/* 1. FILE BADGE (Purely Informational now) */}
                {fileName && (
                    <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-full px-3 py-1 animate-in fade-in slide-in-from-top-2 duration-300 mr-2">
                        <FileText size={14} className="text-indigo-400" />
                        <span className="text-xs font-medium max-w-[150px] truncate text-slate-300" title={fileName}>
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
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors text-white shadow-lg shadow-indigo-500/20"
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
                    className="p-2 bg-slate-800 rounded-md hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700"
                    title="Refresh Schema"
                >
                    <RefreshCw size={18} />
                </button>
                {/* 3. DOWNLOAD SQL BUTTON */}
                {hasData && (
                    <button 
                        onClick={handleDownloadSQL} 
                        className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-slate-700 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                        title="Download Modified SQL"
                    >
                        <Download size={16} />
                        <span className="hidden sm:inline">Export SQL</span>
                    </button>
                )}
                {/* 4. CLEAR DATABASE BUTTON (Only visible if there is data) */}
                {hasData && (
                    <button 
                        onClick={onClear} 
                        className="p-2 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 rounded-md text-red-400 hover:text-red-200 transition-colors ml-1"
                        title="Clear Database"
                    >
                        <Trash2 size={18} />
                    </button>
                )}
            </div>
        </div>
    );
};