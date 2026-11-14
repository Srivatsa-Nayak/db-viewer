/**
 * The public address of this UI, for the things that must be absolute: link-preview images,
 * the sitemap and robots.txt. `NEXT_PUBLIC_SITE_URL` overrides it (inlined at build time like
 * every `NEXT_PUBLIC_*` value); the default is the deployed site.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://db-viewer-ui-srivatsa.azurewebsites.net')
    .replace(/\/+$/, '');
