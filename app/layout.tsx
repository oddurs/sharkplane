import type { Metadata, Viewport } from "next";
import { Bungee } from "next/font/google";
import "./globals.css";

const display = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const site = "https://oddurs.github.io/sharkplane/";
const description = "A low-poly arcade flight game where you're a big plane with a bad attitude. Don't shoot them — chase them down and gobble them up. Free, in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "SHARKPLANE — eat the skies", template: "%s · SHARKPLANE" },
  description,
  keywords: ["arcade flight game", "browser game", "low poly", "three.js", "shark plane", "free game", "webgl"],
  alternates: { canonical: site },
  robots: { index: true, follow: true },
  manifest: `${base}/manifest.json`,
  icons: { icon: [{ url: `${base}/icon.svg`, type: "image/svg+xml" }, { url: `${base}/icon-192.png`, sizes: "192x192" }], apple: `${base}/icon-192.png` },
  openGraph: { type: "website", url: site, siteName: "SHARKPLANE", title: "SHARKPLANE — eat the skies", description, images: [{ url: "/og.png", width: 1200, height: 630, alt: "The shark-mouthed hero plane on the runway" }] },
  twitter: { card: "summary_large_image", title: "SHARKPLANE — eat the skies", description, images: ["/og.png"] },
  other: { "color-scheme": "dark" },
};
export const viewport: Viewport = { themeColor: "#1b2a44", width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover", interactiveWidget: "overlays-content" };

const jsonLd = {
  "@context": "https://schema.org", "@type": "VideoGame", name: "SHARKPLANE", url: site, description,
  genre: ["Arcade", "Flight"], gamePlatform: "Web browser", applicationCategory: "Game", operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, image: `${site}og.png`,
  author: { "@type": "Person", name: "Oddur" }, playMode: "SinglePlayer",
};

// Pages can't set headers, so the CSP rides in a meta tag. Next's own inline runtime needs 'unsafe-inline' for scripts
// in a static export; everything else is same-origin (the font is self-hosted by next/font).
const csp = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' data: blob:", "connect-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        <noscript>
          <div style={{ padding: 40, fontFamily: "Arial, sans-serif", color: "#fff", background: "#1b2a44", minHeight: "100vh" }}>
            <h1>SHARKPLANE</h1>
            <p>This game needs JavaScript and WebGL. Please enable JavaScript and open it in a recent browser.</p>
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}
