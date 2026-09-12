"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
    ArrowRight, StickyNote, Pencil, Plus, Download, Trash2, Edit3,
    Files, Share2, HelpCircle, LayoutPanelLeft, Search, ZoomIn, Database,
    FileCode, Image as ImageIcon, KeyRound,
} from "lucide-react";

import { LandingNav } from "@/components/landing/LandingNav";
import { AuthModal } from "@/components/modal/AuthModal";
import {
    DocsSidebar, DocsGroup, Section, Steps, Step, ActionTable, Callout, UI, Code, Key,
} from "@/components/docs/DocsChrome";
import { authService, AuthUser } from "@/services/api";

/**
 * The documentation page.
 *
 * One page rather than a tree of them: everything here describes a single screen, and a
 * reader looking for "what does this button do" is better served by one searchable page
 * with a contents rail than by twenty routes they have to guess between.
 *
 * Everything documented here is behaviour the editor actually has. Where something is a
 * naming convention or a known limitation rather than a real feature, it says so — docs
 * that overstate what a tool does cost more trust than they buy.
 */

const GROUPS: DocsGroup[] = [
    {
        title: "Getting started",
        items: [
            { id: "overview", label: "What this is" },
            { id: "quick-start", label: "Your first diagram" },
        ],
    },
    {
        title: "The editor",
        items: [
            { id: "tour", label: "A tour of the screen" },
            { id: "explorer", label: "The Explorer" },
            { id: "canvas", label: "The canvas" },
        ],
    },
    {
        title: "Files",
        items: [
            { id: "files", label: "Files are databases" },
            { id: "importing", label: "Importing a file" },
            { id: "closing", label: "Deleting a file" },
        ],
    },
    {
        title: "Schema",
        items: [
            { id: "create-table", label: "Creating a table" },
            { id: "table-actions", label: "Table actions" },
            { id: "columns", label: "Adding a column" },
            { id: "edit-column", label: "Editing a column" },
            { id: "types", label: "Column types" },
            { id: "relationships", label: "Relationships" },
            { id: "delete-table", label: "Deleting a table" },
        ],
    },
    {
        title: "Data",
        items: [{ id: "data-editor", label: "Viewing and editing rows" }],
    },
    {
        title: "Getting work out",
        items: [
            { id: "notes", label: "Notes and to-dos" },
            { id: "export", label: "Exporting" },
            { id: "sharing", label: "Sharing a link" },
            { id: "accounts", label: "Accounts" },
        ],
    },
    {
        title: "Reference",
        items: [
            { id: "shortcuts", label: "Keys" },
            { id: "faq", label: "Common questions" },
        ],
    },
];

