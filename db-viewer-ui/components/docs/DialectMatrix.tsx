"use client";

import React from 'react';
import { Check, Minus, CircleDot } from 'lucide-react';
import { ENGINES } from '@/components/landing/DatabaseLogos';

/**
 * Exactly what survives a trip through the importer and the exporter, per engine.
 *
 * The honest answer to "do you support PostgreSQL?" is never yes or no — it is "these parts, in
 * this way, and these others are dropped with a note". Anyone evaluating this tool for a
 * migration needs that list *before* they discover it themselves halfway through, so the
 * partial and the ignored rows are given exactly as much room as the supported ones.
 *
 * Every claim here is a statement about specific code: the translator in
 * `sql/SqlDialectTranslator`, the type mapping in `sql/SqlTypeMapper` and the writer in
 * `sql/SqlExportWriter`. If one of those changes, this table is wrong and has to change with it.
 */

type Level = 'full' | 'partial' | 'none';

interface Cell {
    level: Level;
    /** The specific spelling or caveat. Shown under the mark, so nothing depends on a tooltip. */
    note?: string;
}

interface Row {
    capability: string;
    /** Keyed by engine id. */
    cells: Record<string, Cell>;
}

const LEVELS: Record<Level, { icon: React.ReactNode; label: string; className: string }> = {
    full: {
        icon: <Check size={13} strokeWidth={3} />,
        label: 'Supported',
        className: 'text-emerald-600 dark:text-emerald-400',
    },
    partial: {
        icon: <CircleDot size={12} strokeWidth={2.5} />,
        label: 'Partly — read the note',
        className: 'text-amber-600 dark:text-amber-400',
    },
    none: {
        icon: <Minus size={13} strokeWidth={3} />,
        label: 'Skipped, with a note in the import report',
        className: 'text-ink-400',
    },
};

const cell = (level: Level, note?: string): Cell => ({ level, note });

/** Ids match `ENGINES`, and the last column covers the two non-vendor targets. */
const IMPORT_ROWS: Row[] = [
    {
        capability: 'Detected automatically',
        cells: {
            postgres: cell('full', 'SERIAL, nextval, COPY, ONLY'),
            mysql: cell('full', 'ENGINE=, backticks, /*!…*/'),
            sqlserver: cell('full', 'IDENTITY, [dbo]., GO'),
            mariadb: cell('full', 'its own dump header'),
        },
    },
    {
        capability: 'Tables and columns',
        cells: {
            postgres: cell('full'), mysql: cell('full'), sqlserver: cell('full'), mariadb: cell('full'),
        },
    },
    {
        capability: 'Primary keys declared inline',
        cells: {
            postgres: cell('full'), mysql: cell('full'), sqlserver: cell('full'), mariadb: cell('full'),
        },
    },
    {
        capability: 'Primary keys declared later',
        cells: {
            postgres: cell('full', 'ALTER TABLE ONLY … ADD CONSTRAINT'),
            mysql: cell('full', 'ALTER TABLE … ADD PRIMARY KEY'),
            sqlserver: cell('full', 'PRIMARY KEY CLUSTERED (… ASC)'),
            mariadb: cell('full', 'ALTER TABLE … ADD PRIMARY KEY'),
        },
    },
    {
        capability: 'Foreign keys',
        cells: {
            postgres: cell('full', 'inline and ALTER, with ON DELETE'),
            mysql: cell('full', 'inline and ALTER, with ON DELETE'),
            sqlserver: cell('full', 'inline and ALTER'),
            mariadb: cell('full', 'inline and ALTER, with ON DELETE'),
        },
    },
    {
        capability: 'Auto-incrementing keys',
        cells: {
            postgres: cell('full', 'SERIAL, nextval default, GENERATED … IDENTITY'),
            mysql: cell('full', 'AUTO_INCREMENT, inline or by ALTER'),
            sqlserver: cell('full', 'IDENTITY(1,1)'),
            mariadb: cell('full', 'AUTO_INCREMENT, inline or by ALTER'),
        },
    },
    {
        capability: 'Composite keys',
        cells: {
            postgres: cell('full'), mysql: cell('full'), sqlserver: cell('full'), mariadb: cell('full'),
        },
    },
    {
        capability: 'Row data',
        cells: {
            postgres: cell('full', 'INSERT, and COPY … FROM stdin blocks'),
            mysql: cell('full', 'including multi-row INSERT'),
            sqlserver: cell('full', "INSERT without INTO, N'' literals"),
            mariadb: cell('full', 'including multi-row INSERT'),
        },
    },
    {
        capability: 'Batch and client directives',
        cells: {
            postgres: cell('full', 'SET, search_path and \\connect dropped'),
            mysql: cell('full', 'DELIMITER blocks understood'),
            sqlserver: cell('full', 'GO splits batches'),
            mariadb: cell('full', 'DELIMITER blocks understood'),
        },
    },
    {
        capability: 'Schema-qualified names',
        cells: {
            postgres: cell('partial', 'public. is stripped — one flat database'),
            mysql: cell('partial', 'db. is stripped'),
            sqlserver: cell('partial', '[dbo]. is stripped'),
            mariadb: cell('partial', 'db. is stripped'),
        },
    },
    {
        capability: 'Indexes',
        cells: {
            postgres: cell('partial', 'kept; USING btree dropped'),
            mysql: cell('partial', 'CREATE INDEX kept; inline KEY dropped'),
            sqlserver: cell('partial', 'kept; WITH(…) and ON [PRIMARY] dropped'),
            mariadb: cell('partial', 'CREATE INDEX kept; inline KEY dropped'),
        },
    },
    {
        capability: 'UNIQUE and CHECK constraints',
        cells: {
            postgres: cell('none'), mysql: cell('none'), sqlserver: cell('none'), mariadb: cell('none'),
        },
    },
    {
        capability: 'Triggers, procedures, functions',
        cells: {
            postgres: cell('none'), mysql: cell('none'), sqlserver: cell('none'), mariadb: cell('none'),
        },
    },
    {
        capability: 'Views, sequences, extensions',
        cells: {
            postgres: cell('none', 'the sequence is folded into its key first'),
            mysql: cell('none'),
            sqlserver: cell('none'),
            mariadb: cell('none'),
        },
    },
    {
        capability: 'Collations, charsets, storage options',
        cells: {
            postgres: cell('none'), mysql: cell('none', 'ENGINE=, CHARSET=, COMMENT'),
            sqlserver: cell('none', 'TEXTIMAGE_ON, filegroups'), mariadb: cell('none', 'PAGE_CHECKSUM=, ENGINE='),
        },
    },
];

