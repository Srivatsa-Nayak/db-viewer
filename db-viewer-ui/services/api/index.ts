/**
 * Every call to the backend, split by domain. Import from `@/services/api` as before: this
 * barrel re-exports all of it, so no caller had to change when the 1,000-line file was split.
 */
export * from './client';
export * from './schema';
export * from './auth';
export * from './assistant';
export * from './sharing';
export * from './templates';
