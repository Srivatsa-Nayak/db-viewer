import { Upload, RefreshCw, Database } from 'lucide-react';

interface HeaderProps {
    onUpload: (file: File) => void;
    onRefresh: () => void;
    isUploading: boolean;
}

export const Header = ({ onUpload, onRefresh, isUploading }: HeaderProps) => {
    return (
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900">
            <h1 className="font-bold text-xl text-indigo-400 flex items-center gap-2">
                <Database size={20} /> Database Visualizer
            </h1>
            <div className="flex gap-4">
                <input
                    type="file"
                    id="csvUpload"
                    className="hidden"
                    accept=".csv"
                    onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
                <label
                    htmlFor="csvUpload"
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors text-white"
                >
                    {isUploading ? "Uploading..." : <><Upload size={16} /> Upload CSV</>}
                </label>
                <button onClick={onRefresh} className="p-2 bg-slate-800 rounded hover:bg-slate-700 text-white">
                    <RefreshCw size={16} />
                </button>
            </div>
        </header>
    );
};