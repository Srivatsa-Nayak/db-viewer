import type { MetadataRoute } from "next";
import { SITE_URL } from "@/services/site";

/**
 * `/robots.txt`. The landing page and the docs are worth finding; the editor is an empty shell
 * to a crawler, and a share link is somebody's schema that they sent to one person, not to a
 * search index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/share/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
