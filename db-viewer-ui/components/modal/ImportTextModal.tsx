"use client";

import React, { useRef, useState } from 'react';
import { ClipboardPaste, Link2, Loader2 } from 'lucide-react';
import { Callout, GhostButton, Modal, ModalActions, PrimaryButton } from '@/components/ui/Modal';
import { dbService } from '@/services/api';
import { errorMessage } from '@/services/errors';
import { formatOf, prepareImport, type PreparedImport, type TextFormat } from '@/services/textImport';

/**
 * Import without a file on disk: paste SQL or DBML, or give the address of a published one.
 *
 * Every route ends in a `File` handed to `onPrepared`, which is the same pre-flight preview a
 * picked file gets — this dialog only gets the text there. A URL is fetched by the backend
 * (the page's Content-Security-Policy, rightly, will not let the browser call GitHub itself),
 * which only fetches from GitHub.
 */
type Source = 'paste' | 'url';

const FORMATS: { id: TextFormat; label: string }[] = [
    { id: 'sql', label: 'SQL' },
    { id: 'dbml', label: 'DBML' },
    { id: 'csv', label: 'CSV' },
];

const FIELD = 'w-full bg-surface border border-ink-300 rounded-md px-3 py-2 text-ink-900 '
    + 'placeholder:text-ink-400 focus:outline-none focus:border-brand-500 focus:ring-1 '
    + 'focus:ring-brand-500 transition-all text-sm';

export const ImportTextModal = ({ isOpen, onClose, onPrepared, defaultName }: {
    isOpen: boolean;
    onClose: () => void;
    onPrepared: (prepared: PreparedImport) => void;
    defaultName: string;
}) => {
    const [source, setSource] = useState<Source>('paste');
    const [text, setText] = useState('');
    const [format, setFormat] = useState<TextFormat | null>(null);
    const [name, setName] = useState(defaultName);
    const [url, setUrl] = useState('');
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const textRef = useRef<HTMLTextAreaElement>(null);
    const urlRef = useRef<HTMLInputElement>(null);

    // Until the user picks one, the format follows what the text looks like.
    const effectiveFormat = format ?? formatOf('', text);

    const canSubmit = !isBusy && (source === 'paste' ? text.trim().length > 0 : url.trim().length > 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setError(null);
        try {
            if (source === 'paste') {
                onPrepared(prepareImport(name, text, effectiveFormat));
                onClose();
                return;
            }
            setBusy(true);
            const fetched = await dbService.fetchImport(url.trim());
            // A gist's `/raw` has no extension; its content decides.
            const fileName = fetched.fileName === 'raw' ? 'gist' : fetched.fileName;
            onPrepared(prepareImport(fileName, fetched.content));
            onClose();
        } catch (err) {
            setError(errorMessage(err) || (err instanceof Error ? err.message : 'That could not be imported.'));
        } finally {
            setBusy(false);
        }
    };

    const tab = (id: Source, label: string, icon: React.ReactNode) => (
        <button
            type="button"
            role="tab"
            aria-selected={source === id}
            onClick={() => { setSource(id); setError(null); }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                source === id ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
            }`}
        >
            {icon}{label}
        </button>
    );

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Import from text or a link"
            subtitle="You will see what it creates before anything runs."
            icon={<ClipboardPaste size={18} className="text-brand-600 shrink-0" />}
            size="lg"
            closeOnBackdrop={false}
            initialFocusRef={source === 'paste' ? textRef : urlRef}
            onSubmit={handleSubmit}
            footer={
                <ModalActions>
                    <GhostButton onClick={onClose}>Cancel</GhostButton>
                    <PrimaryButton type="submit" disabled={!canSubmit}>
                        {isBusy && <Loader2 size={15} className="animate-spin" />}
                        {source === 'url' ? 'Fetch and preview' : 'Preview import'}
                    </PrimaryButton>
                </ModalActions>
            }
        >
            <div role="tablist" className="mb-4 inline-flex gap-1 rounded-lg bg-ink-100 p-1">
                {tab('paste', 'Paste', <ClipboardPaste size={13} />)}
                {tab('url', 'From a link', <Link2 size={13} />)}
            </div>

            {source === 'paste' ? (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                        <label className="flex-1 min-w-[12rem]">
                            <span className="block text-xs font-bold text-ink-500 uppercase mb-1.5">File name</span>
                            <input className={`${FIELD} font-mono`} value={name}
                                   onChange={e => setName(e.target.value)} />
                        </label>
                        <fieldset>
                            <legend className="block text-xs font-bold text-ink-500 uppercase mb-1.5">Format</legend>
                            <div className="inline-flex rounded-md border border-ink-300 overflow-hidden">
                                {FORMATS.map(f => (
                                    <button
                                        key={f.id}
                                        type="button"
                                        aria-pressed={effectiveFormat === f.id}
                                        onClick={() => setFormat(f.id)}
                                        className={`px-3 py-2 text-xs font-semibold transition-colors ${
                                            effectiveFormat === f.id ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-50'
                                        }`}
                                    >
                                        {f.label}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                    </div>
                    <label className="block">
                        <span className="sr-only">Schema text</span>
                        <textarea
                            ref={textRef}
                            value={text}
                            onChange={e => setText(e.target.value)}
                            spellCheck={false}
                            rows={12}
                            placeholder={'CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);\n\n'
                                + '— or DBML from dbdiagram.io —\n\nTable customers {\n  id int [pk]\n  name varchar\n}'}
                            className={`${FIELD} font-mono text-xs leading-relaxed resize-y min-h-[12rem]`}
                        />
                    </label>
                    <p className="text-xs text-ink-500">
                        DBML is converted to SQL first. A dump from MySQL, PostgreSQL or SQL Server
                        is translated the same way an imported file is.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    <label className="block">
                        <span className="block text-xs font-bold text-ink-500 uppercase mb-1.5">Address</span>
                        <input
                            ref={urlRef}
                            type="url"
                            inputMode="url"
                            className={`${FIELD} font-mono`}
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            placeholder="https://gist.github.com/you/0123abcd"
                        />
                    </label>
                    <p className="text-xs text-ink-500 leading-relaxed">
                        A public GitHub gist, or a <span className="font-mono">.sql</span>,{' '}
                        <span className="font-mono">.csv</span> or <span className="font-mono">.dbml</span> file
                        in a public GitHub repository — its page or its Raw link. Other sites are not
                        fetched, so the server cannot be pointed at anything else.
                    </p>
                </div>
            )}

            {error && (
                <div className="mt-4">
                    <Callout tone="error">{error}</Callout>
                </div>
            )}
        </Modal>
    );
};
