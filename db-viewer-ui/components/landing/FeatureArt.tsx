"use client";

import React from 'react';

/**
 * Small drawings for the feature cards.
 *
 * Each one shows the mechanism the card describes rather than decorating it — a relationship
 * being drawn, a delete being refused, a row being edited. They are inline SVG so they cost
 * nothing to load, animate on CSS alone, and stay crisp at any size.
 *
 * All motion is driven by `group-hover` on the parent card, so a still page has no moving
 * parts and the reduced-motion guard in globals.css applies to the shared keyframes.
 */

const BLUE = '#2563eb';
const LIGHT = '#bfdbfe';
const SLATE = '#94a3b8';

/** Shared frame: a fixed viewBox keeps every drawing optically the same size. */
const Art = ({ children }: { children: React.ReactNode }) => (
    <svg
        viewBox="0 0 200 92"
        className="h-[92px] w-full"
        fill="none"
        aria-hidden
    >
        {children}
    </svg>
);

/** A table box, used by most of the drawings below. */
const Box = ({ x, y, w = 58, h = 38, label, dim = false }: {
    x: number; y: number; w?: number; h?: number; label?: string; dim?: boolean;
}) => (
    <g>
        <rect x={x} y={y} width={w} height={h} rx="4"
            fill="#fff" stroke={dim ? '#e4e4e7' : LIGHT} strokeWidth="1.5" />
        <rect x={x} y={y} width={w} height="10" rx="4" fill={dim ? SLATE : BLUE} />
        <rect x={x} y={y + 6} width={w} height="4" fill={dim ? SLATE : BLUE} />
        {label && (
            <text x={x + 5} y={y + 7.6} fontSize="5.5" fill="#fff" fontFamily="monospace">
                {label}
            </text>
        )}
        <rect x={x + 5} y={y + 16} width={w - 22} height="2.5" rx="1.25" fill="#e4e4e7" />
        <rect x={x + 5} y={y + 23} width={w - 14} height="2.5" rx="1.25" fill="#e4e4e7" />
        <rect x={x + 5} y={y + 30} width={w - 28} height="2.5" rx="1.25" fill="#e4e4e7" />
    </g>
);

/** Import: a file turning into a table. */
export const ArtImport = () => (
    <Art>
        <g>
            <path d="M14 20 h26 l10 10 v42 a3 3 0 0 1 -3 3 h-33 a3 3 0 0 1 -3 -3 v-49 a3 3 0 0 1 3 -3 z"
                fill="#fff" stroke={LIGHT} strokeWidth="1.5" />
            <path d="M40 20 v10 h10" fill="none" stroke={LIGHT} strokeWidth="1.5" />
            {[0, 1, 2, 3].map(i => (
                <rect key={i} x="19" y={38 + i * 7} width={i === 3 ? 16 : 26} height="2.5" rx="1.25" fill="#d4d4d8" />
            ))}
        </g>

        {/* The arrow slides across on hover, as though carrying the file over. */}
        <g className="transition-transform duration-500 group-hover:translate-x-1.5">
            <path d="M66 46 h20" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M82 41 l6 5 l-6 5" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>

        <g className="origin-center transition-transform duration-500 group-hover:scale-[1.06]">
            <Box x={100} y={27} w={62} h={38} label="orders" />
        </g>
    </Art>
);

/** Relationships: an edge that draws itself on hover. */
export const ArtRelationships = () => (
    <Art>
        <Box x={10} y={8} label="users" />
        <Box x={10} y={54} w={58} h={30} label="carts" />
        <Box x={128} y={27} label="orders" />

        <g stroke={BLUE} strokeWidth="1.8" fill="none" strokeLinecap="round">
            {/* dasharray equals the path length, so the line is hidden until hovered */}
            <path
                d="M68 27 C 98 27, 98 40, 128 40"
                strokeDasharray="70"
                strokeDashoffset="70"
                className="transition-[stroke-dashoffset] duration-700 group-hover:[stroke-dashoffset:0]"
            />
            <path
                d="M68 69 C 98 69, 98 56, 128 56"
                strokeDasharray="70"
                strokeDashoffset="70"
                className="transition-[stroke-dashoffset] delay-150 duration-700 group-hover:[stroke-dashoffset:0]"
            />
        </g>
        <circle cx="128" cy="40" r="2.6" fill={BLUE}
            className="opacity-0 transition-opacity delay-500 duration-300 group-hover:opacity-100" />
        <circle cx="128" cy="56" r="2.6" fill={BLUE}
            className="opacity-0 transition-opacity delay-700 duration-300 group-hover:opacity-100" />
    </Art>
);