export default function DocsPage() {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isAuthOpen, setAuthOpen] = useState(false);
    const [authMode, setAuthMode] = useState<"login" | "signup">("signup");

    useEffect(() => {
        let cancelled = false;
        authService.me().then(u => { if (!cancelled) setUser(u); });
        return () => { cancelled = true; };
    }, []);

    const openAuth = (mode: "login" | "signup") => {
        setAuthMode(mode);
        setAuthOpen(true);
    };

    return (
        <div className="min-h-screen bg-white text-zinc-800">
            <LandingNav
                user={user}
                onLogin={() => openAuth("login")}
                onSignup={() => openAuth("signup")}
                onSignOut={() => { authService.logout(); setUser(null); }}
            />

            {/* ── Header ───────────────────────────────────────────────────────── */}
            <header className="section-wash relative overflow-hidden border-b border-[var(--surface-line)] pt-36 pb-14 sm:pt-44">
                <div
                    aria-hidden
                    className="pointer-events-none absolute -left-24 -top-20 h-[26rem] w-[26rem] rounded-full bg-blue-400/15 blur-3xl"
                />
                <div className="relative mx-auto max-w-6xl px-6">
                    <span className="mb-4 inline-block rounded-full border border-blue-200/70 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700 shadow-sm">
                        Documentation
                    </span>
                    <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
                        The editor, <span className="brand-text-gradient">button by button</span>
                    </h1>
                    <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-600">
                        What every control does, what it changes in your database, and where the
                        edges are. If you only read one section, make it{" "}
                        <a href="#quick-start" className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-4 hover:decoration-blue-600">
                            Your first diagram
                        </a>.
                    </p>
                </div>
            </header>

            {/* ── Body: rail + prose ───────────────────────────────────────────── */}
            <div className="mx-auto max-w-6xl gap-12 px-6 py-14 lg:flex">

                {/* The rail sticks below the nav on wide screens; above the prose on narrow
                    ones, where a sticky column would eat most of the viewport. */}
                <aside className="mb-12 shrink-0 lg:mb-0 lg:w-60">
                    <div className="lg:sticky lg:top-32 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto lg:pr-2">
                        <DocsSidebar groups={GROUPS} />
                    </div>
                </aside>

                <main className="min-w-0 flex-1 space-y-12">

                    {/* ═══ Getting started ═══ */}

                    <Section
                        id="overview"
                        title="What this is"
                        lead="A schema editor where the diagram is read back out of a real database, not drawn by hand."
                    >
                        <p>
                            Open a <Code>.csv</Code> or <Code>.sql</Code> file and it becomes an
                            actual database on the server. The tables you see on the canvas are
                            queried from that database&apos;s live metadata, and every edit you make —
                            adding a column, renaming one, changing a cell — runs as real SQL
                            against it.
                        </p>
                        <p>
                            That has a practical consequence worth knowing up front: the diagram
                            cannot drift from the schema, because it <em>is</em> the schema. If a
                            relationship line is missing, the foreign key is missing too.
                        </p>
                        <Callout title="You do not need an account to try it">
                            Importing, editing and visualising are all free and signed out. An
                            account is only required to <a href="#export" className="underline underline-offset-2">export a file</a> or{" "}
                            <a href="#sharing" className="underline underline-offset-2">create a share link</a>.
                        </Callout>
                    </Section>

                    <Section
                        id="quick-start"
                        title="Your first diagram"
                        lead="About a minute, with a file you already have."
                    >
                        <Steps>
                            <Step n={1}>
                                Open the editor and click <UI>File</UI> in the blue header, then{" "}
                                <UI>Import</UI>. Pick a <Code>.csv</Code> or <Code>.sql</Code> file.
                            </Step>
                            <Step n={2}>
                                The file opens in its own tab in the <UI>Explorer</UI> on the left,
                                and its tables appear on the canvas. Foreign keys are drawn as lines
                                between them.
                            </Step>
                            <Step n={3}>
                                Drag the tables into an arrangement that makes sense. Your layout is
                                saved in the browser and is still there next time you open the file.
                            </Step>
                            <Step n={4}>
                                Click the <UI>Edit Data</UI> icon on a table header to see and change
                                its rows, or the <UI>+</UI> to add a column.
                            </Step>
                            <Step n={5}>
                                When you want it elsewhere, use <UI>File → Export SQL script</UI> for
                                a runnable file, or <UI>Export diagram (PNG)</UI> for a picture.
                            </Step>
                        </Steps>
                        <p>
                            No file to hand?{" "}
                            <Link href="/#templates" className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-4 hover:decoration-blue-600">
                                Start from a template
                            </Link>{" "}
                            — each one arrives with a schema and sample data already in it.
                        </p>
                    </Section>

                    {/* ═══ The editor ═══ */}

                    <Section
                        id="tour"
                        title="A tour of the screen"
                        lead="Three regions: the header along the top, the Explorer down the left, and the canvas filling the rest."
                    >
                        <ActionTable
                            caption="Blue header"
                            rows={[
                                {
                                    icon: <Files size={15} />,
                                    action: "File",
                                    effect: <>Everything that opens or produces a file: new, import, export, and delete. See <a href="#importing" className="text-blue-700 underline underline-offset-2">Importing</a>.</>,
                                },
                                {
                                    icon: <Share2 size={15} />,
                                    action: "Share",
                                    effect: <>Creates a read-only link to the current file. Greyed out until a file is open; needs an account.</>,
                                },
                                {
                                    icon: <Database size={15} />,
                                    action: "File name chip",
                                    effect: <>Shows which file the canvas is currently displaying. Handy when several are open.</>,
                                },
                                {
                                    action: "Account button",
                                    effect: <>Your name and email, and <UI>Sign out</UI>. Reads <UI>Sign in</UI> when signed out.</>,
                                },
                                {
                                    icon: <HelpCircle size={15} />,
                                    action: "Help",
                                    effect: <>A short summary of the app, the version it is running, and who built it.</>,
                                },
                            ]}
                        />
                    </Section>

                    <Section
                        id="explorer"
                        title="The Explorer"
                        lead="The left sidebar: every file you have open, and what is inside each one."
                    >
                        <ActionTable
                            rows={[
                                {
                                    icon: <Plus size={15} />,
                                    action: "New file",
                                    effect: <>Asks for a name and creates an empty database. See <a href="#files" className="text-blue-700 underline underline-offset-2">Files are databases</a>.</>,
                                },
                                {
                                    icon: <Search size={15} />,
                                    action: "Search files",
                                    effect: <>Filters the list by file name. It does not search table or column names.</>,
                                },
                                {
                                    icon: <LayoutPanelLeft size={15} />,
                                    action: "Collapse",
                                    effect: <>Shrinks the sidebar to a narrow icon rail. Your open files stay listed as icons, so you can still switch between them.</>,
                                },
                                {
                                    action: "Click a file",
                                    effect: <>Switches the canvas to that file. Nothing is lost — each file keeps its own tables and layout.</>,
                                },
                                {
                                    action: "Expand a file",
                                    effect: <>Lists its tables, with a count of columns beside each. Expand a table to see its columns and types.</>,
                                },
                            ]}
                        />
                        <p>
                            In the expanded column list, primary keys are shown in blue. That marking
                            comes from the real schema, unlike the key icons on the canvas — see{" "}
                            <a href="#relationships" className="text-blue-700 underline underline-offset-2">Relationships</a> for why those differ.
                        </p>
                    </Section>

                    <Section
                        id="canvas"
                        title="The canvas"
                        lead="Where the diagram lives. Pan by dragging the background, zoom with the wheel."
                    >
                        <ActionTable
                            rows={[
                                {
                                    icon: <Plus size={15} />,
                                    action: "New Table",
                                    effect: <>Opens the table builder. See <a href="#create-table" className="text-blue-700 underline underline-offset-2">Creating a table</a>.</>,
                                },
                                {
                                    icon: <HelpCircle size={15} />,
                                    action: "Info (beside New Table)",
                                    effect: <>Explains what the New Table button does. This is deliberately not the same as the header&apos;s help button — one is about the control, the other about the app.</>,
                                },
                                {
                                    icon: <ZoomIn size={15} />,
                                    action: "Zoom",
                                    effect: <>Jumps to 50%, 100%, 150% or 200%. The wheel still zooms freely; this is for getting back to a known level.</>,
                                },
                                {
                                    action: "Bottom-left controls",
                                    effect: <>Zoom in and out, fit the whole diagram to the screen, and lock the canvas against accidental dragging.</>,
                                },
                                {
                                    action: "Drag a table",
                                    effect: <>Moves it. Positions are saved per file in your browser and restored when you come back.</>,
                                },
                            ]}
                        />
                        <Callout tone="warn" title="Dragging between the blue dots does not create a relationship">
                            The dots on table edges are anchor points for drawing existing foreign
                            keys. Dragging a new line between two of them will not write anything to
                            the database — define the foreign key when you{" "}
                            <a href="#create-table" className="underline underline-offset-2">create the table</a> instead.
                        </Callout>
                    </Section>

                    {/* ═══ Files ═══ */}

                    <Section
                        id="files"
                        title="Files are databases"
                        lead="Each open file is a completely separate database on the server."
                    >
                        <p>
                            This is the idea the rest of the app is built on. Two files can both have
                            a <Code>users</Code> table, with different columns, and neither knows the
                            other exists. Nothing is shared between them — not table names, not data,
                            not relationships.
                        </p>
                        <p>
                            Which file is &quot;current&quot; is whatever is selected in the Explorer.
                            Every action in the editor — creating a table, editing a row, exporting —
                            applies to that file and only that file.
                        </p>
                        <Callout title="What persists when you come back">
                            Your browser remembers which files were open, their names, and where you
                            dragged each table. It does <strong>not</strong> store the schema itself —
                            that is always re-read from the server, so what you see cannot be out of date.
                        </Callout>
                    </Section>

                    <Section
                        id="importing"
                        title="Importing a file"
                        lead="File → Import, then pick a .csv or .sql. It opens as a new file, alongside anything already open."
                    >
                        <p>
                            <strong>CSV.</strong> The first row is treated as column names, and the
                            column types are inferred from the values underneath.
                        </p>
                        <p>
                            <strong>SQL.</strong> The script is executed statement by statement, so
                            primary keys, foreign keys and indexes survive the trip. phpMyAdmin and
                            mysqldump exports work — comments, <Code>DELIMITER</Code> blocks and
                            MySQL-specific syntax are handled.
                        </p>
                        <p>
                            When an import finishes you get a report: how many statements ran, how many
                            were skipped, and why. It is worth a glance — a partial import is reported
                            honestly rather than passed off as a success.
                        </p>
                        <Callout tone="warn" title="If nothing appears">
                            A notice titled <em>Nothing could be imported</em> means every statement
                            failed, and it lists the reasons. The usual cause is a dialect feature with
                            no equivalent in the target database. Expand the details in the notice to
                            see exactly which statements were rejected.
                        </Callout>
                    </Section>

                    <Section
                        id="closing"
                        title="Deleting a file"
                        lead="File → Delete file."
                    >
                        <p>
                            This removes the file and the database behind it, with every table and row
                            in it. There is a confirmation step, but no undo afterwards.
                        </p>
                        <Callout tone="warn" title="There is no way to close a file without deleting it">
                            Deleting is the only way to remove a file from the editor — there is no
                            &ldquo;close but keep it&rdquo; action. If you want the work back later,{" "}
                            <a href="#export" className="underline underline-offset-2">export it</a> first;
                            the exported script re-imports as a new file. Any share link pointing at
                            this file also stops working.
                        </Callout>
                    </Section>

                    {/* ═══ Schema ═══ */}

                    <Section
                        id="create-table"
                        title="Creating a table"
                        lead="The New Table button on the canvas. This runs a real CREATE TABLE, so the definition you give is the definition you get."
                    >
                        <Steps>
                            <Step n={1}>
                                Give the table a name — <Code>user_profiles</Code>, say.
                            </Step>
                            <Step n={2}>
                                Define the columns. A first column called <Code>id</Code> (an{" "}
                                <Code>INT</Code> primary key, not null) is filled in for you; change
                                or remove it freely.
                            </Step>
                            <Step n={3}>
                                For each column set a <strong>type</strong>, a <strong>length</strong>{" "}
                                if it is a <Code>VARCHAR</Code>, and tick <UI>PK</UI> or{" "}
                                <UI>Not null</UI> as needed.
                            </Step>
                            <Step n={4}>
                                To make a column a foreign key, pick an existing table under{" "}
                                <UI>FK Table</UI> and name the column it points at under{" "}
                                <UI>Ref Col</UI> (usually <Code>id</Code>).
                            </Step>
                            <Step n={5}>
                                Create. The table appears on the canvas, with a line to any table you
                                referenced.
                            </Step>
                        </Steps>
                        <p>
                            The form refuses a table with no name, a column with no name, and two
                            columns sharing a name, before anything is sent to the database.
                        </p>
                    </Section>

                    <Section
                        id="table-actions"
                        title="Table actions"
                        lead="The icons in a table's blue header, left to right."
                    >
                        <ActionTable
                            rows={[
                                {
                                    icon: <StickyNote size={15} />,
                                    action: "Notes",
                                    effect: <>Opens the table&apos;s to-do list. An amber badge shows how many items are still open. See <a href="#notes" className="text-blue-700 underline underline-offset-2">Notes</a>.</>,
                                },
                                {
                                    icon: <Edit3 size={15} />,
                                    action: "Edit Data",
                                    effect: <>Opens the row editor for this table. See <a href="#data-editor" className="text-blue-700 underline underline-offset-2">Viewing and editing rows</a>.</>,
                                },
                                {
                                    icon: <Plus size={15} />,
                                    action: "Add Column",
                                    effect: <>Adds one column via <Code>ALTER TABLE</Code>. See <a href="#columns" className="text-blue-700 underline underline-offset-2">Adding a column</a>.</>,
                                },
                                {
                                    icon: <Download size={15} />,
                                    action: "Download CSV",
                                    effect: <>Downloads this table&apos;s rows as a CSV. Needs an account.</>,
                                },
                                {
                                    icon: <Trash2 size={15} />,
                                    action: "Delete table",
                                    effect: <>Drops the table, after a confirmation. See <a href="#delete-table" className="text-blue-700 underline underline-offset-2">Deleting a table</a>.</>,
                                },
                                {
                                    icon: <Pencil size={15} />,
                                    action: "Pencil on a column",
                                    effect: <>Appears when you hover a column row. Renames or retypes that column — see <a href="#edit-column" className="text-blue-700 underline underline-offset-2">Editing a column</a>.</>,
                                },
                            ]}
                        />
                    </Section>

                    <Section
                        id="columns"
                        title="Adding a column"
                        lead="The + on a table header."
                    >
                        <p>
                            Give the column a name and a type. For <Code>VARCHAR</Code> you also pick
                            a length — 64, 128 or 256. Saving runs a single{" "}
                            <Code>ALTER TABLE … ADD COLUMN</Code> and the canvas updates immediately.
                        </p>
                        <p>
                            Column names must start with a letter or an underscore and contain only
                            letters, digits and underscores. A name already used in that table is
                            rejected with the clash named.
                        </p>
                        <Callout title="Why a modal and not an inline field">
                            Table cards are around 200px wide and shrink with the canvas zoom, which
                            made an inline form unusable below 100%. The modal stays the same size
                            whatever the zoom.
                        </Callout>
                    </Section>

                    <Section
                        id="edit-column"
                        title="Editing a column"
                        lead="Hover a column row and click the pencil that appears beside its type."
                    >
                        <p>
                            You can change the name, the type, the <Code>VARCHAR</Code> length, and
                            whether the column is required. The current values are filled in from the
                            real schema, so what you see is what the database holds.
                        </p>
                        <p>
                            Only the fields you actually changed are sent. Opening the dialog and
                            saving without editing anything does nothing at all — which matters more
                            than it sounds, because changing a column&apos;s type can require rebuilding
                            the table underneath.
                        </p>
                        <Callout tone="warn" title="Changing a type can change your data">
                            The database converts existing values to the new type. Narrowing a
                            column — a long <Code>VARCHAR</Code> down to a short one, or text to a
                            number — can truncate or reject values. Check the rows first if the table
                            is not empty.
                        </Callout>
                    </Section>

                    <Section
                        id="types"
                        title="Column types"
                        lead="The types offered in the column dialogs."
                    >
                        <div className="surface-card overflow-hidden rounded-xl border">
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-left text-[13.5px]">
                                    <thead>
                                        <tr className="border-b border-zinc-200/80 text-[11px] uppercase tracking-wide text-zinc-400">
                                            <th scope="col" className="px-4 py-2 font-semibold">Type</th>
                                            <th scope="col" className="px-4 py-2 font-semibold">Use it for</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[
                                            ["VARCHAR", "Short text — names, emails, slugs. Pick a length of 64, 128 or 256."],
                                            ["TEXT", "Long or unbounded text. Available when editing an existing column."],
                                            ["INT", "Whole numbers, including identifiers and foreign keys."],
                                            ["DECIMAL", "Money and other exact fractional values."],
                                            ["BOOLEAN", "True or false flags."],
                                            ["DATE", "A calendar date with no time."],
                                            ["TIME", "A time of day with no date."],
                                            ["DATETIME", "A date and time together — timestamps, created_at."],
                                        ].map(([type, use]) => (
                                            <tr key={type} className="border-b border-zinc-100 last:border-0 align-top">
                                                <td className="whitespace-nowrap px-4 py-3">
                                                    <Code>{type}</Code>
                                                </td>
                                                <td className="px-4 py-3 text-zinc-600">{use}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <p>
                            If a table was imported with a type that is not in this list, that type is
                            kept and shown as-is — editing another property of the column will not
                            silently rewrite it.
                        </p>
                    </Section>

                    <Section
                        id="relationships"
                        title="Relationships"
                        lead="Lines between tables are foreign keys, read back from the database's own metadata."
                    >
                        <p>
                            A line appears when a real foreign key exists. Define one when you{" "}
                            <a href="#create-table" className="text-blue-700 underline underline-offset-2">create a table</a>, or
                            import a file that already has them, and the edge is drawn for you.
                        </p>
                        <Callout tone="warn" title="The key icons follow a naming convention, not the schema">
                            On the canvas, the small <KeyRound size={12} className="inline -mt-0.5" /> icon and the
                            blue connection dots are shown for any column named <Code>id</Code> or
                            ending in <Code>_id</Code>. That is a display convention — a column called{" "}
                            <Code>parent_id</Code> gets the icon whether or not it is really a key. The
                            Explorer&apos;s blue primary-key marking uses the real schema, so trust that
                            one when the two disagree.
                        </Callout>
                    </Section>

                    <Section
                        id="delete-table"
                        title="Deleting a table"
                        lead="The bin icon on a table header, with a confirmation step."
                    >
                        <p>
                            If another table still has a foreign key pointing at this one, the delete
                            is refused and the blocking tables are named. Remove or repoint those
                            references first. This is enforced by the database, not by the interface,
                            so it cannot be worked around by accident.
                        </p>
                    </Section>

                    {/* ═══ Data ═══ */}

                    <Section
                        id="data-editor"
                        title="Viewing and editing rows"
                        lead="The Edit Data icon on a table header. Two ways to edit, depending on how much you are changing."
                    >
                        <ActionTable
                            rows={[
                                {
                                    action: "Click a cell",
                                    effect: <>Edits that one value. <Key>Enter</Key> or clicking away saves it; <Key>Esc</Key> abandons the edit.</>,
                                },
                                {
                                    icon: <Pencil size={15} />,
                                    action: "Row pencil",
                                    effect: <>Opens every field in the row at once. <Key>Enter</Key> saves, <Key>Esc</Key> cancels, or use the tick and cross.</>,
                                },
                                {
                                    icon: <Plus size={15} />,
                                    action: "Add row",
                                    effect: <>A blank row to fill in. Leave a text field empty to store <Code>NULL</Code>.</>,
                                },
                                {
                                    icon: <Trash2 size={15} />,
                                    action: "Delete row",
                                    effect: <>Removes the row after a confirmation. It cannot be undone.</>,
                                },
                            ]}
                        />
                        <Callout tone="warn" title="Rows need an id column to be edited">
                            Updates and deletes identify the row by its <Code>id</Code> (or{" "}
                            <Code>ID</Code>) column. A table without one is still readable, and you can
                            still add rows, but the edit and delete buttons on each row are disabled
                            rather than silently doing nothing.
                        </Callout>
                    </Section>

                    {/* ═══ Getting work out ═══ */}

                    <Section
                        id="notes"
                        title="Notes and to-dos"
                        lead="A per-table checklist, stored with the file."
                    >
                        <p>
                            Click the note icon on a table header to jot down what still needs doing —{" "}
                            <em>add an index on customer_id</em>, say. Tick items off as you go, or
                            delete them. The count of open items shows as an amber badge on the table,
                            so you can see outstanding work without opening anything.
                        </p>
                        <p>
                            Notes belong to the file, not to your browser, so they travel with an
                            export and are visible to anyone you share the file with.
                        </p>
                    </Section>

                    <Section
                        id="export"
                        title="Exporting"
                        lead="File → Export. Two formats, for two different purposes."
                    >
                        <ActionTable
                            rows={[
                                {
                                    icon: <FileCode size={15} />,
                                    action: "Export SQL script",
                                    effect: <>Schema and data as a runnable script — re-import it here, or run it against another database. Needs an account.</>,
                                },
                                {
                                    icon: <ImageIcon size={15} />,
                                    action: "Export diagram (PNG)",
                                    effect: <>A picture of the whole diagram for a document or a pull request. It captures every table, not just what is on screen.</>,
                                },
                                {
                                    icon: <Download size={15} />,
                                    action: "Download CSV (per table)",
                                    effect: <>On a table header. Exports that one table&apos;s rows. Needs an account.</>,
                                },
                            ]}
                        />
                        <p>
                            Both export options are greyed out until a file is open — there is nothing
                            to export otherwise.
                        </p>
                    </Section>

                    <Section
                        id="sharing"
                        title="Sharing a link"
                        lead="The Share button, beside File in the header."
                    >
                        <p>
                            Creates a link to a read-only view of the current file. Whoever opens it
                            can explore the diagram and read the tables. They cannot change anything,
                            and they do not need an account — the link itself is the credential.
                        </p>
                        <p>
                            Clicking Share again on the same file returns the existing link rather than
                            minting a second one. A link stops working when you revoke it in the same
                            dialog, or when you delete the file.
                        </p>
                        <Callout tone="warn" title="Treat the link as public">
                            Anyone who has it can view the file. If it reaches somewhere you did not
                            intend, revoke it — that takes effect immediately.
                        </Callout>
                    </Section>

                    <Section
                        id="accounts"
                        title="Accounts"
                        lead="Optional. You only need one to export a file, download a CSV, or create a share link."
                    >
                        <p>
                            Everything else — importing, editing schema and data, visualising, using
                            templates — works signed out.
                        </p>
                        <p>A password must have:</p>
                        <ul className="ml-1 space-y-1.5">
                            {[
                                "at least 8 characters",
                                "at least one capital letter",
                                "at least one special character",
                            ].map(rule => (
                                <li key={rule} className="flex items-start gap-2.5">
                                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                                    {rule}
                                </li>
                            ))}
                        </ul>
                        <p>
                            If any of these are missing, the form tells you all of them at once rather
                            than one per attempt. An email that already has an account is rejected as
                            such — sign in instead, or use a different address.
                        </p>
                    </Section>

                    {/* ═══ Reference ═══ */}

                    <Section
                        id="shortcuts"
                        title="Keys"
                        lead="What the keyboard does in the row editor and the dialogs."
                    >
                        <ActionTable
                            rows={[
                                { action: "Enter", effect: <>Saves the cell or row you are editing.</> },
                                { action: "Esc", effect: <>Abandons the current edit, or closes the open dialog or menu.</> },
                                { action: "Scroll wheel", effect: <>Zooms the canvas. Drag the background to pan.</> },
                            ]}
                        />
                    </Section>

                    <Section id="faq" title="Common questions">
                        <div className="space-y-5">
                            {[
                                {
                                    q: "Will my work still be here after I restart?",
                                    a: <>Yes. The databases live on the server and your browser remembers which files were open and where you put each table. The schema itself is always re-read from the server, so it cannot go stale.</>,
                                },
                                {
                                    q: "Can two files have a table with the same name?",
                                    a: <>Yes — that is the point of one database per file. The two are completely independent.</>,
                                },
                                {
                                    q: "Why is the Share button greyed out?",
                                    a: <>Either no file is open, or you are signed out. A padlock on the button means it is the account that is missing.</>,
                                },
                                {
                                    q: "I renamed a column but the canvas looks unchanged.",
                                    a: <>The canvas refreshes from the server after every edit. If it looks stale, switch files in the Explorer and back — and if it persists, the rename did not reach the database, so check for an error notice.</>,
                                },
                                {
                                    q: "My .sql file imported only partly.",
                                    a: <>The import report lists how many statements were skipped and why. Expand its details to see which ones — usually a dialect feature with no equivalent here.</>,
                                },
                                {
                                    q: "Can I draw a relationship by dragging between tables?",
                                    a: <>Not currently. Foreign keys are defined when you create a table, or imported with a file. Dragging between the connection dots does not write anything.</>,
                                },
                            ].map(({ q, a }) => (
                                <div key={q} className="surface-card rounded-xl border p-5">
                                    <p className="font-semibold text-zinc-900">{q}</p>
                                    <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-600">{a}</p>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* Closing prompt */}
                    <div className="brand-gradient shadow-glow-lg relative overflow-hidden rounded-2xl p-8">
                        <span
                            aria-hidden
                            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/15 blur-3xl"
                        />
                        <div className="relative sm:flex sm:items-center sm:justify-between sm:gap-6">
                            <div>
                                <h2 className="text-xl font-bold text-white">Ready to try it?</h2>
                                <p className="mt-1.5 text-[14px] leading-relaxed text-blue-100">
                                    Open a file and the rest of this page will make more sense.
                                </p>
                            </div>
                            <Link
                                href="/app"
                                className="mt-5 inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-blue-700 shadow-lg transition-all hover:-translate-y-0.5 sm:mt-0"
                            >
                                Open the app <ArrowRight size={16} />
                            </Link>
                        </div>
                    </div>
                </main>
            </div>

            <AuthModal
                isOpen={isAuthOpen}
                initialMode={authMode}
                onClose={() => setAuthOpen(false)}
                onSignedIn={u => { setUser(u); setAuthOpen(false); }}
            />
        </div>
    );
}
