import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { localeFromCookieHeader, localizeText } from "./i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const locale = localeFromCookieHeader(requestHeaders.get("cookie")) ?? "en";
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: localizeText(locale, "HEXFALL — Turn-based tactical board battler"),
    description: localizeText(locale, "Build a team, shape its bonds, and command every turn in an original tactical fantasy board battler."),
    applicationName: "HEXFALL",
    openGraph: {
      type: "website",
      title: "HEXFALL",
      description: localizeText(locale, "Build your bond. Break their line."),
      images: [{ url: socialImage, width: 1731, height: 909, alt: localizeText(locale, "HEXFALL tactical arena") }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HEXFALL",
      description: localizeText(locale, "Build your bond. Break their line."),
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#100c18",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = localeFromCookieHeader(requestHeaders.get("cookie")) ?? "en";
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
