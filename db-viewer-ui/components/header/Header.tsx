"use client";

import { useEffect, useRef, useState } from 'react';
import {
    Upload, FileText, Trash2, Database, HelpCircle, FileCode,
    Image as ImageIcon, ChevronDown, Files, Share2, LogIn, LogOut, User, Plus, Lock
} from 'lucide-react';
import { AuthUser } from '@/services/api';

interface HeaderProps {
    onUpload: (file: File) => void;
    onNewFile: () => void;
    onClear: () => void;
    onShowInfo: () => void;
    onExportSql: () => void;
    onExportImage: () => void;
    onShare: () => void;
    onSignIn: () => void;
    onSignOut: () => void;
    isUploading: boolean;
    fileName: string | null;
    hasData: boolean;
    user: AuthUser | null;
}

/** Closes a dropdown on an outside click or Escape. */
const useDismissable = (isOpen: boolean, close: () => void) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isOpen) return;
        const onPointerDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isOpen, close]);
    return ref;
};

const MenuItem = ({ icon, title, description, onClick, disabled, locked }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    disabled?: boolean;
    locked?: boolean;
}) => (
    <button
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
    >
        <span className="text-blue-600 mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                {title}
                {locked && <Lock size={11} className="text-zinc-400" />}
            </span>
            <span className="block text-xs text-zinc-500 mt-0.5 leading-relaxed">{description}</span>
        </span>
    </button>
);

