import type { MetadataRoute } from "next";
import { SITE_URL } from "@/services/site";

/** `/sitemap.xml`: the two public pages. The editor and share links are kept out (robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/docs`, changeFrequency: "monthly", priority: 0.8 },
  ];
}
