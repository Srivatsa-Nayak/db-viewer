"use client";

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
    Upload, FileText, Trash2, Database, HelpCircle, Download,
    ChevronDown, Files, Share2, LogIn, LogOut, User, Plus, Lock, Settings,
} from 'lucide-react';
import { AuthUser } from '@/services/api';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useDismissable } from '@/components/ui/useDismissable';

interface HeaderProps {
    onUpload: (file: File) => void;
    onNewFile: () => void;
    onClear: () => void;
    onShowInfo: () => void;
    /** Opens the export dialog, which owns every output format. */
    onExport: () => void;
    onShare: () => void;
    onSignIn: () => void;
    onSignOut: () => void;
    onEditProfile: () => void;
    isUploading: boolean;
    fileName: string | null;
    hasData: boolean;
    user: AuthUser | null;
}

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
            ${danger ? 'hover:bg-tone-error-bg' : 'hover:bg-ink-50'}`}
    >
        <span className={`mt-0.5 shrink-0 ${danger ? 'text-red-500' : 'text-brand-600'}`}>{icon}</span>
        <span className="min-w-0">
            <span className={`flex items-center gap-1.5 text-sm font-medium ${danger ? 'text-tone-error-ink' : 'text-ink-900'}`}>
                {title}
                {locked && <Lock size={11} className="text-ink-400" />}
            </span>
            <span className="block text-xs text-ink-500 mt-0.5 leading-relaxed">{description}</span>
        </span>
    </button>
);

/**
 * The shared treatment for controls on the app bar.
 *
 * Translucent white rather than solid: the bar is a blue gradient in the light theme and a dark
 * panel in the dark one, and a wash of whatever is beneath works on both — where the old solid
 * white hover state only ever worked on the gradient.
 */
const HEADER_BUTTON = 'flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-md text-sm font-medium '
    + 'transition-colors text-white/80 hover:bg-white/15 hover:text-white';

/** The open state keeps a lit treatment, so a control does not appear to switch off while its
 *  own menu is showing. */
const HEADER_BUTTON_ACTIVE = 'bg-white/20 text-white';

export const Header = ({
    onUpload, onNewFile, onClear, onShowInfo, onExport,
    onShare, onSignIn, onSignOut, onEditProfile, isUploading, fileName, hasData, user,
}: HeaderProps) => {
    const [isFileOpen, setFileOpen] = useState(false);
    const [isAccountOpen, setAccountOpen] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileRef = useDismissable(isFileOpen, () => setFileOpen(false));
    const accountRef = useDismissable(isAccountOpen, () => setAccountOpen(false));

    const run = (action: () => void) => { setFileOpen(false); action(); };

    return (
        <header className="app-header h-16 shrink-0 flex items-center justify-between px-3 sm:px-6 shadow-glow-md z-50">

            {/* Left: brand, then the File and Share controls */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <Link href="/" className="flex items-center gap-3 shrink-0" title="Back to the home page">
                    <span className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                        <Database size={18} className="text-brand-600" />
                    </span>
                    <span className="text-white font-semibold text-lg sm:text-xl tracking-tight hidden md:block">
                        SQL <span className="text-brand-200">Visualizer</span>
                    </span>
                </Link>

                <div className="h-6 w-px bg-white/25 hidden sm:block" />

                {/* FILE MENU — import and export live here */}
                <div className="relative" ref={fileRef}>
                    <button
                        type="button"
                        onClick={() => setFileOpen(v => !v)}
                        className={`${HEADER_BUTTON} ${isFileOpen ? HEADER_BUTTON_ACTIVE : ''}`}
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
                            className="absolute left-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] bg-surface border border-line rounded-lg shadow-glow-lg overflow-hidden z-50 anim-menu-in"
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
                                title={isUploading ? 'Reading the file...' : 'Import'}
                                description="Pick a .csv or .sql file. You will see what it creates before it does."
                                onClick={() => { fileInputRef.current?.click(); setFileOpen(false); }}
                            />

                            <div className="h-px bg-ink-100" />

                            {/* One entry point rather than one item per format. The formats now
                                differ in ways a menu line cannot express — a SQL export has to be
                                told which engine it is for — so the choice belongs in a dialog
                                with room to explain it. */}
                            <MenuItem
                                icon={<Download size={16} />}
                                title="Export..."
                                description="SQL for a specific engine, a PNG, Mermaid or DBML."
                                onClick={() => run(onExport)}
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
                    className={`${HEADER_BUTTON} hidden sm:flex
                        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
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

            {/* Right: current file, theme, account, help */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                {fileName && (
                    <div className="hidden md:flex items-center gap-2 bg-black/20 border border-white/20 rounded-md px-3 py-1 min-w-0">
                        <FileText size={14} className="text-white/70 shrink-0" />
                        <span className="text-xs font-medium max-w-[160px] truncate text-white/90" title={fileName}>
                            {fileName}
                        </span>
                    </div>
                )}

                {/* Beside the account rather than buried in a settings dialog: eye strain is felt
                    continuously, so the control for it has to be one click away. */}
                <ThemeToggle />

                {user ? (
                    <div className="relative" ref={accountRef}>
                        <button
                            type="button"
                            onClick={() => setAccountOpen(v => !v)}
                            className="header-cta flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-md text-sm font-semibold transition-colors"
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
                            <div role="menu" className="absolute right-0 mt-2 w-64 bg-surface border border-line rounded-lg shadow-glow-lg overflow-hidden z-50 anim-menu-in">
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
                        className="header-cta flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-semibold shadow-sm transition-colors"
                    >
                        <LogIn size={16} />
                        <span className="hidden sm:inline">Sign in</span>
                    </button>
                )}

                <button
                    type="button"
                    onClick={onShowInfo}
                    className="p-2 text-white/70 hover:text-white transition-colors shrink-0"
                    aria-label="About this app"
                    title="About this app"
                >
                    <HelpCircle size={20} />
                </button>
            </div>
        </header>
    );
};
