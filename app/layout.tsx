import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import { LanguageProvider } from "@/lib/language";
import "./globals.css";

/**
 * Typografie voor de touchwall:
 * - Space Grotesk (display) — voor koppen, titels en grote nummers. Een
 *   strakke, geometrische schreefloze font met net genoeg karakter voor een
 *   "maritiem/historisch én futuristisch" museumthema, zonder in de weg te
 *   zitten van de leesbaarheid.
 * - Inter (body) — zeer goed leesbaar op elke schermgrootte, de gangbare
 *   standaard voor interface-tekst; houdt de broodtekst rustig zodat de
 *   display-font de aandacht kan trekken waar het moet.
 *
 * Beide via next/font/google: Next.js host de bestanden zelf (geen los
 * verzoek naar fonts.googleapis.com, geen layout shift/FOUC), en de
 * variabelen hieronder maken de fonts overal in de app bruikbaar via
 * `var(--font-display)` / `var(--font-body)`.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Belgica 1897 — 1899 | Museum Touchwall",
  description:
    "Interactieve 3D-expeditiekaart van de Belgische Antarctica-expedities — Belgica, Koning Boudewijnbasis en Prinses Elisabeth Antarctica.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning op <html> én <body>: browserextensies
    // (Grammarly, wachtwoordmanagers, dark-mode-toggles, ...) injecteren
    // vaak attributen of losse elementen in precies deze twee tags vóórdat
    // React hydrateert. React ziet dan een verschil tussen server- en
    // client-HTML dat niets met onze eigen code te maken heeft, en gooit
    // een "Invalid HTML tag nesting"/hydration-mismatch-fout. Dit is de
    // door Next.js zelf gedocumenteerde, officiële oplossing — het
    // onderdrukt ALLEEN de waarschuwing voor het element zelf (niet voor
    // de children eronder), dus een écht nesting-probleem in onze eigen
    // JSX zou nog steeds gewoon gemeld worden.
    <html lang="nl" className={`${spaceGrotesk.variable} ${inter.variable}`} suppressHydrationWarning>
      <body className="antialiased" style={{ fontFamily: "var(--font-body)" }} suppressHydrationWarning>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}