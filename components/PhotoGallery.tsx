"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { expeditions, type PhotoCategory } from "./ExpeditionRoute";
import { localize, useLanguage, type Language } from "@/lib/language";

/**
 * PhotoGallery
 * ----------------------------------------------------------------------------
 * Zelfstandig, puur 2D/DOM-component (geen Three.js) voor het overzicht van
 * al het beeldmateriaal uit alle expedities. Rendert zelf zowel het trigger-
 * icoontje als de volledige galerij-modal — dus simpelweg één keer
 * <PhotoGallery /> in page.tsx neerzetten volstaat.
 *
 * Databron: dezelfde `expeditions`-array uit ExpeditionRoute.tsx, uit TWEE
 * plekken samengevoegd — geen aparte, los bij te houden datalijst:
 *   1. Eén hero-foto per hotspot/waypoint (`waypoint.image`).
 *   2. Losse archieffoto's per expeditie (`expedition.photos`) — bemannings-
 *      portretten, scheepsdetails, memorabilia, niet aan één hotspot gebonden.
 * Nieuwe foto's toevoegen? Gewoon een object toevoegen aan `photos` bij de
 * betreffende expeditie in ExpeditionRoute.tsx — deze galerij pikt dat
 * automatisch op, zonder hier iets te hoeven aanpassen.
 *
 * Taal: alle vaste UI-tekst loopt via `useLanguage().t(...)`; de expeditie-
 * titels via `localize(expedition.label/shortLabel, language)`. Zie
 * lib/language.tsx voor hoe dat systeem werkt.
 *
 * Designtaal: dezelfde tokens als page.tsx (rounded-2xl/rounded-full,
 * dezelfde sluitknop-vorm, dezelfde display-font voor koppen/nummers) —
 * zodat de galerij aanvoelt als onderdeel van dezelfde applicatie, niet als
 * een los scherm.
 */

const displayFont = { fontFamily: "var(--font-display)" };
const closeButtonClass =
  "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg ring-1 ring-black/10 transition-all hover:scale-105 hover:bg-white hover:text-zinc-900 hover:shadow-xl active:scale-95";

/** Welke vertaalsleutel (uit /locales/{taal}.json) bij elke fotocategorie
 *  hoort — zo staan de categorienamen niet dubbel opgeslagen (eenmaal in
 *  ExpeditionRoute.tsx, eenmaal in de vertaalbestanden), maar leven ze
 *  gewoon samen met de rest van de UI-taal. */
const CATEGORY_TRANSLATION_KEYS: Record<PhotoCategory, "categoryVertrek" | "categoryIjs" | "categoryBasis" | "categoryVoorbereiding" | "categoryBemanning" | "categoryArchief"> = {
  vertrek: "categoryVertrek",
  ijs: "categoryIjs",
  basis: "categoryBasis",
  voorbereiding: "categoryVoorbereiding",
  bemanning: "categoryBemanning",
  archief: "categoryArchief",
};

function CloseIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

interface GalleryPhoto {
  id: string;
  src: string;
  title: string;
  /** Ontbreekt bij losse archieffoto's (die hebben geen vaste "datum-stop"). */
  dateLabel?: string;
  /** Volledige hotspot-beschrijving óf het korte `caption`-veld van een
   *  archieffoto — ontbreekt als er geen van beide is ingevuld. */
  description?: string;
  category: PhotoCategory;
  expeditionId: string;
  expeditionLabel: string;
  accentColor: string;
}

/** Bouwt de galerij-fotolijst op, met de expeditietitels al opgelost naar de
 *  huidige taal — herberekent dus mee zodra `language` wijzigt. */
function useGalleryPhotos(language: Language): GalleryPhoto[] {
  return useMemo(
    () =>
      expeditions.flatMap((expedition) => {
        const expeditionLabel = localize(expedition.label, language);

        const hotspotPhotos: GalleryPhoto[] = expedition.waypoints.map((waypoint) => ({
          id: `${expedition.id}-${waypoint.id}`,
          src: waypoint.image,
          title: waypoint.name,
          dateLabel: waypoint.dateLabel,
          description: waypoint.description,
          category: waypoint.category,
          expeditionId: expedition.id,
          expeditionLabel,
          accentColor: expedition.accentColor,
        }));

        const archivePhotos: GalleryPhoto[] = (expedition.photos ?? []).map((photo) => ({
          id: `${expedition.id}-${photo.id}`,
          src: photo.src,
          title: photo.title,
          description: photo.caption,
          category: photo.category,
          expeditionId: expedition.id,
          expeditionLabel,
          accentColor: expedition.accentColor,
        }));

        return [...hotspotPhotos, ...archivePhotos];
      }),
    [language]
  );
}

type SortMode = "chronologisch" | "alfabetisch";

/** Eén thumbnail in de galerij-grid, met dezelfde nette lege-state als het
 * waypoint-infopaneel wanneer een foto nog ontbreekt. */
