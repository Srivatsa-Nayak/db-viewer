"use client";

import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { ApiKeyStatus, apiKeyService } from '@/services/api';
import { Callout } from '@/components/ui/Modal';
import { PasswordField } from '@/components/ui/PasswordField';

/**
 * The bring-your-own-API-key panel inside the profile dialog.
 *
 * <p>It lives in the profile rather than beside the chat because a key belongs to the account,
 * not to a file: one key covers every workspace the user opens, and the place they manage the
 * rest of their account is where they will look for it. The assistant's own header carries a
 * shortcut here so the walk is short.
 *
 * <p><b>The field is paste-to-replace, never edit-in-place.</b> The backend stores the key
 * encrypted and will not hand it back, so there is nothing to pre-fill — only the masked hint,
 * which is enough to recognise which key is stored without being able to reconstruct it. An
 * input that looked editable but started empty would read as "your key has been lost".
 *
 * <p>Every button here is `type="button"`. The whole dialog is one `<form>` whose submit saves
 * the display name and password, and an unmarked button inside it submits that form instead of
 * doing its own job.
 */

interface ApiKeySectionProps {
    /** Tells the parent the account no longer needs to be nagged about a key. Optional. */
    onChanged?: (status: ApiKeyStatus) => void;
}

export const ApiKeySection = ({ onChanged }: ApiKeySectionProps) => {
    const [status, setStatus] = useState<ApiKeyStatus | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [provider, setProvider] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');

    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<string | null>(null);

    // Loaded on mount, following the ShareModal pattern: the dialog is only mounted while it is
    // open, so mounting is the fetch and there is nothing to re-run or reset.
    useEffect(() => {
        let cancelled = false;
        apiKeyService.get()
            .then(result => { if (!cancelled) setStatus(result); })
            .catch(() => {
                if (!cancelled) setLoadError('Could not read your API key settings.');
            });
        return () => { cancelled = true; };
    }, []);

    const apply = (next: ApiKeyStatus, message: string) => {
        setStatus(next);
        setApiKey('');
        setModel('');
        setProvider('');
        setSaved(message);
        onChanged?.(next);
        setTimeout(() => setSaved(null), 3000);
    };

    const save = async () => {
        setError(null);
        if (!apiKey.trim()) {
            setError('Paste a key first.');
            return;
        }
        setBusy(true);
        try {
            const next = await apiKeyService.save(
                apiKey.trim(), provider || undefined, model.trim() || undefined);
            apply(next, 'Key saved. The assistant will use it from now on.');
        } catch (err: unknown) {
            const message = err && typeof err === 'object' && 'response' in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setError(message || 'Could not save that key.');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setError(null);
        setBusy(true);
        try {
            const next = await apiKeyService.clear();
            apply(next, next.defaultAvailable
                ? 'Key removed. The assistant is back on the app’s own key.'
                : 'Key removed.');
        } catch {
            setError('Could not remove the key.');
        } finally {
            setBusy(false);
        }
    };

    if (loadError) {
        return (
            <div className="pt-5 border-t border-ink-200">
                <Callout tone="error" icon={<AlertCircle size={14} />}>{loadError}</Callout>
            </div>
        );
    }

    if (!status) {
        return (
            <div className="pt-5 border-t border-ink-200 flex items-center gap-2 text-xs text-ink-400">
                <Loader2 size={13} className="animate-spin" />
                Loading your assistant settings…
            </div>
        );
    }

    // Blank means "work it out from the key". Once a provider is picked, its default model
    // becomes the placeholder, so the field says what leaving it empty will do.
    const chosen = status.providers.find(p => p.id === provider);

    return (
        <div className="pt-5 border-t border-ink-200 space-y-4">
            <div>
                <p className="text-xs font-bold text-ink-500 uppercase flex items-center gap-1.5">
                    <Sparkles size={12} className="text-brand-600" />
                    Assistant API key
                </p>
                <p className="text-[11px] text-ink-400 mt-1 leading-relaxed">
                    Optional. Bring an Anthropic, OpenAI or OpenRouter key and the schema
                    assistant uses it instead of ours — your usage, your billing, your choice of
                    model.
                </p>
            </div>

            {status.keyUnreadable && (
                <Callout tone="warning" icon={<AlertCircle size={14} />}>
                    <span className="block">
                        Your saved {status.providerLabel} key{' '}
                        <span className="font-mono">{status.hint}</span> can no longer be read —
                        the server&rsquo;s secret has changed. The assistant will not answer
                        until you paste it again below
                        {status.defaultAvailable ? ', or remove it to use the app’s own key' : ''}.
                    </span>
                    <button
                        type="button"
                        onClick={() => void remove()}
                        disabled={isBusy}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold
                                   text-tone-error-ink hover:underline disabled:opacity-50"
                    >
                        <Trash2 size={10} />
                        Remove the saved key
                    </button>
                </Callout>
            )}

            <div className="rounded-md border border-line bg-surface-tint px-3 py-2">
                {status.keyUnreadable ? (
                    <p className="text-xs text-ink-600">
                        No usable key on file.
                    </p>
                ) : status.usingOwnKey ? (
                    <div className="flex items-start gap-2">
                        <KeyRound size={13} className="text-brand-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-xs text-ink-800">
                                Using your <strong className="font-semibold">{status.providerLabel}</strong> key
                                {' '}<span className="font-mono text-ink-500">{status.hint}</span>
                            </p>
                            <p className="text-[11px] text-ink-400 font-mono truncate">{status.model}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => void remove()}
                            disabled={isBusy}
                            className="ml-auto shrink-0 flex items-center gap-1 text-[11px] font-semibold
                                       text-tone-error-ink hover:underline disabled:opacity-50"
                        >
                            <Trash2 size={10} />
                            Remove
                        </button>
                    </div>
                ) : (
                    <p className="text-xs text-ink-600">
                        {status.defaultAvailable
                            ? <>Using the app&rsquo;s own key
                                {' '}(<span className="font-mono text-ink-500">{status.defaultModel}</span>).
                                Add yours below to use a different model.</>
                            : <>This server has no key of its own, so the assistant cannot answer
                                until you add one below.</>}
                    </p>
                )}
            </div>

            {!status.keysSurviveRestart && (
                <Callout tone="warning" icon={<AlertCircle size={14} />}>
                    This server has no <span className="font-mono">AUTH_SECRET</span> set, so a
                    stored key is forgotten when it restarts and will need entering again.
                </Callout>
            )}

            <div>
                <label htmlFor="api-key-provider"
                       className="block text-xs font-bold text-ink-500 uppercase mb-2">
                    Provider
                </label>
                <select
                    id="api-key-provider"
                    value={provider}
                    onChange={e => { setProvider(e.target.value); setError(null); }}
                    className="w-full bg-surface border border-ink-300 rounded-md py-2.5 sm:py-2 px-3
                               text-sm text-ink-900 focus:outline-none focus:border-brand-500
                               focus:ring-1 focus:ring-brand-500"
                >
                    <option value="">Detect from the key</option>
                    {status.providers.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>
            </div>

            <PasswordField
                id="api-key-value"
                label={status.usingOwnKey ? 'Replace your key' : 'API key'}
                autoComplete="off"
                placeholder="sk-ant-…"
                value={apiKey}
                onChange={value => { setApiKey(value); setError(null); }}
                hint="Stored encrypted, and never shown again. It is not checked here — saving
                      costs nothing, so a key that does not work says so the first time you ask
                      the assistant something."
            />

            <div>
                <label htmlFor="api-key-model"
                       className="block text-xs font-bold text-ink-500 uppercase mb-2">
                    Model <span className="normal-case font-normal text-ink-400">(optional)</span>
                </label>
                <input
                    id="api-key-model"
                    value={model}
                    onChange={e => { setModel(e.target.value); setError(null); }}
                    placeholder={chosen ? chosen.defaultModel : 'Uses the provider default'}
                    className="w-full bg-surface border border-ink-300 rounded-md py-2.5 sm:py-2 px-3
                               font-mono text-sm text-ink-900 placeholder:text-ink-400
                               placeholder:font-sans focus:outline-none focus:border-brand-500
                               focus:ring-1 focus:ring-brand-500"
                />
            </div>

            <button
                type="button"
                onClick={() => void save()}
                disabled={isBusy || apiKey.trim() === ''}
                className="w-full sm:w-auto px-3 py-2 rounded-md brand-gradient brand-gradient-hover
                           text-sm font-semibold text-white flex items-center justify-center gap-2
                           disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
                {isBusy && <Loader2 size={14} className="animate-spin" />}
                {status.usingOwnKey ? 'Replace key' : 'Save key'}
            </button>

            {saved && (
                <Callout tone="info" icon={<CheckCircle2 size={14} />}>{saved}</Callout>
            )}
            {error && <Callout tone="error" icon={<AlertCircle size={14} />}>{error}</Callout>}
        </div>
    );
};
