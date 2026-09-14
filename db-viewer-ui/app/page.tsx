"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    ArrowRight, Database, Sparkles, Github, Mail, Upload, LayoutTemplate, Check,
} from "lucide-react";

import dynamic from "next/dynamic";

import { LandingNav } from "@/components/landing/LandingNav";
import { HeroDiagram } from "@/components/landing/HeroDiagram";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { TemplatesSection } from "@/components/landing/TemplatesSection";
import { Reveal } from "@/components/landing/Reveal";
import { Notice } from "@/components/modal/NoticeModal";
import {
    authService, dbService, setActiveWorkspace, AuthUser, SchemaTemplate,
} from "@/services/api";
import { clearSession, loadSession, saveSession } from "@/services/sessionStorage";
import { newWorkspaceId } from "@/services/workspaceId";

// Neither dialog is on the path to first paint, so neither belongs in the landing bundle.
const AuthModal = dynamic(() => import("@/components/modal/AuthModal").then(m => m.AuthModal), { ssr: false });
const NoticeModal = dynamic(() => import("@/components/modal/NoticeModal").then(m => m.NoticeModal), { ssr: false });
const ProfileModal = dynamic(() => import("@/components/modal/ProfileModal").then(m => m.ProfileModal), { ssr: false });

export default function LandingPage() {
    const router = useRouter();

    const [user, setUser] = useState<AuthUser | null>(null);
    const [isAuthOpen, setAuthOpen] = useState(false);
    const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
    const [isProfileOpen, setProfileOpen] = useState(false);
    const [notice, setNotice] = useState<Notice>({
        isOpen: false, severity: "error", title: "", message: "",
    });

    // Resolve the stored token, so someone who is already signed in sees that in the nav.
    useEffect(() => {
        let cancelled = false;
        authService.me().then(u => { if (!cancelled) setUser(u); });
        return () => { cancelled = true; };
    }, []);

    /** Whatever file was active before, so a failed template does not strand the client. */
    const existingActiveId = () => loadSession()?.activeWorkspaceId ?? null;

    /**
     * Creates a workspace, fills it from the template, and hands off to the editor.
     *
     * The handoff is the session file that `/app` already restores from on mount, so no
     * special-case wiring is needed on the other side: it finds the workspace, confirms it
     * exists via GET /workspaces, and reads the schema back like any other open file.
     */
    const handleUseTemplate = useCallback(async (template: SchemaTemplate) => {
        const workspaceId = newWorkspaceId();
        // Bind before applying, so the tables land in the new workspace rather than in
        // whatever the client was last pointed at.
        setActiveWorkspace(workspaceId);

        try {
            await dbService.applyTemplate(template.id);

            const existing = loadSession();
            saveSession({
                version: 1,
                activeWorkspaceId: workspaceId,
                workspaces: [
                    ...(existing?.workspaces ?? []),
                    { id: workspaceId, name: `${template.id}.sql`, isImported: false, positions: {} },
                ],
            });

            router.push("/app");
        } catch (err: unknown) {
            setActiveWorkspace(existingActiveId());
            const message = err && typeof err === "object" && "response" in err
                ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
                : undefined;
            setNotice({
                isOpen: true,
                severity: "error",
                title: "Could not open that template",
                message: message
                    || `"${template.name}" could not be created. Check that the backend is running.`,
            });
        }
    }, [router]);

    /** The open-files list belongs to the account being left, so it goes with it. */
    const handleSignOut = () => {
        authService.logout();
        setUser(null);
        clearSession();
    };

    const openAuth = (mode: "login" | "signup") => {
        setAuthMode(mode);
        setAuthOpen(true);
    };

    return (
        <div className="min-h-screen bg-white text-ink-800">
            <LandingNav
                user={user}
                onLogin={() => openAuth("login")}
                onSignup={() => openAuth("signup")}
                onSignOut={handleSignOut}
                onEditProfile={() => setProfileOpen(true)}
            />

            {/* ── Hero ─────────────────────────────────────────────────────────── */}
            <section className="section-wash relative overflow-hidden pt-40 pb-20 sm:pt-48 sm:pb-28">
                {/* Decorative light. Two soft blooms read as illumination; the flat band this
                    replaced read as a painted stripe. */}
                <div
                    aria-hidden
                    className="pointer-events-none absolute -left-32 -top-24 h-[34rem] w-[34rem] rounded-full bg-brand-400/20 blur-3xl"
                />
                <div
                    aria-hidden
                    className="pointer-events-none absolute -right-24 top-10 h-[30rem] w-[30rem] rounded-full bg-indigo-400/18 blur-3xl"
                />

                <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
                    <div>
                        <Reveal>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200/70 bg-white/80 px-3.5 py-1.5 text-xs font-medium text-brand-700 shadow-sm backdrop-blur-sm">
                                <Sparkles size={12} />
                                No install, no connection string
                            </span>
                        </Reveal>

                        <Reveal delay={90}>
                            <h1 className="mt-6 text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
                                See your database,{" "}
                                {/* The accent phrase drifts through blue into indigo, so the
                                    headline has a pulse without anything moving. */}
                                <span className="gradient-word bg-gradient-to-r from-brand-700 via-sky-500 to-indigo-600 bg-clip-text text-transparent">
                                    not just your SQL
                                </span>
                            </h1>
                        </Reveal>

                        <Reveal delay={170}>
                        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-600">
                            Drop in a <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.9em] text-ink-700">.csv</code> or{" "}
                            <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.9em] text-ink-700">.sql</code> file
                            and get a live entity-relationship diagram you can edit. Every change runs
                            against a real database, so what you see is what you have.
                        </p>
                        </Reveal>

                        <Reveal delay={250} className="mt-8 flex flex-wrap items-center gap-3">
                            <Link
                                href="/app"
                                className="brand-gradient brand-gradient-hover shadow-glow-md inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
                            >
                                Open the app <ArrowRight size={16} />
                            </Link>
                            <a
                                href="#templates"
                                className="inline-flex items-center gap-2 rounded-xl border border-[var(--surface-line)] bg-white/80 px-6 py-3.5 text-sm font-semibold text-ink-700 shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700"
                            >
                                Browse templates
                            </a>
                        </Reveal>

                        <Reveal delay={330}>
                            <p className="mt-5 text-sm text-ink-500">
                                Free, and no account needed to import, edit or visualise.
                            </p>
                        </Reveal>
                    </div>

                    <div className="lg:pl-4">
                        <HeroDiagram />
                    </div>
                </div>
            </section>

            <HowItWorks />

            <FeaturesSection />

            <TemplatesSection onUse={handleUseTemplate} />

            {/* ── Closing call to action ───────────────────────────────────────── */}
            <section className="px-6 py-20 sm:py-24">
                <Reveal className="brand-gradient shadow-glow-lg relative mx-auto max-w-5xl overflow-hidden rounded-3xl">
                    {/* A faint dot grid ties the panel back to the canvas, and a soft bloom
                        keeps the large flat area from reading as a solid block of colour. */}
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 opacity-[0.18]"
                        style={{
                            backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
                            backgroundSize: '22px 22px',
                        }}
                    />
                    <span
                        aria-hidden
                        className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-white/15 blur-3xl"
                    />

                    <div className="relative grid gap-10 p-8 sm:p-12 lg:grid-cols-2 lg:items-center">

                        {/* Left: the pitch */}
                        <div>
                            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                                Open a file and start looking around
                            </h2>
                            <p className="mt-4 max-w-md leading-relaxed text-brand-100">
                                Nothing to install and no connection string. Pick a starting point and
                                you will have a diagram in front of you in seconds.
                            </p>

                            <ul className="mt-6 space-y-2.5">
                                {[
                                    'Free to import, edit and visualise',
                                    'An account is only needed to export or share',
                                    'Your files stay isolated from each other',
                                ].map(line => (
                                    <li key={line} className="flex items-start gap-2.5 text-sm text-brand-50">
                                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/20">
                                            <Check size={10} strokeWidth={3} className="text-white" />
                                        </span>
                                        {line}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Right: the two ways in, as real choices rather than one button */}
                        <div className="space-y-3">
                            <Link
                                href="/app"
                                className="group flex items-center gap-4 rounded-2xl bg-white p-5 shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
                            >
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-600 group-hover:text-white">
                                    <Upload size={19} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block font-semibold text-ink-900">Import your own file</span>
                                    <span className="mt-0.5 block text-sm text-ink-500">
                                        Drop in a .csv or .sql and see it straight away.
                                    </span>
                                </span>
                                <ArrowRight size={18} className="shrink-0 text-ink-300 transition-all group-hover:translate-x-0.5 group-hover:text-brand-600" />
                            </Link>

                            <a
                                href="#templates"
                                className="group flex items-center gap-4 rounded-2xl border border-white/25 bg-white/10 p-5 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:bg-white/20"
                            >
                                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white">
                                    <LayoutTemplate size={19} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block font-semibold text-white">Start from a template</span>
                                    <span className="mt-0.5 block text-sm text-brand-100">
                                        Twelve ready-made schemas, with sample data.
                                    </span>
                                </span>
                                <ArrowRight size={18} className="shrink-0 text-brand-200 transition-transform group-hover:translate-x-0.5" />
                            </a>
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* ── Footer ───────────────────────────────────────────────────────── */}
            <footer className="border-t border-[var(--surface-line)] bg-[var(--surface-tint)]">
                <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-10 sm:flex-row">
                    <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
                            <Database size={16} className="text-white" />
                        </span>
                        <span className="text-sm font-semibold text-ink-900">
                            SQL <span className="text-brand-600">Visualizer</span>
                        </span>
                    </div>

                    <div className="flex items-center gap-5 text-sm text-ink-500">
                        <a href="#features" className="transition-colors hover:text-ink-900">Features</a>
                        <a href="#templates" className="transition-colors hover:text-ink-900">Templates</a>
                        <Link href="/docs" className="transition-colors hover:text-ink-900">Docs</Link>
                        <Link href="/app" className="transition-colors hover:text-ink-900">Open app</Link>
                    </div>

                    <div className="flex items-center gap-4">
                        <a
                            href="https://github.com/Srivatsa-Nayak"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
                        >
                            <Github size={15} /> Srivatsa-Nayak
                        </a>
                        <a
                            href="mailto:nayaksrivatsa15@gmail.com"
                            className="text-ink-400 transition-colors hover:text-ink-900"
                            title="nayaksrivatsa15@gmail.com"
                        >
                            <Mail size={15} />
                        </a>
                    </div>
                </div>
            </footer>

            {isAuthOpen && (
                <AuthModal
                    isOpen
                    initialMode={authMode}
                    onClose={() => setAuthOpen(false)}
                    onSignedIn={setUser}
                />
            )}

            {notice.isOpen && (
                <NoticeModal notice={notice} onClose={() => setNotice(n => ({ ...n, isOpen: false }))} />
            )}

            {isProfileOpen && user && (
                <ProfileModal
                    isOpen
                    user={user}
                    onClose={() => setProfileOpen(false)}
                    onUpdated={setUser}
                />
            )}
        </div>
    );
}
