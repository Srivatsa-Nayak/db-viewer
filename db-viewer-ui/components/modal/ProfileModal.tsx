"use client";

import React, { useRef, useState } from 'react';
import { Loader2, AlertCircle, User, Check, CheckCircle2 } from 'lucide-react';
import { authService, AuthUser } from '@/services/api';
import { Callout, GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';
import { PasswordField } from '@/components/ui/PasswordField';

interface ProfileModalProps {
    isOpen: boolean;
    user: AuthUser;
    onClose: () => void;
    onUpdated: (user: AuthUser) => void;
}

/** Mirrors the server-side policy in AuthService.validatePassword. */
const PASSWORD_RULES: { label: string; test: (value: string) => boolean }[] = [
    { label: 'At least 8 characters', test: v => v.length >= 8 },
    { label: 'A capital letter', test: v => /[A-Z]/.test(v) },
    { label: 'A special character', test: v => /[^A-Za-z0-9]/.test(v) },
];

export const ProfileModal = ({ isOpen, user, onClose, onUpdated }: ProfileModalProps) => {
    const [displayName, setDisplayName] = useState(user.displayName);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const nameRef = useRef<HTMLInputElement>(null);

    const nameChanged = displayName.trim() !== user.displayName && displayName.trim() !== '';
    // The password section is optional and stays dormant until something is typed into it.
    const changingPassword = newPassword !== '' || currentPassword !== '' || confirmPassword !== '';
    const unmetRules = PASSWORD_RULES.filter(rule => !rule.test(newPassword));
    const mismatch = changingPassword && confirmPassword !== '' && newPassword !== confirmPassword;
    const hasChanges = nameChanged || changingPassword;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (changingPassword) {
            if (!currentPassword) return setError('Enter your current password to change it.');
            if (!newPassword) return setError('Enter a new password, or clear the fields to leave it unchanged.');
            if (unmetRules.length > 0) return setError('The new password does not meet all the requirements.');
            if (newPassword !== confirmPassword) return setError('The two new passwords do not match.');
        }
        if (!hasChanges) return onClose();

        setBusy(true);
        try {
            const updated = await authService.updateProfile({
                displayName: nameChanged ? displayName.trim() : undefined,
                currentPassword: changingPassword ? currentPassword : undefined,
                newPassword: changingPassword ? newPassword : undefined,
            });
            onUpdated(updated);
            // Cleared rather than kept: leaving a password sitting in a mounted form is the
            // kind of thing that ends up in a screenshot.
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (err: unknown) {
            const message = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || 'Could not save your changes.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="md"
            title="Your profile"
            subtitle={<span className="font-mono">{user.email}</span>}
            icon={<User size={18} className="text-brand-600 shrink-0" />}
            closeOnBackdrop={false}
            initialFocusRef={nameRef}
            onSubmit={handleSubmit}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose}>Close</GhostButton>
                    <PrimaryButton type="submit" disabled={isBusy || !hasChanges}>
                        {isBusy && <Loader2 size={14} className="animate-spin" />}
                        Save changes
                    </PrimaryButton>
                </ModalActions>
            }
        >
            <div className="space-y-5">
                <div>
                    <label htmlFor="profile-name" className="block text-xs font-bold text-ink-500 uppercase mb-2">
                        Display name
                    </label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" size={16} />
                        <input
                            id="profile-name"
                            ref={nameRef}
                            maxLength={120}
                            className="w-full bg-surface border border-ink-300 rounded-md py-2.5 sm:py-2 pl-10 pr-3 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                            value={displayName}
                            onChange={e => { setDisplayName(e.target.value); setError(null); }}
                            placeholder="Ada Lovelace"
                        />
                    </div>
                    <p className="text-[11px] text-ink-400 mt-1.5">
                        Your email address is what identifies your account, and cannot be changed here.
                    </p>
                </div>

                <div className="pt-5 border-t border-ink-200 space-y-4">
                    <div>
                        <p className="text-xs font-bold text-ink-500 uppercase">Change password</p>
                        <p className="text-[11px] text-ink-400 mt-1 leading-relaxed">
                            Optional — leave these blank to keep your current password.
                        </p>
                    </div>

                    <PasswordField
                        id="profile-current-password"
                        label="Current password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={value => { setCurrentPassword(value); setError(null); }}
                    />

                    <PasswordField
                        id="profile-new-password"
                        label="New password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={value => { setNewPassword(value); setError(null); }}
                    />

                    {newPassword !== '' && (
                        <ul className="space-y-1.5">
                            {PASSWORD_RULES.map(rule => {
                                const met = rule.test(newPassword);
                                return (
                                    <li key={rule.label} className="flex items-center gap-2 text-xs">
                                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${
                                            met ? 'bg-emerald-500' : 'bg-ink-200'
                                        }`}>
                                            {met && <Check size={9} className="text-white" strokeWidth={3.5} />}
                                        </span>
                                        <span className={met ? 'text-emerald-600' : 'text-ink-400'}>{rule.label}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    <PasswordField
                        id="profile-confirm-password"
                        label="Confirm new password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={value => { setConfirmPassword(value); setError(null); }}
                        hint={mismatch
                            ? <span className="text-tone-error-ink">The two passwords do not match.</span>
                            : undefined}
                    />
                </div>

                {saved && (
                    <Callout tone="info" icon={<CheckCircle2 size={14} />}>Your profile has been updated.</Callout>
                )}

                {error && <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>}
            </div>
        </Modal>
    );
};
