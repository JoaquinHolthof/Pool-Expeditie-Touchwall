"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import IceGlobe, { type IceGlobeHandle } from "@/components/IceGlobe";
import { expeditions, type SelectedWaypoint } from "@/components/ExpeditionRoute";
import PhotoGallery from "@/components/PhotoGallery";
import { LANGUAGES, localize, useLanguage } from "@/lib/language";
import {
  DEFAULT_TRANSPORT,
  CUSTOM_ROUTE_START,
  CUSTOM_ROUTE_DESTINATION,
  type CustomRoutePoint,
  type TransportConfig,
  type TransportId,
  type CustomRoutePhase,
} from "@/components/CustomExpedition";

/** Consistente styling-tokens, hergebruikt door elk UI-onderdeel op deze
 *  pagina — dit is dé plek om de designtaal in één keer te verschuiven. */
const displayFont = { fontFamily: "var(--font-display)" };
/** Vast, herbruikbaar knopje voor "sluiten" — zelfde vorm/gedrag overal:
 *  het expeditie-menu, de infokaart, de fotogalerij. */
const closeButtonClass =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-zinc-500 shadow-sm backdrop-blur-sm transition-colors hover:bg-zinc-900 hover:text-white";

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * useLiveWeather
 * ----------------------------------------------------------------------------
 * Haalt de actuele temperatuur/windsnelheid op voor een lat/lon via
 * Open-Meteo (https://open-meteo.com) — een gratis weer-API zonder API-key
 * en met CORS toegestaan voor browser-gebruik, dus geen backend/secret nodig.
 * Antarctische coördinaten worden gewoon ondersteund (het is een wereldwijd
 * weermodel, geen stationsnetwerk).
 *
 * Faalt het ophalen (geen internet, service down, etc.), dan verschijnt er
 * gewoon een rustige "niet beschikbaar"-melding in de infokaart — nooit een
 * kapotte state of crash.
 */
interface LiveWeather {
  temperatureC: number | null;
  windSpeedKmh: number | null;
  status: "loading" | "success" | "error";
}

/** Zet windsnelheid (km/u) om naar de Beaufort-windkrachtschaal (0–12) —
 *  past beter bij het scheepvaart-thema dan een kaal km/u-getal. */
function toBeaufort(kmh: number): number {
  const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
  let force = 0;
  for (const threshold of thresholds) {
    if (kmh >= threshold) force += 1;
    else break;
  }
  return force;
}

function useLiveWeather(lat: number, lon: number): LiveWeather {
  const [state, setState] = useState<LiveWeather>({ temperatureC: null, windSpeedKmh: null, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ temperatureC: null, windSpeedKmh: null, status: "loading" });

    const controller = new AbortController();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m`;

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Weerservice niet bereikbaar");
        return response.json();
      })
      .then((data: { current?: { temperature_2m?: number; wind_speed_10m?: number } }) => {
        if (cancelled) return;
        const temperature = data.current?.temperature_2m;
        const windSpeed = data.current?.wind_speed_10m;
        if (typeof temperature !== "number") throw new Error("Onverwacht antwoord van de weerservice");
        setState({ temperatureC: temperature, windSpeedKmh: windSpeed ?? null, status: "success" });
      })
      .catch(() => {
        if (!cancelled) setState({ temperatureC: null, windSpeedKmh: null, status: "error" });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [lat, lon]);

  return state;
}

/**
 * ExpeditionSwitcher
 * ----------------------------------------------------------------------------
 * Vervangt de statische titel linksboven door een klikbare dropdown waarmee
 * je van expeditie wisselt. De titel zelf krijgt een subtiele stijlwissel
 * (accentkleur + korte fade) die de kleur van de route op de globe volgt —
 * zo voelt de UI-wissel en de 3D-wissel als één samenhangend moment.
 */
function ExpeditionSwitcher({
  activeId,
  onChange,
}: {
  activeId: string;
  onChange: (id: string) => void;
}) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = expeditions.find((expedition) => expedition.id === activeId) ?? expeditions[0];
  const activeLabel = localize(active.label, language);

  // Subtiele stijlwissel voor de titeltekst zelf: bij het switchen faden we
  // kort naar opacity 0, wisselen dan de tekst, en faden weer in. Gebruikt
  // alleen ingebouwde Tailwind-transitieklassen — geen custom keyframes nodig.
  const [displayedLabel, setDisplayedLabel] = useState(activeLabel);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (activeLabel === displayedLabel) return;
    setFading(true);
    const timeout = setTimeout(() => {
      setDisplayedLabel(activeLabel);
      setFading(false);
    }, 220);
    return () => clearTimeout(timeout);
  }, [activeLabel, displayedLabel]);

  // Klik buiten de switcher sluit het menu — normaal dropdown-gedrag.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="group flex items-center gap-3 overflow-hidden rounded-full border border-zinc-300 bg-white pl-1.5 pr-4 py-1.5 shadow-md transition-all hover:border-zinc-400 hover:shadow-lg active:shadow-sm md:pr-5 md:py-2"
      >
        {/* Duidelijke, gevulde kleurcirkel i.p.v. een piepklein accentje —
            direct zichtbaar wélke expeditie actief is, ook van een afstand. */}
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white transition-colors duration-500 md:h-8 md:w-8"
          style={{ backgroundColor: active.accentColor }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9Z" />
          </svg>
        </span>
        <h1
          style={displayFont}
          className={`text-xs font-bold uppercase tracking-[0.15em] text-zinc-900 transition-opacity duration-200 md:text-sm ${
            fading ? "opacity-0" : "opacity-100"
          }`}
        >
          {displayedLabel}
        </h1>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`shrink-0 text-zinc-500 transition-transform duration-300 group-hover:text-zinc-900 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-20 mt-3 w-72 overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-xl"
        >
          {expeditions.map((expedition) => {
            const isActive = expedition.id === activeId;
            return (
              <li key={expedition.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(expedition.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
                    isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/40"
                    style={{ backgroundColor: expedition.accentColor }}
                  />
                  {localize(expedition.label, language)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * LanguageSwitcher
 * ----------------------------------------------------------------------------
 * Vast, subtiel taalkiezertje linksonder: wereldbol-icoon + een strakke rij
 * taalcodes (NL | FR | EN | DE). De actieve taal licht op, de rest blijft
 * bewust subtiel — dezelfde "niet opdringerig, wel duidelijk"-taal als de
 * rest van de UI.
 */
function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Klik buiten de knop klapt 'm weer dicht — zelfde gedrag als het
  // expeditie-menu linksboven.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="pointer-events-auto fixed bottom-6 left-6 z-30 md:bottom-10 md:left-12">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("chooseLanguage")}
        // Zelfde donkere 'floating action button'-taal als de galerijknop
        // rechtsboven (bg-zinc-900, shadow-lg, dezelfde hover/active-animatie)
        // — dichtgeklapt een rond icoontje, opengeklapt een pil met de
        // taalcodes erin.
        className={`flex items-center rounded-full bg-zinc-900 text-white shadow-lg ring-1 ring-black/10 transition-all hover:bg-zinc-800 hover:shadow-xl active:scale-95 ${
          open ? "gap-3 px-4 py-3" : "h-14 w-14 justify-center hover:scale-105"
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 4 6 4 9s-1.5 6.3-4 9c-2.5-2.7-4-6-4-9s1.5-6.3 4-9Z" />
        </svg>

        {open && (
          <div className="flex items-center" role="group">
            {LANGUAGES.map((entry, index) => {
              const isActive = entry.code === language;
              return (
                <span key={entry.code} className="flex items-center">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      setLanguage(entry.code);
                      setOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                        setLanguage(entry.code);
                        setOpen(false);
                      }
                    }}
                    aria-pressed={isActive}
                    style={isActive ? displayFont : undefined}
                    className={`px-1.5 text-xs tracking-wide transition-colors ${
                      isActive ? "font-bold text-white" : "font-medium text-white/40 hover:text-white/70"
                    }`}
                  >
                    {entry.label}
                  </span>
                  {index < LANGUAGES.length - 1 && <span className="text-white/20">|</span>}
                </span>
              );
            })}
          </div>
        )}
      </button>
    </div>
  );
}

/**
 * WaypointPanel
 * ----------------------------------------------------------------------------
 * De infokaart van een geselecteerd waypoint — bewust een GEWOON 2D-DOM-
 * element, volledig BUITEN de <Canvas>/3D-scène (blijft dus altijd op zijn
 * vaste plek, ongeacht hoe er aan de globe gedraaid/gezoomd wordt).
 *
 * Vaste hiërarchie, identiek voor elke expeditie/hotspot:
 *   1. Media (hero-foto) — het visuele anker bovenaan.
 *   2. Expeditie-titel (eyebrow, in de accentkleur van die route).
 *   3. Hoofdonderwerp/nummer — grote, vette stopnummer + de naam van de hotspot.
 *   4. Heldere beschrijving.
 *   5. Data (live temperatuur/windkracht/reisduur + eventuele statistieken).
 */
function WaypointPanel({
  selected,
  onClose,
}: {
  selected: SelectedWaypoint;
  onClose: () => void;
}) {
  const { language, t } = useLanguage();
  const { waypoint, accentColor } = selected;
  const [imageError, setImageError] = useState(false);
  const weather = useLiveWeather(waypoint.lat, waypoint.lon);

  const parentExpedition = useMemo(
    () => expeditions.find((expedition) => expedition.waypoints.some((w) => w.id === waypoint.id)),
    [waypoint.id]
  );
  const stopIndex = parentExpedition
    ? parentExpedition.waypoints.findIndex((w) => w.id === waypoint.id) + 1
    : null;
  const stopCount = parentExpedition?.waypoints.length ?? null;

  return (
    // Vaste plek op het scherm: rechtsonder op grotere schermen, onderin
    // gecentreerd op mobiel (te weinig breedte voor een echt zijpaneel daar).
    <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center p-6 md:items-end md:justify-end md:p-10">
      <div
        className="pointer-events-auto flex max-h-[85vh] w-[min(92vw,400px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-xl backdrop-blur-sm"
        style={{ borderTop: `3px solid ${accentColor}` }}
      >
        {/* 1. Media — het visuele anker */}
        <div className="relative aspect-[16/9] w-full shrink-0 bg-zinc-100">
          {!imageError ? (
            <Image
              src={waypoint.image}
              alt={waypoint.name}
              fill
              sizes="(max-width: 768px) 92vw, 400px"
              className="object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-50 to-zinc-100">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-zinc-300">
                <rect x="3" y="5" width="18" height="14" rx="1.5" />
                <circle cx="9" cy="10.5" r="1.75" />
                <path d="M21 16.5 15.5 11 6 19" />
              </svg>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400">{t("imageComingSoon")}</span>
            </div>
          )}
          <button onClick={onClose} aria-label={t("close")} className={`absolute right-3 top-3 ${closeButtonClass}`}>
            <CloseIcon />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {/* 2. Expeditie-titel (eyebrow) */}
          {parentExpedition && (
            <span
              className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ color: accentColor }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
              {localize(parentExpedition.shortLabel, language)}
            </span>
          )}

          {/* 3. Hoofdonderwerp/nummer */}
          <div className="mb-1 flex items-baseline gap-3">
            {stopIndex !== null && (
              <span style={displayFont} className="text-3xl font-bold tabular-nums text-zinc-900">
                {String(stopIndex).padStart(2, "0")}
                {stopCount !== null && (
                  <span className="text-base font-medium text-zinc-300">/{String(stopCount).padStart(2, "0")}</span>
                )}
              </span>
            )}
            <span className="text-xs uppercase tracking-widest text-zinc-400">{waypoint.dateLabel}</span>
          </div>
          <h3 style={displayFont} className="mb-3 text-2xl font-bold tracking-tight text-zinc-900">
            {waypoint.name}
          </h3>

          {/* 4. Beschrijving */}
          <p className="text-sm leading-relaxed text-zinc-600">{waypoint.description}</p>

          {/* 5. Data — live datasnapshot + optionele statistieken */}
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              {t("datasnapshot")}
            </p>
            <div className="grid grid-cols-3 gap-3">
              {/* Temperatuur */}
              <div className="flex flex-col items-center gap-1 rounded-xl bg-zinc-50 py-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                  <path d="M14 14.76V3.5a2 2 0 0 0-4 0v11.26a4 4 0 1 0 4 0Z" />
                </svg>
                <span style={displayFont} className="text-base font-bold tabular-nums text-zinc-900">
                  {weather.status === "success" ? `${Math.round(weather.temperatureC as number)}°C` : "—"}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-400">{t("temperature")}</span>
              </div>

              {/* Windkracht (Beaufort) */}
              <div className="flex flex-col items-center gap-1 rounded-xl bg-zinc-50 py-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                  <path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5" />
                  <path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5" />
                  <path d="M3 16h9a2.5 2.5 0 1 1-2.5 2.5" />
                </svg>
                <span style={displayFont} className="text-base font-bold tabular-nums text-zinc-900">
                  {weather.status === "success" && weather.windSpeedKmh !== null
                    ? `${toBeaufort(weather.windSpeedKmh)} Bft`
                    : "—"}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-400">{t("windForce")}</span>
              </div>

              {/* Reisduur — vaste data, geen fetch nodig */}
              <div className="flex flex-col items-center gap-1 rounded-xl bg-zinc-50 py-3 text-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-400">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
                <span className="px-1 text-xs font-semibold leading-tight text-zinc-900">
                  {waypoint.travelDuration}
                </span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-400">{t("travelDuration")}</span>
              </div>
            </div>
            {weather.status === "loading" && <p className="mt-2 text-[10px] text-zinc-400">{t("weatherLoading")}</p>}
            {weather.status === "error" && <p className="mt-2 text-[10px] text-zinc-400">{t("weatherError")}</p>}
          </div>

          {/* Optionele extra statistieken per waypoint, indien aanwezig
              in de brondata (zie `stats` op ExpeditionWaypoint). */}
          {waypoint.stats && waypoint.stats.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                {t("statistics")}
              </p>
              <ul className="space-y-1.5">
                {waypoint.stats.map((stat) => (
                  <li key={stat.label} className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-zinc-500">{stat.label}</span>
                    <span style={displayFont} className="font-bold text-zinc-900">
                      {stat.value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ExpeditionBuilder — "Bouw je eigen expeditie"
 * ----------------------------------------------------------------------------
 * Volledig gecontroleerd vanuit <Home>: die houdt de state bij (stap,
 * aangeklikte punten) omdat <IceGlobe> dezelfde state nodig heeft om te
 * weten of het moet luisteren naar tikken op de globe en welke route/welk
 * voertuig het moet tekenen. Dit component is puur de 2D-UI eromheen —
 * dezelfde kaart-stijl (rounded-2xl, backdrop-blur, accentrand, sluitknop)
 * als het bestaande waypoint-infopaneel, zodat het naadloos aansluit.
 *
 * Er is maar één vervoermiddel (het klassieke schip), dus de aparte
 * "kies je vervoer"-stap is bewust weggelaten: openen springt direct naar
 * het plaatsen van punten.
 */
type BuilderStep = "closed" | "picking" | "traveling" | "arrived";

const TRANSPORT_TRANSLATION_KEYS: Record<TransportId, "buildRouteTransportHistoricShip"> = {
  "historic-ship": "buildRouteTransportHistoricShip",
};

/** Subtiele, historisch getinte accentkleur (koper/brons) — geen paars,
 *  wél duidelijk te onderscheiden van de drie vaste expeditiekleuren. Alleen
 *  gebruikt vóór de accentrand/eyebrow/primaire knop in de kaart; de
 *  trigger-knop zelf blijft hetzelfde donkere zwart als de andere twee
 *  FAB's, voor een naadloos consistente designtaal. */
const BUILDER_ACCENT = "#8a6d3b";

function ShipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
      <path d="M3 16.5 4.5 20h15l1.5-3.5" />
      <path d="M5 16.5V9h14v7.5" />
      <path d="M12 9V3.5" />
      <path d="M12 5.5 16 7" />
    </svg>
  );
}

/** Haversine-formule: great-circle-afstand (km) tussen twee coördinaten. */
const EARTH_RADIUS_KM = 6371;
function distanceKm(a: CustomRoutePoint, b: CustomRoutePoint): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function computeRouteReport(clickedPoints: CustomRoutePoint[], transport: TransportConfig) {
  const all = [CUSTOM_ROUTE_START, ...clickedPoints, CUSTOM_ROUTE_DESTINATION];
  let totalKm = 0;
  for (let i = 0; i < all.length - 1; i++) totalKm += distanceKm(all[i], all[i + 1]);
  const days = Math.max(0.5, Math.round((totalKm / transport.speedKmh / 24) * 10) / 10);
  return { totalKm: Math.round(totalKm), days };
}

/** Binnen welke afstand (km) een gepasseerde mijlpaal nog "hetzelfde punt"
 *  telt als een bekende hotspot uit de vaste expedities. Groter dan dit —
 *  dan is het gewoon een eigen, onbekend punt op open zee. */
const MILESTONE_MATCH_RADIUS_KM = 400;

interface KnownLocation {
  name: string;
  description: string;
  image: string;
  dateLabel: string;
}

/** Zoekt de dichtstbijzijnde hotspot uit ÁLLE vaste expedities (Belgica,
 *  Koning Boudewijnbasis, Prinses Elisabeth) bij een gepasseerd punt. Zo
 *  krijgt de bezoeker soms een verrassing: tik je toevallig in de buurt van
 *  een echte historische locatie, dan verschijnt de échte info + foto i.p.v.
 *  een generieke "onbekende locatie"-kaart. */
function findNearestKnownLocation(point: CustomRoutePoint): KnownLocation | null {
  let best: { distance: number; waypoint: (typeof expeditions)[number]["waypoints"][number] } | null = null;
  for (const expedition of expeditions) {
    for (const waypoint of expedition.waypoints) {
      const distance = distanceKm(point, { lat: waypoint.lat, lon: waypoint.lon });
      if (!best || distance < best.distance) best = { distance, waypoint };
    }
  }
  if (!best || best.distance > MILESTONE_MATCH_RADIUS_KM) return null;
  return {
    name: best.waypoint.name,
    description: best.waypoint.description,
    image: best.waypoint.image,
    dateLabel: best.waypoint.dateLabel,
  };
}

interface MilestonePopupData {
  id: number;
  name: string | null;
  description: string | null;
  image: string | null;
  dateLabel: string | null;
  point: CustomRoutePoint;
}

/**
 * MilestonePopup — "Je vaart nu langs..."
 * ----------------------------------------------------------------------------
 * Verschijnt automatisch, bovenaan gecentreerd (de enige hoek die nog vrij
 * is — links/rechts-boven en beide onderhoeken zijn al in gebruik door de
 * andere vaste UI-elementen), zodra het zelfgekozen voertuig een mijlpaal
 * van de route passeert. Sluit vanzelf na een paar seconden, of meteen via
 * het kruisje. Zelfde kaart-taal (rounded-2xl, accentrand, displayFont) als
 * de rest van de app.
 */
function MilestonePopup({ data, onClose }: { data: MilestonePopupData; onClose: () => void }) {
  const { t } = useLanguage();
  const [imageError, setImageError] = useState(false);
  const title = data.name ?? t("buildRouteUnknownLocation");

  return (
    <div className="pointer-events-none fixed inset-x-0 top-6 z-40 flex justify-center md:top-10">
      <div
        className="pointer-events-auto flex w-[min(92vw,380px)] items-center gap-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm"
        style={{ borderLeft: `3px solid ${BUILDER_ACCENT}` }}
      >
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
          {data.image && !imageError ? (
            <Image
              src={data.image}
              alt={title}
              fill
              sizes="80px"
              className="object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-zinc-300">
                <rect x="3" y="5" width="18" height="14" rx="1.5" />
                <circle cx="9" cy="10.5" r="1.75" />
                <path d="M21 16.5 15.5 11 6 19" />
              </svg>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ color: BUILDER_ACCENT }}>
            {t("buildRoutePassingBy")}
          </p>
          <h4 style={displayFont} className="truncate text-sm font-bold tracking-tight text-zinc-900">
            {title}
          </h4>
          {data.description && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">{data.description}</p>
          )}
        </div>

        <button onClick={onClose} aria-label={t("close")} className={`h-7 w-7 shrink-0 ${closeButtonClass}`}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function ExpeditionBuilderPanel({
  step,
  transport,
  points,
  onOpen,
  onStart,
  onExit,
  showLandWarning,
}: {
  step: BuilderStep;
  transport: TransportConfig | null;
  points: CustomRoutePoint[];
  onOpen: () => void;
  onStart: () => void;
  /** Eén en dezelfde "sluiten/terug"-actie voor élke stap — duidelijk
   *  zichtbaar, altijd op dezelfde plek, ongeacht waar de bezoeker in de
   *  flow zit. Reset ook meteen de globe naar de standaardweergave. */
  onExit: () => void;
  /** Kort `true` na een geweigerde tik op land — de helpertekst toont dan
   *  tijdelijk de waarschuwing i.p.v. de normale voortgangstekst. */
  showLandWarning: boolean;
}) {
  const { t } = useLanguage();
  const [imageError, setImageError] = useState(false);

  // Een sprekende, echte archieffoto bij het rapport — de bestemming valt
  // samen met de coördinaten van de Bellingshausenzee-hotspot, dus die
  // hergebruiken we i.p.v. een los, hardcoded pad te verzinnen.
  const reportImage = useMemo(
    () =>
      expeditions
        .find((expedition) => expedition.id === "belgica")
        ?.waypoints.find((waypoint) => waypoint.id === "bellingshausen")?.image ?? null,
    []
  );

  if (step === "closed") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("buildRoute")}
        // Exact dezelfde donkere 'floating action button'-taal als de
        // fotogalerij- en taalknop — alleen het icoon en de positie maken
        // 'm uniek, geen aparte kleur.
        className="pointer-events-auto fixed bottom-6 right-6 z-30 flex h-14 items-center gap-2.5 rounded-full bg-zinc-900 px-5 text-white shadow-lg ring-1 ring-black/10 transition-all hover:scale-105 hover:bg-zinc-800 hover:shadow-xl active:scale-95 md:bottom-10 md:right-12"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 21c4-4 7-7.58 7-11a7 7 0 1 0-14 0c0 3.42 3 7 7 11Z" />
          <circle cx="12" cy="10" r="2.4" />
        </svg>
        <span style={displayFont} className="text-xs font-bold uppercase tracking-wider">
          {t("buildRoute")}
        </span>
      </button>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center p-6 md:items-start md:justify-end md:p-10">
      {/* Stap: punten op de globe tikken — compact en half-transparant, met
          opzet klein gehouden en in een hoek geplaatst zodat de bezoeker
          overal op de globe kan blijven tikken zonder dat dit paneel in de
          weg zit. */}
      {step === "picking" && (
        <div
          className="pointer-events-auto w-[min(88vw,300px)] overflow-hidden rounded-2xl border border-zinc-200 bg-white/85 shadow-lg backdrop-blur-md"
          style={{ borderTop: `3px solid ${BUILDER_ACCENT}` }}
        >
          <div className="p-4 text-center">
            <div className="mb-3 flex items-center justify-between text-left">
              <span
                className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em]"
                style={{ color: BUILDER_ACCENT }}
              >
                <ShipIcon />
                {t("buildRoute")}
              </span>
              <button onClick={onExit} aria-label={t("close")} className={`h-7 w-7 ${closeButtonClass}`}>
                <CloseIcon />
              </button>
            </div>
            <h3 style={displayFont} className="mb-2 text-sm font-bold tracking-tight text-zinc-900">
              {t("buildRouteStepPoints")}
            </h3>
            <div style={displayFont} className="mb-1 text-2xl font-bold tabular-nums text-zinc-900">
              {points.length}
              <span className="text-sm font-medium text-zinc-300">/3</span>
            </div>
            <p
              className={`mb-3 text-[11px] ${showLandWarning ? "font-semibold" : "text-zinc-500"}`}
              style={showLandWarning ? { color: "#c0483f" } : undefined}
            >
              {showLandWarning
                ? t("buildRouteLandRejected")
                : points.length < 2
                  ? t("buildRouteAddMore", { n: 2 - points.length })
                  : t("buildRouteReadyToStart")}
            </p>
            <button
              type="button"
              onClick={onStart}
              disabled={points.length < 2}
              className="w-full rounded-full py-2 text-[11px] font-bold uppercase tracking-wider text-white transition-colors disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
              style={points.length >= 2 ? { backgroundColor: BUILDER_ACCENT } : undefined}
            >
              {t("buildRouteStart")}
            </button>
          </div>
        </div>
      )}

      {/* Stap: onderweg — nog compacter, gewoon een smalle statusstrook, zodat
          het uitzicht op de varende boot en de globe eromheen vrij blijft. */}
      {step === "traveling" && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-zinc-200 bg-white/80 py-2 pl-4 pr-2 shadow-lg backdrop-blur-md">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ backgroundColor: BUILDER_ACCENT }} />
          <p style={displayFont} className="text-xs font-bold text-zinc-900">
            {t("buildRouteTraveling")}
          </p>
          <button onClick={onExit} aria-label={t("close")} className={`h-7 w-7 ${closeButtonClass}`}>
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Stap: expeditierapport bij aankomst — dit mag wél de volledige,
          rijkere kaart zijn: de boot is aangekomen, er hoeft niets meer
          getikt te worden op de globe. */}
      {step === "arrived" && transport && (
        <div
          className="pointer-events-auto flex max-h-[85vh] w-[min(92vw,420px)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-xl backdrop-blur-sm"
          style={{ borderTop: `3px solid ${BUILDER_ACCENT}` }}
        >
          <div className="relative aspect-[16/9] w-full shrink-0 bg-zinc-100">
            {reportImage && !imageError ? (
              <Image
                src={reportImage}
                alt={t("buildRouteArrivedTitle")}
                fill
                sizes="(max-width: 768px) 92vw, 420px"
                className="object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-50 to-zinc-100">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-zinc-300">
                  <rect x="3" y="5" width="18" height="14" rx="1.5" />
                  <circle cx="9" cy="10.5" r="1.75" />
                  <path d="M21 16.5 15.5 11 6 19" />
                </svg>
                <span className="text-[10px] uppercase tracking-widest text-zinc-400">{t("imageComingSoon")}</span>
              </div>
            )}
            <button onClick={onExit} aria-label={t("close")} className={`absolute right-3 top-3 ${closeButtonClass}`}>
              <CloseIcon />
            </button>
          </div>

          <div className="overflow-y-auto p-6">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: BUILDER_ACCENT }}>
              {t("buildRouteReportTitle")}
            </p>
            <h3 style={displayFont} className="mb-4 text-xl font-bold tracking-tight text-zinc-900">
              {t("buildRouteArrivedTitle")}
            </h3>

            {(() => {
              const report = computeRouteReport(points, transport);
              return (
                <ul className="mb-5 space-y-2 text-sm">
                  <li className="flex items-baseline justify-between gap-4">
                    <span className="text-zinc-500">{t("buildRouteReportTransport")}</span>
                    <span className="font-semibold text-zinc-900">{t(TRANSPORT_TRANSLATION_KEYS[transport.id])}</span>
                  </li>
                  <li className="flex items-baseline justify-between gap-4">
                    <span className="text-zinc-500">{t("buildRouteReportRoute")}</span>
                    <span className="font-semibold text-zinc-900">
                      {points.length} {t("buildRoutePointsCounter")}
                    </span>
                  </li>
                  <li className="flex items-baseline justify-between gap-4">
                    <span className="text-zinc-500">{t("buildRouteReportDistance")}</span>
                    <span style={displayFont} className="font-bold tabular-nums text-zinc-900">
                      {report.totalKm.toLocaleString()} {t("buildRouteReportKm")}
                    </span>
                  </li>
                  <li className="flex items-baseline justify-between gap-4">
                    <span className="text-zinc-500">{t("buildRouteReportDuration")}</span>
                    <span style={displayFont} className="font-bold tabular-nums text-zinc-900">
                      {report.days} {t("buildRouteReportDays")}
                    </span>
                  </li>
                </ul>
              );
            })()}

            <button
              type="button"
              onClick={onExit}
              className="w-full rounded-full py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors"
              style={{ backgroundColor: BUILDER_ACCENT }}
            >
              {t("buildRouteNewJourney")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { t } = useLanguage();
  const [activeExpeditionId, setActiveExpeditionId] = useState(expeditions[0].id);
  const [selectedWaypoint, setSelectedWaypoint] = useState<SelectedWaypoint | null>(null);
  const iceGlobeRef = useRef<IceGlobeHandle>(null);

  // "Bouw je eigen expeditie" — deze state leeft hier (i.p.v. in het
  // ExpeditionBuilderPanel zelf) omdat <IceGlobe> hem net zo goed nodig
  // heeft: pickingActive/onGlobePick voor het tikken op de bol, en
  // customRoute voor het tekenen van de route + het reizende voertuig.
  const [builderStep, setBuilderStep] = useState<BuilderStep>("closed");
  const [builderTransport, setBuilderTransport] = useState<TransportConfig | null>(null);
  const [builderPoints, setBuilderPoints] = useState<CustomRoutePoint[]>([]);
  const [resettingCamera, setResettingCamera] = useState(false);
  // Land-klik-feedback: korte visuele flits op de globe (in IceGlobe) +
  // korte tekstmelding hier in het paneel.
  const [invalidClickPoint, setInvalidClickPoint] = useState<{ lat: number; lon: number; nonce: number } | null>(
    null
  );
  const [showLandWarning, setShowLandWarning] = useState(false);
  const landWarningTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  // "Je vaart nu langs..."-pop-up, getoond zodra het voertuig een mijlpaal
  // van de eigen route passeert.
  const [milestonePopup, setMilestonePopup] = useState<MilestonePopupData | null>(null);
  const milestonePopupTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const handleClosePanel = () => {
    // Roept de 3D-kant aan om de selectie te resetten (camera vliegt terug,
    // marker-pulse stopt). De state hier (`selectedWaypoint`) volgt vanzelf
    // via `onActiveWaypointChange`, dus die hoeft hier niet apart genuld.
    iceGlobeRef.current?.closeWaypoint();
  };

  const handleOpenBuilder = () => {
    setBuilderTransport(DEFAULT_TRANSPORT);
    setBuilderPoints([]);
    setBuilderStep("picking");
  };

  const handleGlobePick = (lat: number, lon: number, isOcean: boolean) => {
    if (builderStep !== "picking") return;

    if (!isOcean) {
      // Geweigerd: geen punt toevoegen, wel meteen zichtbare feedback —
      // een korte rode flits op de globe zelf (IceGlobe) én een korte
      // tekstmelding in dit paneel.
      setInvalidClickPoint({ lat, lon, nonce: Date.now() });
      setShowLandWarning(true);
      if (landWarningTimeoutRef.current) window.clearTimeout(landWarningTimeoutRef.current);
      landWarningTimeoutRef.current = window.setTimeout(() => setShowLandWarning(false), 2200);
      return;
    }

    setBuilderPoints((current) => (current.length >= 3 ? current : [...current, { lat, lon }]));
  };

  const handleStartExpedition = () => {
    if (builderPoints.length < 2) return;
    setBuilderStep("traveling");
  };

  const handleCustomArrive = () => {
    setBuilderStep("arrived");
  };

  // Zodra het schip een mijlpaal passeert (start, een aangeklikt punt, of de
  // bestemming): zoek de dichtstbijzijnde bekende locatie uit de vaste
  // expedities (binnen een redelijke straal) en toon daarvan info + foto.
  // Geen match binnen bereik? Dan gewoon een nette "onbekende locatie"-kaart
  // met de coördinaten — de pop-up verschijnt hoe dan ook.
  const handlePassMilestone = (index: number) => {
    const allPoints = [CUSTOM_ROUTE_START, ...builderPoints, CUSTOM_ROUTE_DESTINATION];
    const point = allPoints[index];
    if (!point) return;

    const known = findNearestKnownLocation(point);
    if (milestonePopupTimeoutRef.current) window.clearTimeout(milestonePopupTimeoutRef.current);
    setMilestonePopup({
      id: Date.now(),
      name: known?.name ?? null,
      description: known?.description ?? null,
      image: known?.image ?? null,
      dateLabel: known?.dateLabel ?? null,
      point,
    });
    milestonePopupTimeoutRef.current = window.setTimeout(() => setMilestonePopup(null), 6000);
  };

  // Eén en dezelfde "sluiten/terug"-knop voor élke stap. Was er nog een
  // route/voertuig zichtbaar (traveling/arrived), dan laten we de camera
  // eerst nog netjes terugvliegen naar de standaard-overview (dezelfde
  // CameraRig als overal elders, via de "resetting"-fase) vóórdat de route
  // zelf pas echt verdwijnt — zo staat de globe altijd weer "schoon" klaar
  // voor de volgende bezoeker, in plaats van abrupt te knippen.
  const handleExitBuilder = () => {
    const hadActiveRoute = builderStep === "traveling" || builderStep === "arrived";
    setBuilderStep("closed");
    setBuilderPoints([]);
    setMilestonePopup(null);
    if (milestonePopupTimeoutRef.current) window.clearTimeout(milestonePopupTimeoutRef.current);

    if (hadActiveRoute) {
      setResettingCamera(true);
      window.setTimeout(() => {
        setResettingCamera(false);
        setBuilderTransport(null);
      }, 1300);
    } else {
      setBuilderTransport(null);
    }
  };

  const customRoutePhase: CustomRoutePhase | null = resettingCamera
    ? "resetting"
    : builderStep === "traveling"
      ? "traveling"
      : builderStep === "arrived"
        ? "arrived"
        : null;

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-[#F8F9FA] text-zinc-900">
      {/*
        Volledig schermvullende 3D-globe — geen begrenzende div, geen aspect-
        ratio-doos, dus geen kader dat kan afsnijden zodra de camera inzoomt
        op een waypoint. `fixed inset-0` legt 'm als vaste achtergrondlaag
        onder de UI. `activeExpeditionId` bepaalt welke route/hotspots er op
        de globe verschijnen (met een zachte fade-transitie, zie
        ExpeditionRoute.tsx). `onActiveWaypointChange` geeft alleen de
        SELECTIE door — het infopaneel zelf leeft hieronder, als gewoon
        DOM-element, dus die kan nooit meer meebewegen met de 3D-camera.

        `pickingActive`/`onGlobePick`/`customRoute`/`onCustomArrive` horen
        bij "Bouw je eigen expeditie": zolang `builderStep === "picking"`
        luistert de globe naar tikken (die een lat/lon teruggeven), en zodra
        er een `customRoutePhase` is tekent IceGlobe de eigen route + het
        gekozen voertuig erbovenop.
      */}
      <div className="fixed inset-0 z-0" style={{ touchAction: "none" }}>
        <IceGlobe
          ref={iceGlobeRef}
          className="h-full w-full"
          activeExpeditionId={activeExpeditionId}
          onActiveWaypointChange={setSelectedWaypoint}
          pickingActive={builderStep === "picking"}
          onGlobePick={handleGlobePick}
          previewPoints={builderPoints}
          invalidClickPoint={invalidClickPoint}
          customRoute={
            customRoutePhase && builderTransport
              ? { clickedPoints: builderPoints, transport: builderTransport, phase: customRoutePhase }
              : null
          }
          onCustomArrive={handleCustomArrive}
          onPassMilestone={handlePassMilestone}
        />
      </div>

      {/*
        UI-laag bovenop: de hele laag is 'pointer-events-none' zodat je er
        dwars doorheen naar de globe kan klikken/slepen om te draaien, een
        waypoint te selecteren, of (tijdens het bouwen van een eigen
        expeditie) een punt te plaatsen. Alleen losse elementen die zelf
        interactie nodig hebben krijgen expliciet 'pointer-events-auto' terug.
      */}
      <div className="pointer-events-none fixed inset-0 z-10 flex flex-col p-6 md:p-12">
        {/* Header */}
        <header className="flex w-full items-center justify-between border-b border-zinc-200/60 pb-6">
          <ExpeditionSwitcher activeId={activeExpeditionId} onChange={setActiveExpeditionId} />
        </header>

        {/* Instructie-label, direct onder de header — bewust hoog gehouden
            i.p.v. verder naar beneden gedreven, zodat het overzicht van de
            globe eronder vrij blijft. Tijdens het plaatsen van eigen punten
            vervangen we 'm door de bijpassende instructie. */}
        <div className="mt-4 flex flex-col items-center text-center md:mt-6">
          <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-400 md:text-xs">
            {builderStep === "picking" ? t("buildRouteStepPoints") : t("instructionLabel")}
          </span>
        </div>
      </div>

      {/*
        Infokaart: een volledig vast 2D-overlay-element, hierboven
        gedefinieerd als <WaypointPanel>. Zit BUITEN de <Canvas>, dus dit kan
        principieel nooit meer meebewegen met de 3D-camera — ongeacht hoe de
        bezoeker aan de globe draait of inzoomt.
      */}
      {selectedWaypoint && <WaypointPanel selected={selectedWaypoint} onClose={handleClosePanel} />}

      {/* Fotogalerij: rendert zelf zowel het trigger-icoontje (rechtsboven)
          als de volledige modal — verder is hier niets voor nodig. */}
      <PhotoGallery />

      {/* Taalkiezer: vast, linksonder. */}
      <LanguageSwitcher />

      {/* "Bouw je eigen expeditie": trigger-knop rechtsonder (naast de
          taalkiezer), die openklapt naar de stapsgewijze flow. */}
      <ExpeditionBuilderPanel
        step={builderStep}
        transport={builderTransport}
        points={builderPoints}
        onOpen={handleOpenBuilder}
        onStart={handleStartExpedition}
        onExit={handleExitBuilder}
        showLandWarning={showLandWarning}
      />

      {/* "Je vaart nu langs..."-pop-up — verschijnt automatisch zodra het
          zelfgekozen voertuig een mijlpaal van de eigen route passeert. */}
      {milestonePopup && (
        <MilestonePopup key={milestonePopup.id} data={milestonePopup} onClose={() => setMilestonePopup(null)} />
      )}
    </main>
  );
}