const EXPORT_ROWS: Row[] = [
    {
        capability: 'Identifier quoting',
        cells: {
            postgres: cell('full', '"double quotes"'),
            mysql: cell('full', '`backticks`'),
            sqlserver: cell('full', '[brackets]'),
            mariadb: cell('full', '`backticks`'),
        },
    },
    {
        capability: 'Auto-incrementing key',
        cells: {
            postgres: cell('full', 'SERIAL PRIMARY KEY'),
            mysql: cell('full', 'INT AUTO_INCREMENT PRIMARY KEY'),
            sqlserver: cell('full', 'INT IDENTITY(1,1) PRIMARY KEY'),
            mariadb: cell('full', 'INT AUTO_INCREMENT PRIMARY KEY'),
        },
    },
    {
        capability: 'Types in the engine’s own vocabulary',
        cells: {
            postgres: cell('full', 'BYTEA, DOUBLE PRECISION, NUMERIC'),
            mysql: cell('full', 'TINYINT(1), DATETIME, BLOB'),
            sqlserver: cell('full', 'NVARCHAR, DATETIME2, VARBINARY(MAX)'),
            mariadb: cell('full', 'TINYINT(1), DATETIME, BLOB'),
        },
    },
    {
        capability: 'Foreign keys, parents written first',
        cells: {
            postgres: cell('full'), mysql: cell('full'), sqlserver: cell('full'), mariadb: cell('full'),
        },
    },
    {
        capability: 'Rows keep their original ids',
        cells: {
            postgres: cell('full', 'setval() afterwards, so the sequence is not left behind'),
            mysql: cell('full', 'FOREIGN_KEY_CHECKS off around the load'),
            sqlserver: cell('full', 'SET IDENTITY_INSERT around the load'),
            mariadb: cell('full', 'FOREIGN_KEY_CHECKS off around the load'),
        },
    },
    {
        capability: 'Literal escaping',
        cells: {
            postgres: cell('full', "'' doubling; TRUE/FALSE for booleans"),
            mysql: cell('full', "'' doubling and backslash escaping"),
            sqlserver: cell('full', "'' doubling"),
            mariadb: cell('full', "'' doubling and backslash escaping"),
        },
    },
    {
        capability: 'Batch separators',
        cells: {
            postgres: cell('none', 'not needed'),
            mysql: cell('none', 'not needed'),
            sqlserver: cell('full', 'GO after each statement group'),
            mariadb: cell('none', 'not needed'),
        },
    },
    {
        capability: 'Indexes, UNIQUE, CHECK, DEFAULT',
        cells: {
            postgres: cell('none'), mysql: cell('none'), sqlserver: cell('none'), mariadb: cell('none'),
        },
    },
];

