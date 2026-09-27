"use client";

import React, { useState } from 'react';
import { Boxes, MoreVertical, Trash2 } from 'lucide-react';
import { CanvasGroup, TagColour } from '@/types';
import { AnchoredMenu, MenuAnchor, MenuItem, MenuSeparator, MenuLabel } from '@/components/ui/AnchoredMenu';
import { ColorSwatchPicker } from '@/components/ui/ColorSwatchPicker';

/**
 * A named boundary drawn around a set of tables — "Authentication", "Billing".
 *
 * The box carries no geometry of its own. Its position and size are the bounding rectangle of
 * whatever tables are currently in it, recomputed every render by the page; a group knows only
 * *which* tables belong to it. That is the whole design, and the reason is that node positions
 * live in the browser while group membership lives on the server: a stored rectangle would be
 * wrong the first time somebody opened the file on another machine, with the box hanging over
 * empty canvas while the tables sat on a default grid.
 *
 * Drawn behind everything (`zIndex: -1`) and not selectable, so it never gets in the way of the
 * tables it surrounds. It is still draggable — see the page, which translates the members rather
 * than the box.
 */

export interface GroupBoxData {
    group: CanvasGroup;
    /** How many of its tables actually exist right now. */
    memberCount: number;
    /**
     * Drops the menu, for the shared read-only view.
     *
     * The box still draws and still says what it is — a shared diagram that lost its boundaries
     * would be a worse copy of what the sender was looking at — but nothing on it can be changed
     * by somebody holding a link.
     */
    readOnly?: boolean;
    onRename?: (id: string, name: string) => void;
    onColour?: (id: string, colour: TagColour | undefined) => void;
    onUngroup?: (id: string) => void;
}

const GroupBox = ({ data }: { data: GroupBoxData }) => {
    const { group } = data;
    const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
    const [draftName, setDraftName] = useState(group.name);

    const tint = group.colour ? `var(--color-tag-${group.colour})` : 'var(--color-ink-400)';

    /**
     * Saves the name, and deliberately does **not** close the menu.
     *
     * It is wired to `onBlur`, and closing here made every other item in the menu unreachable:
     * the field is focused when the menu opens, so clicking Ungroup or a colour blurred the input
     * first, which dismissed the menu before the click could land. Enter closes it; a click
     * elsewhere in the menu now just commits and carries on.
     */
    const commitRename = () => {
        const trimmed = draftName.trim();
        if (trimmed && trimmed !== group.name) data.onRename?.(group.id, trimmed);
    };

    return (
        <div
            // `pointer-events-none` on the body, `auto` on the label: the box covers a large
            // area, and anything solid there would steal every pan, lasso and node click that
            // happened to start inside it. Only the label is interactive.
            className="group/box pointer-events-none h-full w-full rounded-xl border-2 border-dashed"
            // Inline because the colour is chosen at runtime; the *values* are still tokens.
            // A very light wash rather than a solid fill: the tables inside have to stay readable,
            // and at 25% zoom a saturated box turns the whole cluster into a smear.
            style={{ borderColor: tint, backgroundColor: `color-mix(in srgb, ${tint} 7%, transparent)` }}
        >
            {/* Inside the box's own rect, in the header strip `GROUP_HEADER` reserves for it.
                Hanging it outside on the border looked better and was not hit-testable: a child
                positioned beyond the node's bounds is painted, but `elementFromPoint` there
                returns whatever is behind, so the menu button could never be clicked. */}
            <div className="pointer-events-none absolute left-2 top-1 flex items-center gap-1.5">
                {/* The label doubles as the drag handle: the body cannot be one, having no
                    pointer events, and dragging a domain by its name reads naturally enough. */}
                <span
                    title="Drag to move this group"
                    className="pointer-events-auto flex cursor-grab items-center gap-1.5 rounded-full border
                               px-2.5 py-0.5 text-[11px] font-semibold shadow-glow-sm active:cursor-grabbing"
                    style={{ borderColor: tint, backgroundColor: 'var(--color-surface)', color: tint }}
                >
                    <Boxes size={11} />
                    {group.name}
                    <span className="font-normal text-ink-400">{data.memberCount}</span>
                </span>

                {!data.readOnly && (
                <button
                    type="button"
                    onClick={e => {
                        e.stopPropagation();
                        const el = e.currentTarget;
                        setDraftName(group.name);
                        setMenuAnchor(open => (open ? null : { el, rect: el.getBoundingClientRect() }));
                    }}
                    // Revealed on hover: a box is decoration most of the time, and a permanent
                    // control on every group is a lot of furniture on a busy canvas.
                    // `nodrag` so pressing the button opens the menu instead of starting a drag
                    // of the group — the label beside it is the drag handle.
                    // Dimmed rather than hidden until hover: a box is a thing the user made
                    // deliberately, and a control that only exists once you find it is worse than
                    // a quiet one that is always there.
                    className="nodrag pointer-events-auto rounded-full border bg-surface p-1 text-ink-500
                               opacity-50 shadow-glow-sm transition-opacity hover:text-ink-800
                               hover:opacity-100 group-hover/box:opacity-100 focus-visible:opacity-100"
                    style={{ borderColor: tint }}
                    aria-label={`Actions for the ${group.name} group`}
                    aria-haspopup="menu"
                >
                    <MoreVertical size={11} />
                </button>
                )}
            </div>

            <AnchoredMenu
                anchor={menuAnchor}
                onClose={() => setMenuAnchor(null)}
                label={`Actions for the ${group.name} group`}
            >
                <MenuLabel>Name</MenuLabel>
                <div className="px-3 pb-2">
                    {/* Renaming happens in the portalled menu rather than in the label itself:
                        an input inside the node would be scaled by the canvas zoom, and at 40%
                        it is unusable. */}
                    <input
                        autoFocus
                        value={draftName}
                        onChange={e => setDraftName(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitRename();
                                setMenuAnchor(null);
                            }
                        }}
                        onBlur={commitRename}
                        aria-label="Group name"
                        className="w-full rounded border border-ink-300 bg-surface px-2 py-1 text-xs
                                   text-ink-900 outline-none focus:border-brand-500"
                    />
                </div>

                <MenuSeparator />

                <MenuLabel>Colour</MenuLabel>
                <div className="px-3 pb-2">
                    <ColorSwatchPicker
                        value={group.colour}
                        label=""
                        onChange={colour => { data.onColour?.(group.id, colour); setMenuAnchor(null); }}
                    />
                </div>

                <MenuSeparator />

                <MenuItem
                    icon={<Trash2 size={14} />}
                    tone="danger"
                    onClick={() => { setMenuAnchor(null); data.onUngroup?.(group.id); }}
                    description="Removes the box. The tables stay."
                >
                    Ungroup
                </MenuItem>
            </AnchoredMenu>
        </div>
    );
};

/** Named for the lint rule that rejects a component defined inside another. */
GroupBox.displayName = 'GroupBox';

export default React.memo(GroupBox);
