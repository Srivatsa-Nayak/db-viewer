"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
    Upload, FileText, Trash2, Database, HelpCircle, FileCode,
    Image as ImageIcon, ChevronDown, Files, Share2, LogIn, LogOut, User, Plus, Lock, Settings,
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
    onEditProfile: () => void;
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

const MenuItem = ({ icon, title, description, onClick, disabled, locked, danger }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    disabled?: boolean;
    locked?: boolean;
    danger?: boolean;
}) => (
    <button
        role="menuitem"
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors
            disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
            ${danger ? 'hover:bg-red-50' : 'hover:bg-ink-50'}`}
    >
        <span className={`mt-0.5 shrink-0 ${danger ? 'text-red-500' : 'text-brand-600'}`}>{icon}</span>
        <span className="min-w-0">
            <span className={`flex items-center gap-1.5 text-sm font-medium ${danger ? 'text-red-600' : 'text-ink-900'}`}>
                {title}
                {locked && <Lock size={11} className="text-ink-400" />}
            </span>
            <span className="block text-xs text-ink-500 mt-0.5 leading-relaxed">{description}</span>
        </span>
    </button>
);

/** Plain text until hovered, then a white button — the shared treatment for header controls. */
const HEADER_BUTTON = 'flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-md text-sm font-medium transition-colors';

export const Header = ({
    onUpload, onNewFile, onClear, onShowInfo, onExportSql, onExportImage,
    onShare, onSignIn, onSignOut, onEditProfile, isUploading, fileName, hasData, user,
}: HeaderProps) => {
    const [isFileOpen, setFileOpen] = useState(false);
    const [isAccountOpen, setAccountOpen] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileRef = useDismissable(isFileOpen, () => setFileOpen(false));
    const accountRef = useDismissable(isAccountOpen, () => setAccountOpen(false));

    const run = (action: () => void) => { setFileOpen(false); action(); };

    return (
        <header className="h-16 shrink-0 brand-gradient border-b border-brand-800/40 flex items-center justify-between px-3 sm:px-6 shadow-glow-md z-50">

            {/* Left: brand, then the File and Share controls */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <Link href="/" className="flex items-center gap-3 shrink-0" title="Back to the home page">
                    <span className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                        <Database size={18} className="text-brand-600" />
                    </span>
                    <span className="text-white font-semibold text-lg sm:text-xl tracking-tight hidden md:block">
                        SQL <span className="text-brand-100">Visualizer</span>
                    </span>
                </Link>

                <div className="h-6 w-px bg-white/25 hidden sm:block" />

                {/* FILE MENU — import and export live here */}
                <div className="relative" ref={fileRef}>
                    <button
                        type="button"
                        onClick={() => setFileOpen(v => !v)}
                        // The open state keeps the white treatment, so the control does not
                        // appear to switch off while its own menu is showing.
                        className={`${HEADER_BUTTON} ${
                            isFileOpen ? 'bg-white text-brand-700' : 'text-brand-50 hover:bg-white hover:text-brand-700'
                        }`}
                        aria-haspopup="menu"
                        aria-expanded={isFileOpen}
                    >
                        <Files size={16} />
                        <span>File</span>
                        <ChevronDown size={14} className={`transition-transform ${isFileOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isFileOpen && (
                        <div
                            role="menu"
                            className="absolute left-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] bg-white border border-line rounded-lg shadow-glow-lg overflow-hidden z-50 anim-menu-in"
                        >
                            <MenuItem
                                icon={<Plus size={16} />}
                                title="New file"
                                description="Start an empty database of your own."
                                onClick={() => run(onNewFile)}
                            />

                            {/* Opens the file input through a ref rather than a <label htmlFor>.
                                A label's "forward my click to the input" step is a *default
                                action* the browser runs after the listeners do - and this item
                                has to close the menu, which unmounts the label before that step
                                is reached, so the picker never opened. Calling click() directly
                                does not depend on the element still being in the document. */}
                            <MenuItem
                                icon={<Upload size={16} />}
                                title={isUploading ? 'Importing...' : 'Import'}
                                description="Open a .csv or .sql file in a new tab."
                                onClick={() => { fileInputRef.current?.click(); setFileOpen(false); }}
                            />

                            <div className="h-px bg-ink-100" />

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

                            {/* Share lives in the menu too below sm, where its own button is hidden. */}
                            <div className="sm:hidden">
                                <div className="h-px bg-ink-100" />
                                <MenuItem
                                    icon={<Share2 size={16} />}
                                    title="Share"
                                    description="Create a read-only link to this file."
                                    onClick={() => run(onShare)}
                                    disabled={!hasData}
                                    locked={!user}
                                />
                            </div>

                            {hasData && (
                                <>
                                    <div className="h-px bg-ink-100" />
                                    <MenuItem
                                        icon={<Trash2 size={16} />}
                                        title="Delete file"
                                        description="Permanently deletes this file and its database."
                                        onClick={() => run(onClear)}
                                        danger
                                    />
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* SHARE — right beside File, from sm up */}
                <button
                    type="button"
                    onClick={onShare}
                    disabled={!hasData}
                    className={`${HEADER_BUTTON} hidden sm:flex text-brand-50 hover:bg-white hover:text-brand-700
                        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-brand-50`}
                    title={hasData ? 'Create a shareable link' : 'Open a file first'}
                >
                    <Share2 size={16} />
                    <span className="hidden md:inline">Share</span>
                    {!user && <Lock size={11} className="opacity-70" />}
                </button>

                {/* The file input the Import menu item opens. It lives outside the dropdown
                    on purpose, so closing the menu cannot unmount it mid-click.

                    The value is cleared after each pick rather than being bound as a prop: a
                    file input's value cannot be controlled by React, and resetting it here is
                    what lets the same file be chosen twice in a row and still fire onChange. */}
                <input
                    ref={fileInputRef}
                    type="file"
                    id="fileUpload"
                    className="hidden"
                    accept=".csv, .sql"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) onUpload(file);
                    }}
                />
            </div>

            {/* Right: current file, account, help */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                {fileName && (
                    <div className="hidden md:flex items-center gap-2 bg-black/15 border border-white/25 rounded-md px-3 py-1 min-w-0">
                        <FileText size={14} className="text-brand-100 shrink-0" />
                        <span className="text-xs font-medium max-w-[160px] truncate text-brand-50" title={fileName}>
                            {fileName}
                        </span>
                    </div>
                )}

                {user ? (
                    <div className="relative" ref={accountRef}>
                        <button
                            type="button"
                            onClick={() => setAccountOpen(v => !v)}
                            className="flex items-center gap-2 bg-white/95 hover:bg-white text-brand-700 px-2.5 sm:px-3 py-2 rounded-md text-sm font-semibold transition-colors"
                            title={user.email}
                            aria-haspopup="menu"
                            aria-expanded={isAccountOpen}
                        >
                            <span className="w-5 h-5 rounded-full brand-gradient text-white text-[10px] flex items-center justify-center font-bold shrink-0">
                                {(user.displayName || user.email).charAt(0).toUpperCase()}
                            </span>
                            <span className="hidden sm:inline max-w-[110px] truncate">{user.displayName}</span>
                            <ChevronDown size={14} className={`transition-transform ${isAccountOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isAccountOpen && (
                            <div role="menu" className="absolute right-0 mt-2 w-64 bg-white border border-line rounded-lg shadow-glow-lg overflow-hidden z-50 anim-menu-in">
                                <div className="px-4 py-3 border-b border-ink-100">
                                    <p className="text-sm font-medium text-ink-900 flex items-center gap-2">
                                        <User size={14} className="text-ink-400 shrink-0" />
                                        <span className="truncate">{user.displayName}</span>
                                    </p>
                                    <p className="text-xs text-ink-500 mt-0.5 truncate">{user.email}</p>
                                </div>
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setAccountOpen(false); onEditProfile(); }}
                                    className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-ink-700 hover:bg-ink-50 transition-colors"
                                >
                                    <Settings size={14} className="text-ink-400" /> Edit profile
                                </button>
                                <div className="h-px bg-ink-100" />
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setAccountOpen(false); onSignOut(); }}
                                    className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-ink-700 hover:bg-ink-50 transition-colors"
                                >
                                    <LogOut size={14} className="text-ink-400" /> Sign out
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={onSignIn}
                        className="flex items-center gap-2 bg-white hover:bg-brand-50 px-3 sm:px-4 py-2 rounded-md text-sm font-semibold text-brand-700 shadow-sm transition-colors"
                    >
                        <LogIn size={16} />
                        <span className="hidden sm:inline">Sign in</span>
                    </button>
                )}

                <button
                    type="button"
                    onClick={onShowInfo}
                    className="p-2 text-brand-100 hover:text-white transition-colors shrink-0"
                    aria-label="About this app"
                    title="About this app"
                >
                    <HelpCircle size={20} />
                </button>
            </div>
        </header>
    );
};
