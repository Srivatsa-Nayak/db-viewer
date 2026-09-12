import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

/** The UI typeface, and its monospace counterpart. Geist Mono is used only for genuinely
 *  monospace content — table and column names, SQL, the Monaco editor — where character
 *  alignment matters. It is a neutral grotesque like Inter, so the two sit together without
 *  the tall, quirky letterforms of JetBrains Mono pulling focus. */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

/** Origin of the API, used only to warm the connection. */
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').origin;
  } catch {
    return null;
  }
})();

export const metadata: Metadata = {
  title: "SQL Visualizer — see your database, not just your SQL",
  description:
    "Import a .csv or .sql file and get a live entity-relationship diagram you can edit. "
    + "Start from a template, share a read-only link, and export SQL or a PNG.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <head>
        {/* The catalogue is fetched on first paint and the API is a separate origin in
            production, so warming the connection removes a round trip from that request. */}
        {apiOrigin && (
          <>
            <link rel="preconnect" href={apiOrigin} crossOrigin="" />
            <link rel="dns-prefetch" href={apiOrigin} />
          </>
        )}
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