/** Isolation: stacked files, each its own database. */
export const ArtIsolation = () => (
    <Art>
        {[2, 1, 0].map(i => (
            <g
                key={i}
                className="transition-transform duration-500"
                style={{ transform: `translate(${i * 16}px, ${i * 9}px)` }}
            >
                <g className={i === 0 ? 'group-hover:-translate-y-1 transition-transform duration-500' : ''}>
                    <rect x="28" y="14" width="86" height="52" rx="6"
                        fill="#fff" stroke={i === 0 ? LIGHT : '#e4e4e7'} strokeWidth="1.5" />
                    <rect x="28" y="14" width="86" height="12" rx="6" fill={i === 0 ? BLUE : SLATE} />
                    <rect x="28" y="20" width="86" height="6" fill={i === 0 ? BLUE : SLATE} />
                    <text x="34" y="22.5" fontSize="6" fill="#fff" fontFamily="monospace">
                        {['shop.sql', 'crm.sql', 'blog.sql'][i]}
                    </text>
                    <rect x="34" y="33" width="42" height="3" rx="1.5" fill="#e4e4e7" />
                    <rect x="34" y="41" width="58" height="3" rx="1.5" fill="#e4e4e7" />
                    <rect x="34" y="49" width="34" height="3" rx="1.5" fill="#e4e4e7" />
                </g>
            </g>
        ))}
    </Art>
);

/** Live editing: a cell with a caret, value swapping on hover. */
export const ArtEditing = () => (
    <Art>
        <rect x="18" y="14" width="164" height="64" rx="5" fill="#fff" stroke={LIGHT} strokeWidth="1.5" />
        <rect x="18" y="14" width="164" height="13" rx="5" fill={BLUE} />
        <rect x="18" y="21" width="164" height="6" fill={BLUE} />
        {['id', 'name', 'city'].map((h, i) => (
            <text key={h} x={26 + i * 54} y={23} fontSize="6" fill="#fff" fontFamily="monospace">{h}</text>
        ))}

        {[0, 1].map(r => (
            <g key={r}>
                <line x1="18" y1={41 + r * 18} x2="182" y2={41 + r * 18} stroke="#f4f4f5" strokeWidth="1" />
                {[0, 1, 2].map(c => (
                    <rect key={c} x={26 + c * 54} y={33 + r * 18} width={c === 0 ? 12 : 34} height="3" rx="1.5" fill="#e4e4e7" />
                ))}
            </g>
        ))}

        {/* The edited cell highlights and grows a caret. */}
        <g className="opacity-60 transition-opacity duration-300 group-hover:opacity-100">
            <rect x="76" y="48" width="44" height="13" rx="2.5"
                fill="#eff6ff" stroke={BLUE} strokeWidth="1.2" />
            <rect x="80" y="53" width="26" height="3" rx="1.5" fill={BLUE} />
            <rect x="110" y="50.5" width="1.4" height="8" fill={BLUE}
                className="group-hover:caret" />
        </g>
    </Art>
);

/** Safe delete: the bin is blocked by a dependency. */
export const ArtSafeDelete = () => (
    <Art>
        <Box x={16} y={26} w={56} h={40} label="orders" />
        <Box x={124} y={26} w={56} h={40} label="customers" />

        <path d="M72 46 h52" stroke={BLUE} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="124" cy="46" r="2.6" fill={BLUE} />

        {/* A refusal marker settles over the target on hover. */}
        <g className="origin-center transition-transform duration-500 group-hover:scale-110">
            <circle cx="152" cy="46" r="15" fill="#fef2f2" stroke="#fca5a5" strokeWidth="1.6" />
            <path d="M145 39 l14 14 M159 39 l-14 14" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" />
        </g>
    </Art>
);

/** Share: one file, several read-only viewers. */
export const ArtShare = () => (
    <Art>
        <Box x={16} y={26} w={62} h={40} label="shop.sql" />
        <path d="M78 46 C 100 46, 100 26, 122 26" stroke={BLUE} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M78 46 h44" stroke={BLUE} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M78 46 C 100 46, 100 66, 122 66" stroke={BLUE} strokeWidth="1.6" fill="none" strokeLinecap="round" />

        {[26, 46, 66].map((cy, i) => (
            <g
                key={cy}
                className="transition-transform duration-500"
                style={{ transitionDelay: `${i * 90}ms` }}
            >
                <g className="group-hover:translate-x-1 transition-transform duration-500">
                    <circle cx="134" cy={cy} r="10" fill="#eff6ff" stroke={LIGHT} strokeWidth="1.4" />
                    <circle cx="134" cy={cy - 2.5} r="3" fill={BLUE} />
                    <path d={`M128.5 ${cy + 6} a5.5 5.5 0 0 1 11 0`} fill={BLUE} />
                </g>
            </g>
        ))}
        <text x="150" y="49" fontSize="6.5" fill={SLATE} fontFamily="monospace">read-only</text>
    </Art>
);