function GalleryThumbnail({ photo, onOpen }: { photo: GalleryPhoto; onOpen: () => void }) {
  const { t } = useLanguage();
  const [imageError, setImageError] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-zinc-100 text-left shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md"
    >
      {!imageError ? (
        <Image
          src={photo.src}
          alt={photo.title}
          fill
          sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-zinc-50 to-zinc-100">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-zinc-300">
            <rect x="3" y="5" width="18" height="14" rx="1.5" />
            <circle cx="9" cy="10.5" r="1.75" />
            <path d="M21 16.5 15.5 11 6 19" />
          </svg>
          <span className="text-center text-[9px] uppercase tracking-widest text-zinc-400">
            {t("galleryThumbnailPending")}
          </span>
        </div>
      )}

      {/* Zachte gradient + bijschrift onderin — leesbaar ongeacht de foto */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 via-black/15 to-transparent p-3 pt-8">
        <span
          className="mb-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
          style={{ backgroundColor: photo.accentColor }}
        />
        <p className="truncate text-xs font-semibold text-white">{photo.title}</p>
        {photo.dateLabel && (
          <p className="truncate text-[10px] uppercase tracking-wider text-white/70">{photo.dateLabel}</p>
        )}
      </div>
    </button>
  );
}

/** Grote weergave van één foto, met vorige/volgende — bedienbaar via knoppen
 * én via swipe (pointer-events, werkt op touch én muis). */
function Lightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: GalleryPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const photo = photos[index];
  const [imageError, setImageError] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);

  useEffect(() => setImageError(false), [photo?.id]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onIndexChange(Math.min(index + 1, photos.length - 1));
      if (event.key === "ArrowLeft") onIndexChange(Math.max(index - 1, 0));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, photos.length, onIndexChange, onClose]);

  if (!photo) return null;

  const goPrev = () => onIndexChange(Math.max(index - 1, 0));
  const goNext = () => onIndexChange(Math.min(index + 1, photos.length - 1));

  const handlePointerUp = (event: React.PointerEvent) => {
    if (dragStartX === null) return;
    const delta = event.clientX - dragStartX;
    // Duidelijke swipe (>50px) — touch-vriendelijk, geen precisie nodig
    if (delta > 50) goPrev();
    else if (delta < -50) goNext();
    setDragStartX(null);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-white/98 backdrop-blur-sm"
      onPointerDown={(event) => setDragStartX(event.clientX)}
      onPointerUp={handlePointerUp}
    >
      <div className="flex items-center justify-between px-6 py-5 md:px-10">
        <span style={displayFont} className="text-sm font-bold tabular-nums text-zinc-900">
          {index + 1} <span className="font-medium text-zinc-300">/ {photos.length}</span>
        </span>
        <button onClick={onClose} aria-label={t("close")} className={closeButtonClass}>
          <CloseIcon />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-4 pb-6 md:px-16">
        <button
          onClick={goPrev}
          disabled={index === 0}
          aria-label={t("previousPhoto")}
          className="absolute left-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-zinc-600 shadow-md transition-all hover:bg-zinc-900 hover:text-white disabled:pointer-events-none disabled:opacity-0 md:left-6"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <div className="relative aspect-[4/3] w-full max-w-3xl overflow-hidden rounded-2xl bg-zinc-100 shadow-lg">
          {!imageError ? (
            <Image
              src={photo.src}
              alt={photo.title}
              fill
              sizes="(max-width: 768px) 92vw, 768px"
              className="object-cover"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-zinc-50 to-zinc-100">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-zinc-300">
                <rect x="3" y="5" width="18" height="14" rx="1.5" />
                <circle cx="9" cy="10.5" r="1.75" />
                <path d="M21 16.5 15.5 11 6 19" />
              </svg>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400">{t("imageComingSoon")}</span>
            </div>
          )}
        </div>

        <button
          onClick={goNext}
          disabled={index === photos.length - 1}
          aria-label={t("nextPhoto")}
          className="absolute right-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-zinc-600 shadow-md transition-all hover:bg-zinc-900 hover:text-white disabled:pointer-events-none disabled:opacity-0 md:right-6"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="mx-auto w-full max-w-3xl px-6 pb-8 text-center md:px-16">
        <div
          className="mb-2 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest"
          style={{ color: photo.accentColor }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: photo.accentColor }} />
          {photo.dateLabel ? `${photo.expeditionLabel} · ${photo.dateLabel}` : photo.expeditionLabel}
        </div>
        <h3 style={displayFont} className="mb-2 text-xl font-bold tracking-tight text-zinc-900">
          {photo.title}
        </h3>
        {photo.description && <p className="text-sm leading-relaxed text-zinc-600">{photo.description}</p>}
      </div>
    </div>
  );
}

/** Klein, minimalistisch trigger-icoontje (rasterpictogram) — past bij de
 * rest van de rustige, lijnenrijke UI. */
function GalleryTriggerIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="7" height="7" rx="0.5" />
      <rect x="14" y="3" width="7" height="7" rx="0.5" />
      <rect x="3" y="14" width="7" height="7" rx="0.5" />
      <rect x="14" y="14" width="7" height="7" rx="0.5" />
    </svg>
  );
}