export const Header = ({
    onUpload, onNewFile, onClear, onShowInfo, onExportSql, onExportImage,
    onShare, onSignIn, onSignOut, isUploading, fileName, hasData, user,
}: HeaderProps) => {
    const [isFileOpen, setFileOpen] = useState(false);
    const [isAccountOpen, setAccountOpen] = useState(false);

    const fileRef = useDismissable(isFileOpen, () => setFileOpen(false));
    const accountRef = useDismissable(isAccountOpen, () => setAccountOpen(false));

    const run = (action: () => void) => { setFileOpen(false); action(); };

    return (
        <div className="h-16 bg-blue-600 border-b border-blue-700 flex items-center justify-between px-6 shadow-md z-50 animate-fade-up">

            {/* Left: brand, then the File and Share controls */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                        <Database size={18} className="text-blue-600" />
                    </div>
                    <h1 className="text-white font-semibold text-xl tracking-tight hidden sm:block">
                        SQL <span className="text-blue-100">Visualizer</span>
                    </h1>
                </div>

                <div className="h-6 w-px bg-blue-400/40" />

                {/* FILE MENU — import and export live here */}
                <div className="relative" ref={fileRef}>
                    <button
                        onClick={() => setFileOpen(v => !v)}
                        // Plain text until hovered, then a white button. The open state keeps
                        // that white treatment, so the control does not appear to switch off
                        // while its own menu is showing.
                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            isFileOpen
                                ? 'bg-white text-blue-700'
                                : 'text-blue-50 hover:bg-white hover:text-blue-700'
                        }`}
                        aria-haspopup="menu"
                        aria-expanded={isFileOpen}
                    >
                        <Files size={16} />
                        <span>File</span>
                        <ChevronDown size={14} className={`transition-transform ${isFileOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isFileOpen && (
                        <div role="menu" className="absolute left-0 mt-2 w-80 bg-white border border-zinc-200 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                            <MenuItem
                                icon={<Plus size={16} />}
                                title="New file"
                                description="Start an empty database of your own."
                                onClick={() => run(onNewFile)}
                            />

                            <label
                                htmlFor="fileUpload"
                                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 transition-colors cursor-pointer"
                                onClick={() => setFileOpen(false)}
                            >
                                <span className="text-blue-600 mt-0.5 shrink-0"><Upload size={16} /></span>
                                <span>
                                    <span className="block text-sm font-medium text-zinc-900">
                                        {isUploading ? 'Importing...' : 'Import'}
                                    </span>
                                    <span className="block text-xs text-zinc-500 mt-0.5 leading-relaxed">
                                        Open a .csv or .sql file in a new tab.
                                    </span>
                                </span>
                            </label>

                            <div className="h-px bg-zinc-100" />

                            <MenuItem
                                icon={<FileCode size={16} />}
                                title="Export SQL script"
                                description="Schema and data, ready to re-import or run elsewhere."
                                onClick={() => run(onExportSql)}
                                disabled={!hasData}
                                locked={!user}
                            />
                            <MenuItem
                                icon={<ImageIcon size={16} />}
                                title="Export diagram (PNG)"
                                description="A picture of the canvas — best for reading offline."
                                onClick={() => run(onExportImage)}
                                disabled={!hasData}
                            />

                            {hasData && (
                                <>
                                    <div className="h-px bg-zinc-100" />
                                    <button
                                        role="menuitem"
                                        onClick={() => run(onClear)}
                                        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-red-50 transition-colors"
                                    >
                                        <span className="text-red-500 mt-0.5 shrink-0"><Trash2 size={16} /></span>
                                        <span>
                                            <span className="block text-sm font-medium text-red-600">Close file</span>
                                            <span className="block text-xs text-zinc-500 mt-0.5">
                                                Deletes this file&apos;s database.
                                            </span>
                                        </span>
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* SHARE — right beside File */}
                <button
                    onClick={onShare}
                    disabled={!hasData}
                    // Matches the File control: plain text, white button on hover. The
                    // disabled overrides stop a dead button lighting up under the cursor.
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-blue-50 hover:bg-white hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-blue-50"
                    title={hasData ? 'Create a shareable link' : 'Open a file first'}
                >
                    <Share2 size={16} />
                    <span className="hidden sm:inline">Share</span>
                    {!user && <Lock size={11} className="opacity-70" />}
                </button>

                {/* The file input the Import menu item points at. */}
                <input
                    type="file"
                    id="fileUpload"
                    className="hidden"
                    accept=".csv, .sql"
                    value=""
                    onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
            </div>

            {/* Right: current file, account, help */}
            <div className="flex items-center gap-3">
                {fileName && (
                    <div className="flex items-center gap-2 bg-blue-700/40 border border-blue-400/40 rounded-md px-3 py-1 animate-in fade-in slide-in-from-top-2 duration-300">
                        <FileText size={14} className="text-blue-100" />
                        <span className="text-xs font-medium max-w-[160px] truncate text-blue-50" title={fileName}>
                            {fileName}
                        </span>
                    </div>
                )}

                {user ? (
                    <div className="relative" ref={accountRef}>
                        <button
                            onClick={() => setAccountOpen(v => !v)}
                            className="flex items-center gap-2 bg-white/95 hover:bg-white text-blue-700 px-3 py-2 rounded-md text-sm font-semibold transition-colors"
                            title={user.email}
                        >
                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] flex items-center justify-center font-bold">
                                {(user.displayName || user.email).charAt(0).toUpperCase()}
                            </span>
                            <span className="hidden sm:inline max-w-[110px] truncate">{user.displayName}</span>
                            <ChevronDown size={14} className={`transition-transform ${isAccountOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isAccountOpen && (
                            <div className="absolute right-0 mt-2 w-64 bg-white border border-zinc-200 rounded-lg shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="px-4 py-3 border-b border-zinc-100">
                                    <p className="text-sm font-medium text-zinc-900 flex items-center gap-2">
                                        <User size={14} className="text-zinc-400" /> {user.displayName}
                                    </p>
                                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{user.email}</p>
                                </div>
                                <button
                                    onClick={() => { setAccountOpen(false); onSignOut(); }}
                                    className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
                                >
                                    <LogOut size={14} className="text-zinc-400" /> Sign out
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <button
                        onClick={onSignIn}
                        className="flex items-center gap-2 bg-white hover:bg-blue-50 px-4 py-2 rounded-md text-sm font-semibold text-blue-700 shadow-sm transition-colors"
                    >
                        <LogIn size={16} />
                        <span>Sign in</span>
                    </button>
                )}

                <button
                    onClick={onShowInfo}
                    className="p-2 text-blue-200 hover:text-white transition-colors"
                    title="About this app"
                >
                    <HelpCircle size={20} />
                </button>
            </div>
        </div>
    );
};