/** Notes: a sticky list with items ticking off. */
export const ArtNotes = () => (
    <Art>
        <Box x={14} y={22} w={54} h={48} label="orders" dim />
        <g>
            <rect x="86" y="14" width="100" height="64" rx="5" fill="#fffbeb" stroke="#fde68a" strokeWidth="1.5" />
            {[0, 1, 2].map(i => (
                <g key={i}>
                    <rect x="94" y={26 + i * 17} width="9" height="9" rx="2"
                        fill={i === 0 ? '#f59e0b' : '#fff'} stroke="#fcd34d" strokeWidth="1.2"
                        className={i === 1 ? 'transition-all duration-500 group-hover:fill-[#f59e0b]' : ''} />
                    {i === 0 && (
                        <path d="M96 30.5 l2 2 l3.5 -3.5" stroke="#fff" strokeWidth="1.4"
                            strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    )}
                    <rect x="109" y={29 + i * 17} width={i === 2 ? 44 : 64} height="3" rx="1.5" fill="#fde68a" />
                </g>
            ))}
        </g>
    </Art>
);

/** Export: one schema leaving as two artefacts. */
export const ArtExport = () => (
    <Art>
        <Box x={14} y={26} w={56} h={40} label="schema" />
        <path d="M70 46 C 88 46, 88 28, 106 28" stroke={BLUE} strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M70 46 C 88 46, 88 64, 106 64" stroke={BLUE} strokeWidth="1.6" fill="none" strokeLinecap="round" />

        {[
            { y: 14, label: '.sql', fill: '#eff6ff', stroke: LIGHT, text: BLUE },
            { y: 50, label: '.png', fill: '#ecfdf5', stroke: '#a7f3d0', text: '#059669' },
        ].map((f, i) => (
            <g
                key={f.label}
                className="transition-transform duration-500"
                style={{ transitionDelay: `${i * 110}ms` }}
            >
                <g className="group-hover:translate-x-1.5 transition-transform duration-500">
                    <rect x="106" y={f.y} width="64" height="28" rx="4" fill={f.fill} stroke={f.stroke} strokeWidth="1.4" />
                    <text x="116" y={f.y + 18} fontSize="9" fill={f.text} fontFamily="monospace">{f.label}</text>
                    <path d={`M156 ${f.y + 10} v7 M152.5 ${f.y + 14} l3.5 3.5 l3.5 -3.5`}
                        stroke={f.text} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </g>
            </g>
        ))}
    </Art>
);

/** Schema editing: a new column dropping into a table. */
export const ArtSchemaEdit = () => (
    <Art>
        <rect x="52" y="12" width="96" height="68" rx="5" fill="#fff" stroke={LIGHT} strokeWidth="1.5" />
        <rect x="52" y="12" width="96" height="13" rx="5" fill={BLUE} />
        <rect x="52" y="19" width="96" height="6" fill={BLUE} />
        <text x="59" y="21.5" fontSize="6" fill="#fff" fontFamily="monospace">customers</text>

        {[0, 1].map(i => (
            <g key={i}>
                <rect x="60" y={33 + i * 13} width="34" height="3" rx="1.5" fill="#e4e4e7" />
                <rect x="108" y={33 + i * 13} width="28" height="3" rx="1.5" fill="#f4f4f5" />
            </g>
        ))}

        {/* The new column slides in and lights up. */}
        <g className="opacity-70 transition-all duration-500 group-hover:opacity-100 group-hover:translate-y-0 translate-y-1">
            <rect x="56" y="57" width="88" height="13" rx="2.5" fill="#eff6ff" stroke={BLUE} strokeWidth="1.2" strokeDasharray="3 2" />
            <rect x="60" y="62" width="34" height="3" rx="1.5" fill={BLUE} />
            <rect x="108" y="62" width="28" height="3" rx="1.5" fill="#93c5fd" />
        </g>
    </Art>
);
