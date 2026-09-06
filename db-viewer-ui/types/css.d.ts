/**
 * Ambient declarations for stylesheet side-effect imports.
 *
 * `import "reactflow/dist/style.css"` and `import "./globals.css"` are handled by the bundler,
 * not by TypeScript, so TS has no module to resolve. It only complains when
 * `noUncheckedSideEffectImports` is switched on (TypeScript 5.6+) - which this project's
 * tsconfig does not do, but an editor using its own TypeScript settings may. Declaring the
 * modules here keeps the editor quiet without changing what the compiler or the build does.
 */
declare module '*.css';
declare module '*.scss';
