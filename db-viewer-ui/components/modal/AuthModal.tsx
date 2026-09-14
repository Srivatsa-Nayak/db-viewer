"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Mail, User, Check } from 'lucide-react';
import { authService, AuthUser } from '@/services/api';
import { Callout, Modal } from '@/components/ui/Modal';
import { PasswordField } from '@/components/ui/PasswordField';

type Mode = 'signup' | 'login';

interface AuthModalProps {
    isOpen: boolean;
    /** What the user was trying to do, so the prompt explains why they are being asked. */
    reason?: string | null;
    /**
     * Which tab to open on when there is no `reason` - e.g. the landing page's Login and
     * Sign up buttons, where nothing was blocked and the copy should not claim otherwise.
     */
    initialMode?: Mode;
    onClose: () => void;
    onSignedIn: (user: AuthUser) => void;
}

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

const FIELD = 'w-full bg-white border border-ink-300 rounded-md py-2.5 sm:py-2 pl-10 pr-3 text-sm '
    + 'text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500';

export const AuthModal = ({ isOpen, reason, initialMode, onClose, onSignedIn }: AuthModalProps) => {
    const [mode, setMode] = useState<Mode>('signup');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Set when signup is refused because the address already has an account. Held separately
    // from `error` so it can be shown as an offer to sign in rather than a dead end.
    const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
    const emailRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            // A blocked action always lands on sign-up; otherwise honour the caller's choice.
            setMode(reason ? 'signup' : (initialMode ?? 'login'));
            setEmail('');
            setPassword('');
            setDisplayName('');
            setError(null);
            setDuplicateEmail(null);
            setBusy(false);
        }
    }, [isOpen, reason, initialMode]);

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
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="md"
            closeOnBackdrop={false}
            initialFocusRef={emailRef}
            onSubmit={handleSubmit}
            title={mode === 'signup' ? 'Create your free account' : 'Welcome back'}
            subtitle={
                <span className="whitespace-normal block leading-relaxed">
                    {reason
                        ? `${reason} needs an account. Everything else — importing, editing and visualising — stays free and open.`
                        : 'Sign in to export files and create share links.'}
                </span>
            }
            footer={
                <div className="space-y-3">
                    <button
                        type="submit"
                        disabled={isBusy || (mode === 'signup' && unmetRules.length > 0)}
                        className="w-full px-4 py-2.5 brand-gradient brand-gradient-hover disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-md text-sm font-bold shadow-glow-sm transition-all flex items-center justify-center gap-2"
                    >
                        {isBusy && <Loader2 size={14} className="animate-spin" />}
                        {mode === 'signup' ? 'Create account' : 'Sign in'}
                    </button>
                    <p className="text-[11px] text-ink-400 text-center leading-relaxed">
                        This is a demo application. Please don&apos;t reuse a password from anywhere else.
                    </p>
                </div>
            }
        >
            {/* Mode switch */}
            <div className="flex border border-ink-200 rounded-lg p-1 bg-ink-50 mb-5" role="tablist">
                {(['signup', 'login'] as Mode[]).map(m => (
                    <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => { setMode(m); setError(null); setDuplicateEmail(null); }}
                        className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
                            mode === m
                                ? 'bg-white text-brand-700 shadow-glow-sm'
                                : 'text-ink-500 hover:text-ink-800'
                        }`}
                    >
                        {m === 'signup' ? 'Sign up' : 'Sign in'}
                    </button>
                ))}
            </div>

            <div className="space-y-4">
                {mode === 'signup' && (
                    <div>
                        <label htmlFor="auth-name" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                            Name <span className="font-normal normal-case text-ink-400">(optional)</span>
                        </label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" size={16} />
                            <input
                                id="auth-name"
                                className={FIELD}
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Ada Lovelace"
                            />
                        </div>
                    </div>
                )}

                <div>
                    <label htmlFor="auth-email" className="block text-xs font-bold text-ink-500 uppercase mb-2">Email</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" size={16} />
                        <input
                            id="auth-email"
                            ref={emailRef}
                            type="email"
                            autoComplete="email"
                            className={FIELD}
                            value={email}
                            onChange={e => { setEmail(e.target.value); setError(null); setDuplicateEmail(null); }}
                            placeholder="you@example.com"
                        />
                    </div>
                </div>

                <PasswordField
                    id="auth-password"
                    label="Password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={value => { setPassword(value); setError(null); }}
                    placeholder={mode === 'signup' ? 'Choose a strong password' : ''}
                />

                {mode === 'signup' && (
                    <ul className="space-y-1.5 -mt-1">
                        {PASSWORD_RULES.map(rule => {
                            const met = rule.test(password);
                            return (
                                <li key={rule.label} className="flex items-center gap-2 text-xs">
                                    <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                                        met ? 'bg-emerald-500' : 'bg-ink-200'
                                    }`}>
                                        {met && <Check size={9} className="text-white" strokeWidth={3.5} />}
                                    </span>
                                    <span className={met ? 'text-emerald-600' : 'text-ink-400'}>
                                        {rule.label}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {duplicateEmail && (
                    <Callout tone="warning" icon={<AlertCircle size={14} />}>
                        <p className="leading-relaxed">
                            An account with <strong className="font-mono">{duplicateEmail}</strong> already exists.
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
                    </Callout>
                )}

                {error && <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>}
            </div>
        </Modal>
    );
};
