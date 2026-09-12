"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Database, Menu, X } from 'lucide-react';
import { AuthUser } from '@/services/api';

interface LandingNavProps {
    user: AuthUser | null;
    onLogin: () => void;
    onSignup: () => void;
    onSignOut: () => void;
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
export const LandingNav = ({ user, onLogin, onSignup, onSignOut }: LandingNavProps) => {
    const pathname = usePathname();
    // Off the landing page the anchors have to point back at it, or they resolve against
    // the current route and go nowhere.
    const isLanding = pathname === '/';
    const sectionHref = (id: string) => (isLanding ? `#${id}` : `/#${id}`);

    const [isScrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useState<string | null>(null);
    const [isMenuOpen, setMenuOpen] = useState(false);

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
                ? 'bg-blue-50 text-blue-700'
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'
        }`;

    return (
        <header className="fixed top-0 inset-x-0 z-50 px-4 pt-4">
            <nav
                className={`mx-auto max-w-6xl rounded-full border border-zinc-200/80 bg-white/90 backdrop-blur-md transition-shadow ${
                    isScrolled ? 'shadow-lg shadow-zinc-900/[0.07]' : 'shadow-sm'
                }`}
            >
                <div className="flex items-center justify-between gap-4 pl-6 pr-4 py-3.5">

                    {/* Left: brand */}
                    <Link href="/" className="flex items-center gap-3 shrink-0 group">
                        <span className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
                            <Database size={20} className="text-white" />
                        </span>
                        <span className="text-[17px] font-semibold text-zinc-900 tracking-tight">
                            SQL <span className="text-blue-600">Visualizer</span>
                        </span>
                    </Link>

                    {/* Middle: in-page sections. Hidden on small screens, where they move
                        into the dropdown below. */}
                    <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
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

                    {/* Right: account */}
                    <div className="flex items-center gap-2 shrink-0">
                        {user ? (
                            <>
                                <Link
                                    href="/app"
                                    className="hidden sm:inline-flex px-5 py-2 rounded-full text-[15px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                                >
                                    Open app
                                </Link>
                                <button
                                    onClick={onSignOut}
                                    className="px-4 py-2 rounded-full text-[15px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                                    title={user.email}
                                >
                                    Sign out
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={onLogin}
                                    className="px-4 py-2 rounded-full text-[15px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                                >
                                    Login
                                </button>
                                {/* The coloured outline the design calls for. */}
                                <button
                                    onClick={onSignup}
                                    className="px-5 py-2 rounded-full text-[15px] font-semibold text-blue-700 border-2 border-blue-600 hover:bg-blue-600 hover:text-white transition-colors"
                                >
                                    Sign up
                                </button>
                            </>
                        )}

                        <button
                            onClick={() => setMenuOpen(v => !v)}
                            className="md:hidden p-2 rounded-full text-zinc-500 hover:bg-zinc-100 transition-colors"
                            aria-label="Menu"
                            aria-expanded={isMenuOpen}
                        >
                            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>

                {isMenuOpen && (
                    <div className="md:hidden border-t border-zinc-200/80 px-4 py-2 flex flex-col">
                        {SECTIONS.map(({ id, label }) => (
                            <a
                                key={id}
                                href={sectionHref(id)}
                                onClick={() => setMenuOpen(false)}
                                className="px-3 py-2.5 rounded-lg text-[15px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
                            >
                                {label}
                            </a>
                        ))}
                        {PAGES.map(({ href, label }) => (
                            <Link
                                key={href}
                                href={href}
                                onClick={() => setMenuOpen(false)}
                                className="px-3 py-2.5 rounded-lg text-[15px] font-medium text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100"
                            >
                                {label}
                            </Link>
                        ))}
                    </div>
                )}
            </nav>
        </header>
    );
};