export default function PhotoGallery() {
  const { language, t } = useLanguage();
  const photos = useGalleryPhotos(language);
  const [open, setOpen] = useState(false);
  const [expeditionFilter, setExpeditionFilter] = useState<string>("alle");
  const [categoryFilter, setCategoryFilter] = useState<PhotoCategory | "alle">("alle");
  const [sortMode, setSortMode] = useState<SortMode>("chronologisch");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Categorieën die ook echt voorkomen in de data — geen lege filterknoppen.
  const availableCategories = useMemo(
    () => Array.from(new Set(photos.map((photo) => photo.category))) as PhotoCategory[],
    [photos]
  );

  const filteredPhotos = useMemo(() => {
    let result = photos;
    if (expeditionFilter !== "alle") {
      result = result.filter((photo) => photo.expeditionId === expeditionFilter);
    }
    if (categoryFilter !== "alle") {
      result = result.filter((photo) => photo.category === categoryFilter);
    }
    if (sortMode === "alfabetisch") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title, language));
    }
    // "chronologisch" = volgorde van de route zelf (al chronologisch per
    // expeditie, en expedities staan al chronologisch achter elkaar in de
    // brondata) — dus geen extra sortering nodig, alleen bij "alfabetisch".
    return result;
  }, [photos, expeditionFilter, categoryFilter, sortMode, language]);

  // Filters wijzigen → lightbox-index kan ongeldig worden, dus sluiten.
  useEffect(() => {
    setLightboxIndex(null);
  }, [expeditionFilter, categoryFilter, sortMode]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && lightboxIndex === null) setOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, lightboxIndex]);

  return (
    <>
      {/* Trigger — solide 'floating action button': donker vlak + duidelijke
          schaduw, zodat dit altijd afsteekt tegen de witte/lichte globe,
          ongeacht hoe die op dat moment gedraaid staat. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("openGallery")}
        className="pointer-events-auto fixed right-6 top-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg ring-1 ring-black/10 transition-all hover:scale-105 hover:bg-zinc-800 hover:shadow-xl active:scale-95 md:right-12 md:top-12"
      >
        <GalleryTriggerIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#F8F9FA]">
          {/* Header met titel + sluiten */}
          <div className="flex items-center justify-between border-b border-zinc-200/60 px-6 py-5 md:px-12">
            <h2 style={displayFont} className="text-base font-bold uppercase tracking-[0.1em] text-zinc-900 md:text-lg">
              {t("galleryTitle")} <span className="text-zinc-400">{t("galleryTitleSuffix")}</span>
            </h2>
            <button onClick={() => setOpen(false)} aria-label={t("close")} className={closeButtonClass}>
              <CloseIcon />
            </button>
          </div>

          {/* Filter- en sorteerbalk — chips, groot genoeg om aan te tikken */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-zinc-200/60 px-6 py-4 md:px-12">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                {t("galleryFilterExpedition")}
              </span>
              <FilterChip active={expeditionFilter === "alle"} onClick={() => setExpeditionFilter("alle")}>
                {t("galleryFilterAll")}
              </FilterChip>
              {expeditions.map((expedition) => (
                <FilterChip
                  key={expedition.id}
                  active={expeditionFilter === expedition.id}
                  onClick={() => setExpeditionFilter(expedition.id)}
                  dotColor={expedition.accentColor}
                >
                  {localize(expedition.shortLabel, language)}
                </FilterChip>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                {t("galleryFilterCategory")}
              </span>
              <FilterChip active={categoryFilter === "alle"} onClick={() => setCategoryFilter("alle")}>
                {t("galleryFilterAll")}
              </FilterChip>
              {availableCategories.map((category) => (
                <FilterChip
                  key={category}
                  active={categoryFilter === category}
                  onClick={() => setCategoryFilter(category)}
                >
                  {t(CATEGORY_TRANSLATION_KEYS[category])}
                </FilterChip>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
                {t("gallerySort")}
              </span>
              <FilterChip active={sortMode === "chronologisch"} onClick={() => setSortMode("chronologisch")}>
                {t("gallerySortChronological")}
              </FilterChip>
              <FilterChip active={sortMode === "alfabetisch"} onClick={() => setSortMode("alfabetisch")}>
                {t("gallerySortAlphabetical")}
              </FilterChip>
            </div>
          </div>

          {/* Grid — scrollbaar, touch-vriendelijk */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-6 md:px-12">
            {filteredPhotos.length === 0 ? (
              <p className="pt-12 text-center text-sm text-zinc-400">{t("galleryNoResults")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {filteredPhotos.map((photo, index) => (
                  <GalleryThumbnail key={photo.id} photo={photo} onOpen={() => setLightboxIndex(index)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {open && lightboxIndex !== null && (
        <Lightbox
          photos={filteredPhotos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  dotColor,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${
        active
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
      }`}
    >
      {dotColor && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: active ? "#ffffff" : dotColor }}
        />
      )}
      {children}
    </button>
  );
}