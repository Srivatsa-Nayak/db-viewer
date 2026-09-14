/**
 * A fresh backend workspace id.
 *
 * These used to be `Date.now().toString()` at four separate call sites. Two files created
 * inside the same millisecond — a double-click on "New file", or applying a template while
 * one is already being created — got the *same* id, which on the backend means the same
 * database: the second file silently opened on top of the first one's tables.
 *
 * The suffix is what makes it unique; the timestamp prefix is kept only so ids still sort
 * chronologically, which is handy when looking at `data/workspaces` on disk.
 */
export const newWorkspaceId = (): string => {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${Date.now()}-${random}`;
};
