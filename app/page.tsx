import { headers } from "next/headers";
import { GameClient } from "./game-client";
import { localeFromCookieHeader } from "./i18n";

export default async function Home() {
  const requestHeaders = await headers();
  const locale = localeFromCookieHeader(requestHeaders.get("cookie")) ?? "en";
  return <GameClient initialLocale={locale} />;
}
