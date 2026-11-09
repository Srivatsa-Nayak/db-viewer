import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the frontend's pure logic: parsers, transforms, exporters, the stream reader.
 *
 * Node environment, no DOM: nothing here renders a component. The `@/` alias mirrors tsconfig's
 * `paths`, and JSX is compiled with the automatic runtime the app itself uses.
 */
export default defineConfig({
    resolve: {
        alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
    },
    esbuild: { jsx: 'automatic' },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
