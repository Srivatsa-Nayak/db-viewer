"use client";

import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Lock, Mail, User, Check } from 'lucide-react';
import { authService, AuthUser } from '@/services/api';

interface AuthModalProps {
    isOpen: boolean;
    /** What the user was trying to do, so the prompt explains why they are being asked. */
    reason?: string | null;
    onClose: () => void;
    onSignedIn: (user: AuthUser) => void;
}

type Mode = 'signup' | 'login';

/**
 * Mirrors the server-side policy in AuthService.validatePassword.
 *
 * Shown live while typing rather than only on submit: the backend is still the authority, this
 * just stops the user discovering the rules one rejected attempt at a time.
 */
const PASSWORD_RULES: { label: string; test: (value: string) => boolean }[] = [
    { label: 'At least 8 characters', test: v => v.length >= 8 },
    { label: 'A capital letter', test: v => /[A-Z]/.test(v) },
    { label: 'A special character', test: v => /[^A-Za-z0-9]/.test(v) },
];

export const AuthModal = ({ isOpen, reason, onClose, onSignedIn }: AuthModalProps) => {
    const [mode, setMode] = useState<Mode>('signup');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Set when signup is refused because the address already has an account. Held separately
    // from `error` so it can be shown as an offer to sign in rather than a dead end.
    const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setMode(reason ? 'signup' : 'login');
            setEmail('');
            setPassword('');
            setDisplayName('');
            setError(null);
            setDuplicateEmail(null);
            setBusy(false);
        }
    }, [isOpen, reason]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const unmetRules = PASSWORD_RULES.filter(rule => !rule.test(password));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (mode === 'signup' && unmetRules.length > 0) {
            setError('Please meet all the password requirements below.');
            return;
        }
        setBusy(true);
        setError(null);
        setDuplicateEmail(null);
        try {
            const user = mode === 'signup'
                ? await authService.signup(email.trim(), password, displayName.trim())
                : await authService.login(email.trim(), password);
            onSignedIn(user);
            onClose();
        } catch (err: unknown) {
            const data = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { data?: { error?: string; emailAlreadyRegistered?: boolean; email?: string } } }).response?.data
                : undefined;

            if (data?.emailAlreadyRegistered) {
                setDuplicateEmail(data.email ?? email.trim());
            } else {
                setError(data?.error || 'Something went wrong. Please try again.');
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[140] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="bg-white border border-zinc-200 rounded-xl w-full max-w-md shadow-2xl overflow-hidden">

                <div className="p-4 border-b border-zinc-200 flex justify-between items-start">
                    <div>
                        <h3 className="font-bold text-zinc-900">
                            {mode === 'signup' ? 'Create your free account' : 'Welcome back'}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                            {reason
                                ? `${reason} needs an account. Everything else — importing, editing and visualising — stays free and open.`
                                : 'Sign in to export files and create share links.'}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors shrink-0" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                {/* Mode switch */}
                <div className="flex border-b border-zinc-200">
                    {(['signup', 'login'] as Mode[]).map(m => (
                        <button
                            key={m}
                            onClick={() => { setMode(m); setError(null); setDuplicateEmail(null); }}
                            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                                mode === m
                                    ? 'text-blue-700 border-b-2 border-blue-600 bg-blue-50/50'
                                    : 'text-zinc-500 hover:text-zinc-800'
                            }`}
                        >
                            {m === 'signup' ? 'Sign up' : 'Sign in'}
                        </button>
                    ))}
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {mode === 'signup' && (
                        <div>
                            <label htmlFor="auth-name" className="block text-xs font-bold text-zinc-500 uppercase mb-2">
                                Name <span className="font-normal normal-case text-zinc-400">(optional)</span>
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                                <input
                                    id="auth-name"
                                    className="w-full bg-white border border-zinc-300 rounded-md py-2 pl-10 pr-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    value={displayName}
                                    onChange={e => setDisplayName(e.target.value)}
                                    placeholder="Ada Lovelace"
                                />
                            </div>
                        </div>
                    )}

                    <div>
                        <label htmlFor="auth-email" className="block text-xs font-bold text-zinc-500 uppercase mb-2">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                            <input
                                id="auth-email"
                                autoFocus
                                type="email"
                                autoComplete="email"
                                className="w-full bg-white border border-zinc-300 rounded-md py-2 pl-10 pr-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                value={email}
                                onChange={e => { setEmail(e.target.value); setError(null); setDuplicateEmail(null); }}
                                placeholder="you@example.com"
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="auth-password" className="block text-xs font-bold text-zinc-500 uppercase mb-2">Password</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                            <input
                                id="auth-password"
                                type="password"
                                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                                className="w-full bg-white border border-zinc-300 rounded-md py-2 pl-10 pr-3 text-sm text-zinc-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                value={password}
                                onChange={e => { setPassword(e.target.value); setError(null); }}
                                placeholder={mode === 'signup' ? 'Choose a strong password' : ''}
                            />
                        </div>
                    </div>

                    {mode === 'signup' && (
                        <ul className="space-y-1.5 -mt-1">
                            {PASSWORD_RULES.map(rule => {
                                const met = rule.test(password);
                                return (
                                    <li key={rule.label} className="flex items-center gap-2 text-xs">
                                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                                            met ? 'bg-emerald-500' : 'bg-zinc-200'
                                        }`}>
                                            {met && <Check size={9} className="text-white" strokeWidth={3.5} />}
                                        </span>
                                        <span className={met ? 'text-emerald-600' : 'text-zinc-400'}>
                                            {rule.label}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {duplicateEmail && (
                        <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <div>
                                <p className="leading-relaxed">
                                    An account with <strong className="font-mono">{duplicateEmail}</strong> already
                                    exists.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Carry the address over so they do not retype it.
                                        setMode('login');
                                        setEmail(duplicateEmail);
                                        setPassword('');
                                        setDuplicateEmail(null);
                                        setError(null);
                                    }}
                                    className="mt-1.5 font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
                                >
                                    Sign in instead
                                </button>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-600">
                            <AlertCircle size={14} className="shrink-0 mt-px" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isBusy || (mode === 'signup' && unmetRules.length > 0)}
                        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md text-sm font-bold shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                        {isBusy && <Loader2 size={14} className="animate-spin" />}
                        {mode === 'signup' ? 'Create account' : 'Sign in'}
                    </button>

                    <p className="text-[11px] text-zinc-400 text-center leading-relaxed">
                        This is a demo application. Please don&apos;t reuse a password from anywhere else.
                    </p>
                </form>
            </div>
        </div>
    );
};
