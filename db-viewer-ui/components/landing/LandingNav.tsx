"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Database, Menu, X, Settings, ChevronDown, LogOut, User } from 'lucide-react';
import { AuthUser } from '@/services/api';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useDismissable } from '@/components/ui/useDismissable';

interface LandingNavProps {
    user: AuthUser | null;
    onLogin: () => void;
    onSignup: () => void;
    onSignOut: () => void;
    onEditProfile: () => void;
}

/** In-page anchors on the landing page. */
const SECTIONS = [
    { id: 'features', label: 'Features' },
    { id: 'templates', label: 'Templates' },
];

/** Real routes. Docs is a page of its own, so it cannot be an anchor. */
const PAGES = [
    { href: '/docs', label: 'Docs' },
];

/**
 * The floating pill navigation.
 *
 * Deliberately not full-bleed: it is a contained, rounded bar that sits over the page with a
 * gutter on both sides, so the landing page reads as a product page rather than as the app's
 * own chrome. White, so the hero reads as the page's own surface rather than as an extension
 * of the editor's blue header.
 */
export const LandingNav = ({ user, onLogin, onSignup, onSignOut, onEditProfile }: LandingNavProps) => {
    const pathname = usePathname();
    // Off the landing page the anchors have to point back at it, or they resolve against
    // the current route and go nowhere.
    const isLanding = pathname === '/';
    const sectionHref = (id: string) => (isLanding ? `#${id}` : `/#${id}`);

    const [isScrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useState<string | null>(null);
    const [isMenuOpen, setMenuOpen] = useState(false);
    const [isAccountOpen, setAccountOpen] = useState(false);
    const accountRef = useDismissable<HTMLDivElement>(isAccountOpen, () => setAccountOpen(false));

    // Deepen the shadow once the page moves, so the pill separates from the content underneath.
    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 8);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Highlight whichever section is currently in view. Only meaningful on the landing
    // page — elsewhere the target sections do not exist.
    useEffect(() => {
        if (!isLanding) return;
        const observer = new IntersectionObserver(
            entries => {
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
                if (visible) setActiveSection(visible.target.id);
            },
            // The band excludes the area behind the nav, so a section only counts as active
            // once it is actually readable.
            { rootMargin: '-96px 0px -55% 0px', threshold: [0.1, 0.5] }
        );

        SECTIONS.forEach(({ id }) => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [isLanding]);

    const navLinkClass = (isActive: boolean) =>
        `px-4 py-2 rounded-full text-[15px] font-medium transition-colors ${
            isActive
                ? 'bg-brand-50 text-brand-700'
                : 'text-ink-600 hover:text-ink-900 hover:bg-ink-100'
        }`;

    return (
        <header className="fixed top-0 inset-x-0 z-50 px-3 sm:px-4 pt-3 sm:pt-4">
            <nav
                className={`mx-auto max-w-6xl rounded-full border border-ink-200/80 bg-surface/90 backdrop-blur-md transition-shadow ${
                    isScrolled ? 'shadow-lg shadow-ink-900/[0.07]' : 'shadow-sm'
                }`}
            >
                {/* Three columns that all take part in the layout.

                    The middle used to be `absolute left-1/2`, which centres it perfectly and lets
                    the other two grow straight over it. Signed in, the right-hand cluster was four
                    controls wide and reached back far enough to print the theme toggle on top of
                    "Docs". Equal flexible gutters keep the links optically centred *and* reserve
                    their space, so no amount of growth on either side can overlap them again. */}
                <div className="flex items-center gap-2 sm:gap-4 pl-3 sm:pl-6 pr-3 sm:pr-4 py-2.5 sm:py-3.5">

                    {/* Left: brand */}
                    <Link href="/" className="group flex min-w-0 flex-1 items-center justify-start gap-2.5 sm:gap-3">
                        <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl brand-gradient flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
                            <Database size={20} className="text-white" />
                        </span>
                        {/* The wordmark is the first thing to go on a narrow screen: the mark
                            alone still identifies the product, and three controls plus a menu
                            button already fill a 360px bar. */}
                        <span className="hidden xs:inline text-[17px] font-semibold text-ink-900 tracking-tight">
                            SQL <span className="text-brand-600">Visualizer</span>
                        </span>
                    </Link>

                    {/* Middle: in-page sections. Hidden on small screens, where they move
                        into the dropdown below. */}
                    <div className="hidden shrink-0 items-center gap-1 md:flex">
                        {SECTIONS.map(({ id, label }) => (
                            <a key={id} href={sectionHref(id)} className={navLinkClass(isLanding && activeSection === id)}>
                                {label}
                            </a>
                        ))}
                        {PAGES.map(({ href, label }) => (
                            <Link key={href} href={href} className={navLinkClass(pathname === href)}>
                                {label}
                            </Link>
                        ))}
                    </div>

                    {/* Right: theme, then account */}
                    <div className="flex flex-1 items-center justify-end gap-2">
                        {/* Reachable from the marketing site too, so the choice does not have to
                            be made inside the editor to stick. It is the same stored preference. */}
                        <span className="hidden sm:block">
                            <ThemeToggle variant="plain" />
                        </span>

                        {user ? (
                            <>
                                {/* Signed in, the bar carries the account and nothing else. There
                                    is no "Open app" button here: the page's own calls to action
                                    already lead there, and a nav button that materialises only
                                    after signing in reads as something that appeared by accident.

                                    Name, profile and sign-out are one control rather than three
                                    pills — that is what used to overflow the bar, and it left
                                    "Sign out", the one thing nobody wants to hit by accident,
                                    sitting directly in the pointer's path. */}
                                <div className="relative hidden sm:block" ref={accountRef}>
                                    <button
                                        type="button"
                                        onClick={() => setAccountOpen(v => !v)}
                                        className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors ${
                                            isAccountOpen ? 'bg-ink-100' : 'hover:bg-ink-100'
                                        }`}
                                        aria-haspopup="menu"
                                        aria-expanded={isAccountOpen}
                                        title={`Signed in as ${user.email}`}
                                    >
                                        <span className="brand-gradient flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white">
                                            {(user.displayName || user.email).charAt(0).toUpperCase()}
                                        </span>
                                        {/* The name shows where there is room and lives in the
                                            menu where there is not, so a long one can never be the
                                            thing that pushes the bar apart. */}
                                        <span className="hidden max-w-[9rem] truncate text-[15px] font-medium text-ink-700 lg:block">
                                            {user.displayName}
                                        </span>
                                        <ChevronDown
                                            size={15}
                                            className={`shrink-0 text-ink-400 transition-transform ${isAccountOpen ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    {isAccountOpen && (
                                        <div
                                            role="menu"
                                            className="anim-menu-in absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-glow-lg"
                                        >
                                            <div className="border-b border-ink-100 px-4 py-3">
                                                <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
                                                    <User size={14} className="shrink-0 text-ink-400" />
                                                    <span className="truncate">{user.displayName}</span>
                                                </p>
                                                <p className="mt-0.5 truncate text-xs text-ink-500">{user.email}</p>
                                            </div>
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => { setAccountOpen(false); onEditProfile(); }}
                                                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
                                            >
                                                <Settings size={14} className="text-ink-400" /> Edit profile
                                            </button>
                                            <div className="h-px bg-ink-100" />
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={() => { setAccountOpen(false); onSignOut(); }}
                                                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50"
                                            >
                                                <LogOut size={14} className="text-ink-400" /> Sign out
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={onLogin}
                                    className="hidden sm:inline-flex px-4 py-2 rounded-full text-[15px] font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-100 transition-colors"
                                >
                                    Login
                                </button>
                                {/* The coloured outline the design calls for. */}
                                <button
                                    onClick={onSignup}
                                    className="px-4 sm:px-5 py-2 rounded-full text-sm sm:text-[15px] font-semibold text-brand-700 border-2 border-brand-600 hover:bg-brand-600 hover:text-white transition-colors whitespace-nowrap"
                                >
                                    Sign up
                                </button>
                            </>
                        )}

                        <button
                            onClick={() => setMenuOpen(v => !v)}
                            className="md:hidden p-2 rounded-full text-ink-500 hover:bg-ink-100 transition-colors"
                            aria-label="Menu"
                            aria-expanded={isMenuOpen}
                        >
                            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>

                {isMenuOpen && (
                    <div className="md:hidden border-t border-ink-200/80 px-4 py-2 flex flex-col">
                        {SECTIONS.map(({ id, label }) => (
                            <a
                                key={id}
                                href={sectionHref(id)}
                                onClick={() => setMenuOpen(false)}
                                className="px-3 py-2.5 rounded-lg text-[15px] font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-100"
                            >
                                {label}
                            </a>
                        ))}
                        {PAGES.map(({ href, label }) => (
                            <Link
                                key={href}
                                href={href}
                                onClick={() => setMenuOpen(false)}
                                className="px-3 py-2.5 rounded-lg text-[15px] font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-100"
                            >
                                {label}
                            </Link>
                        ))}

                        {/* Below sm these are hidden in the bar itself, so the menu is the
                            only way to reach them. */}
                        <div className="sm:hidden border-t border-ink-200/80 mt-2 pt-2 flex flex-col">
                            <Link
                                href="/app"
                                onClick={() => setMenuOpen(false)}
                                className="px-3 py-2.5 rounded-lg text-[15px] font-semibold text-brand-700 hover:bg-brand-50"
                            >
                                Open app
                            </Link>
                            {user && (
                                <button
                                    onClick={() => { setMenuOpen(false); onEditProfile(); }}
                                    className="px-3 py-2.5 rounded-lg text-left text-[15px] font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-100"
                                >
                                    Edit profile
                                </button>
                            )}
                            <button
                                onClick={() => { setMenuOpen(false); if (user) onSignOut(); else onLogin(); }}
                                className="px-3 py-2.5 rounded-lg text-left text-[15px] font-medium text-ink-600 hover:text-ink-900 hover:bg-ink-100"
                            >
                                {user ? 'Sign out' : 'Login'}
                            </button>
                        </div>
                    </div>
                )}
            </nav>
        </header>
    );
};
