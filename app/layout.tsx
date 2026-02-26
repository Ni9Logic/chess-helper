import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const title = "Chess Helper | Play, train, and analyze with Stockfish Lite";
const description =
  "Practice chess tactics, see best and blunder lines, and auto-analyze every move with Stockfish 18 Lite in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Chess Helper",
  title: {
    default: title,
    template: "%s | Chess Helper",
  },
  description,
  keywords: [
    "chess",
    "stockfish",
    "chess training",
    "blunder checker",
    "chess analysis",
    "openings",
    "tactics",
    "chess board"
  ],
  authors: [{ name: "Chess Helper" }],
  creator: "Chess Helper",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Chess Helper",
    images: [
      {
        url: "/white-queen.svg",
        width: 512,
        height: 512,
        alt: "Chess Helper board and analysis preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/white-queen.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  category: "games",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Chess Helper",
    applicationCategory: "Game",
    operatingSystem: "Web",
    url: siteUrl,
    description,
  };

  return (
    <html lang="en">
      <head>
        <link rel="canonical" href={siteUrl} />
        <meta
          name="google-site-verification"
          content="7Po8_KzQ4P4zZkc4H_CHP3PdGAxpwLemLIuDcM7Vz7A"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