const Marker = ({ level, note }: Cell) => {
    const { icon, label, className } = LEVELS[level];
    return (
        <span className="flex flex-col items-center gap-1 text-center">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-ink-100 ${className}`} title={label}>
                {icon}
                <span className="sr-only">{label}</span>
            </span>
            {note && <span className="text-[11px] leading-tight text-ink-500">{note}</span>}
        </span>
    );
};

const Matrix = ({ caption, rows }: { caption: string; rows: Row[] }) => (
    <figure className="my-6">
        <figcaption className="mb-2 text-sm font-semibold text-ink-800">{caption}</figcaption>
        {/* The one element allowed to scroll sideways: five columns of engine notes will not fit
            a phone, and wrapping them would make the grid unreadable. */}
        <div className="overflow-x-auto scroll-slim rounded-xl border border-[var(--surface-line)]">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
                <thead>
                    <tr className="bg-ink-50">
                        <th scope="col" className="w-[15rem] px-4 py-3 text-left font-semibold text-ink-700">
                            Capability
                        </th>
                        {ENGINES.map(({ id, name, colour, Logo }) => (
                            <th key={id} scope="col" className="px-3 py-3 text-center font-semibold text-ink-700">
                                <span className="flex flex-col items-center gap-1.5">
                                    <span
                                        className="flex h-7 w-7 items-center justify-center rounded-lg"
                                        style={{ backgroundColor: `${colour}1f`, color: colour }}
                                    >
                                        <Logo className="h-4 w-4" />
                                    </span>
                                    {name}
                                </span>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.capability} className="border-t border-[var(--surface-line)] align-top">
                            <th scope="row" className="px-4 py-3 text-left font-medium text-ink-800">
                                {row.capability}
                            </th>
                            {ENGINES.map(({ id }) => (
                                <td key={id} className="px-3 py-3">
                                    <Marker {...(row.cells[id] ?? cell('none'))} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </figure>
);

const Legend = () => (
    <ul className="my-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-600">
        {(Object.keys(LEVELS) as Level[]).map(level => (
            <li key={level} className="flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full bg-ink-100 ${LEVELS[level].className}`}>
                    {LEVELS[level].icon}
                </span>
                {LEVELS[level].label}
            </li>
        ))}
    </ul>
);

/** How a source type is stored, and therefore what an export can put back. */
const TYPE_MAP: { from: string; stored: string; note?: string }[] = [
    { from: 'INT · INTEGER · BIGINT · SMALLINT · TINYINT · MEDIUMINT · YEAR', stored: 'INTEGER' },
    { from: 'SERIAL · BIGSERIAL · SMALLSERIAL', stored: 'INTEGER', note: 'and the column becomes the auto-incrementing key' },
    { from: 'BIT', stored: 'BOOLEAN · INTEGER', note: 'BOOLEAN from SQL Server, INTEGER from MySQL — the same spelling means different things' },
    { from: 'BOOLEAN · BOOL', stored: 'BOOLEAN', note: 'stored as 0/1; exported as TRUE/FALSE for PostgreSQL' },
    { from: 'VARCHAR · NVARCHAR · CHARACTER VARYING', stored: 'VARCHAR(n)', note: 'length kept; VARCHAR with no length becomes VARCHAR(255)' },
    { from: 'CHAR · NCHAR · BPCHAR', stored: 'CHAR(n)' },
    { from: 'TEXT · NTEXT · LONGTEXT · CLOB · NVARCHAR(MAX)', stored: 'TEXT' },
    { from: 'JSON · JSONB · XML · UUID · UNIQUEIDENTIFIER · INET · ENUM · SET', stored: 'TEXT', note: 'no equivalent; the value round-trips as text' },
    { from: 'integer[] · text[] · any array', stored: 'TEXT', note: 'SQLite has no array type at all' },
    { from: 'DECIMAL · NUMERIC · MONEY · SMALLMONEY', stored: 'DECIMAL(p,s)', note: 'precision preserved' },
    { from: 'FLOAT · REAL · DOUBLE PRECISION', stored: 'REAL' },
    { from: 'DATE', stored: 'DATE' },
    { from: 'TIME · TIME WITH/WITHOUT TIME ZONE', stored: 'TIME', note: 'the offset is not retained' },
    { from: 'DATETIME · DATETIME2 · SMALLDATETIME · DATETIMEOFFSET', stored: 'DATETIME' },
    { from: 'TIMESTAMP · TIMESTAMPTZ', stored: 'TIMESTAMP', note: 'the offset is not retained' },
    { from: 'BLOB · BYTEA · VARBINARY · IMAGE · ROWVERSION', stored: 'BLOB', note: 'binary values are not written into a SQL export' },
    { from: 'anything else, including user-defined types', stored: 'passed through', note: 'SQLite accepts any type name and applies affinity by substring' },
];

export const DialectMatrix = () => (
    <>
        <Legend />
        <Matrix caption="Reading a dump" rows={IMPORT_ROWS} />
        <Matrix caption="Writing a script" rows={EXPORT_ROWS} />
    </>
);

export const TypeMappingTable = () => (
    <div className="my-6 overflow-x-auto scroll-slim rounded-xl border border-[var(--surface-line)]">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
                <tr className="bg-ink-50">
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-ink-700">Declared in your file</th>
                    <th scope="col" className="w-[9rem] px-4 py-3 text-left font-semibold text-ink-700">Stored as</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-ink-700">Notes</th>
                </tr>
            </thead>
            <tbody>
                {TYPE_MAP.map(({ from, stored, note }) => (
                    <tr key={from} className="border-t border-[var(--surface-line)] align-top">
                        <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-700">{from}</td>
                        <td className="px-4 py-2.5 font-mono text-[12.5px] font-semibold text-brand-700">{stored}</td>
                        <td className="px-4 py-2.5 text-[13px] leading-relaxed text-ink-500">{note ?? '—'}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
