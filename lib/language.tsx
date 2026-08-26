"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import nl from "@/locales/nl.json";
import fr from "@/locales/fr.json";
import en from "@/locales/en.json";
import de from "@/locales/de.json";

/**
 * Taalsysteem voor de touchwall.
 * ----------------------------------------------------------------------------
 * Twee soorten vertaalbare content, met elk hun eigen mechanisme:
 *
 * 1. Vaste UI-tekst (knoppen, labels, foutmeldingen, ...) — leeft in
 *    /locales/{taal}.json. Gebruik via `useLanguage().t("sleutel")`.
 *
 * 2. Expeditie-/hotspot-inhoud (titels, beschrijvingen, ...) — leeft in
 *    ExpeditionRoute.tsx zelf, als `LocalizedText`: ofwel een gewone string
 *    (dan geldt die voor alle talen — precies hoe de bestaande data er al
 *    stond, dus niets breekt), ofwel een object met een vertaling per taal
 *    (`{ nl: "...", en: "...", fr: "...", de: "..." }`). Gebruik via
 *    `localize(veld, language)`. Zo kan een tekst geleidelijk, veld voor
 *    veld, vertaald worden zonder de rest van de data te hoeven aanpassen.
 */

export type Language = "nl" | "fr" | "en" | "de";

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: "nl", label: "NL" },
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
  { code: "de", label: "DE" },
];

export const DEFAULT_LANGUAGE: Language = "nl";

type Dictionary = typeof nl;
const DICTIONARIES: Record<Language, Dictionary> = { nl, fr, en, de };

/** Eén stuk expeditie-/hotspot-tekst: óf gewoon een string (geldt voor alle
 *  talen, zoals de bestaande data), óf per taal een eigen vertaling. */
export type LocalizedText = string | Partial<Record<Language, string>>;

/** Lost een LocalizedText op naar de huidige taal, met een duidelijke
 *  terugval-volgorde: gekozen taal → Nederlands → Engels → eerste
 *  beschikbare vertaling. Zo verschijnt er nooit een lege kaart, ook niet
 *  voor velden die nog niet in alle vier de talen zijn ingevuld. */
export function localize(text: LocalizedText, language: Language): string {
  if (typeof text === "string") return text;
  return text[language] ?? text.nl ?? text.en ?? Object.values(text).find(Boolean) ?? "";
}

const STORAGE_KEY = "touchwall-language";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  /** Vertaalt een vaste UI-string aan de hand van zijn sleutel in /locales. */
  t: (key: keyof Dictionary) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  // Onthouden tussen bezoeken/herladen — niet alleen tijdens het navigeren
  // door de expedities binnen dezelfde sessie (dat werkt toch al automatisch
  // via React state), maar ook na het verversen van de pagina.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && LANGUAGES.some((entry) => entry.code === stored)) {
      setLanguageState(stored as Language);
    }
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  const t = useMemo(() => {
    const dictionary = DICTIONARIES[language];
    return (key: keyof Dictionary): string => dictionary[key] ?? DICTIONARIES.nl[key] ?? String(key);
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage moet binnen een <LanguageProvider> gebruikt worden.");
  }
  return context;
}