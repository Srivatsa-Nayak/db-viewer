"use client";

import { MutableRefObject, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { chatStore } from '@/services/chatStore';

interface AssistantPanelOptions {
    activeWorkspaceId: string | null;
    /** Read by the keyboard shortcut, which must not open a panel with no file behind it. */
    activeWorkspaceIdRef: MutableRefObject<string | null>;
    /** Who is signed in; part of the panel's config key. */
    userEmail: string | null;
    /** Below `lg` the two side panels are overlays and cannot both be open. */
    closeExplorer: () => void;
    openScratchpad: () => void;
}

/**
 * Everything the editor knows about the assistant panel: whether it is open, the Ctrl+I
 * shortcut, the conversation dot, and the hand-off of SQL into the scratchpad.
 *
 * The panel is a column of the editor's layout, so its open state lives with the page that owns
 * that layout — this hook is that state, moved out of `page.tsx` but still owned by it.
 */
export const useAssistantPanel = ({
    activeWorkspaceId, activeWorkspaceIdRef, userEmail, closeExplorer, openScratchpad,
}: AssistantPanelOptions) => {
    const [isChatOpen, setChatOpen] = useState(false);
    /**
     * Bumped whenever the profile dialog closes, which is where the API key is managed. Part of
     * the panel's `configKey`, so a key added there is picked up without a reload.
     */
    const [profileCloses, setProfileCloses] = useState(0);
    /**
     * SQL the assistant has written, waiting to be loaded into the scratchpad. The counter makes
     * a second send of identical text still reload it: the scratchpad remounts on a new `key`.
     */
    const [scratchpadSeed, setScratchpadSeed] = useState<{ sql: string; n: number } | null>(null);

    /** Whether the open file has an assistant conversation, for the launcher's dot. */
    const hasConversation = useSyncExternalStore(
        chatStore.subscribe, () => chatStore.has(activeWorkspaceId), () => false);

    /**
     * Opens or closes the assistant. Below `lg` both side panels are overlay drawers on the same
     * canvas, so opening one closes the other — two stacked drawers would leave the lower one
     * unreachable behind the upper one's scrim.
     */
    const toggleChat = useCallback(() => {
        setChatOpen(open => {
            const next = !open;
            if (next && !window.matchMedia('(min-width: 1024px)').matches) closeExplorer();
            return next;
        });
    }, [closeExplorer]);

    /**
     * Ctrl+I (Cmd+I). Stands down while a dialog is open, the same rule Ctrl+F and Ctrl+Z follow;
     * it works from inside the assistant's own composer, so the panel can be closed without
     * reaching for the mouse.
     */
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
            if (event.key.toLowerCase() !== 'i') return;
            if (document.body.dataset.dialogOpen === 'true') return;
            if (!activeWorkspaceIdRef.current) return;
            event.preventDefault();
            toggleChat();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [toggleChat, activeWorkspaceIdRef]);

    /**
     * Loads the assistant's SQL into the scratchpad and opens it. The assistant never runs
     * anything: the scratchpad is the reviewed, account-gated route for arbitrary SQL, and the
     * user still reads the statements and presses Run.
     */
    const sendToScratchpad = useCallback((sql: string) => {
        setScratchpadSeed({ sql, n: Date.now() });
        openScratchpad();
    }, [openScratchpad]);

    const noteProfileClosed = useCallback(() => setProfileCloses(n => n + 1), []);
    const closeChat = useCallback(() => setChatOpen(false), []);

    return {
        isChatOpen,
        closeChat,
        toggleChat,
        hasConversation,
        scratchpadSeed,
        sendToScratchpad,
        chatConfigKey: `${userEmail ?? 'anonymous'}:${profileCloses}`,
        noteProfileClosed,
    };
};
