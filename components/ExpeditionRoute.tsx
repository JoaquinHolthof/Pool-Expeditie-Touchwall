"use client";

import {
  Suspense,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { type LocalizedText } from "@/lib/language";
import {
  AUDIO_SEA_AMBIENCE,
  AUDIO_HARBOUR_DEPARTURE,
  AUDIO_COLD_WIND,
  AUDIO_SEA_VOLUME,
  AUDIO_HARBOUR_PEAK_VOLUME,
  AUDIO_WIND_PEAK_VOLUME,
  useFadingTrack,
} from "./ExpeditionAudio";

/* ============================================================================
 * DATA — meerdere expedities, elk met een eigen route/waypoints
 * ----------------------------------------------------------------------------
 * Placeholder-data. Vervang coördinaten, teksten en `image`-paden gerust door
 * de definitieve archiefdata — de rest van dit bestand rekent alles
 * automatisch om naar 3D-posities op de bol, ongeacht welke expeditie actief is.
 * ==========================================================================*/

/** Categorieën voor de fotogalerij-filters — uitbreidbaar, maar dit dekt de
 * huidige waypoints. De vertaalde labels staan niet hier, maar in de
 * vertaalbestanden (/locales/{taal}.json, sleutels "category" + naam), zodat
 * ze meeschakelen met de rest van de UI-taal — zie CATEGORY_TRANSLATION_KEYS
 * in PhotoGallery.tsx. */
export type PhotoCategory = "vertrek" | "ijs" | "basis" | "voorbereiding" | "bemanning" | "archief";

/**
 * Eén losse archieffoto — NIET per se aan één specifieke hotspot gekoppeld
 * (bv. een bemanningsportret, scheepsplan of herinneringskaart). Deze komen
 * bovenop de hotspot-hero-foto's terecht in de fotogalerij. Zet ze simpelweg
 * in de `photos`-array van de betreffende expeditie hieronder — nieuwe
 * foto's toevoegen is dus gewoon een nieuw object aan die array toevoegen.
 */
export interface ArchivePhoto {
  id: string;
  /** Pad in /public/images/expedition/. Let op hoofdlettergevoeligheid en
   *  de exacte extensie (.jpg/.avif/.webp) — deze moet exact overeenkomen
   *  met het bestand op de server. */
  src: string;
  title: string;
  category: PhotoCategory;
  /** Optioneel: kort onderschrift, getoond in de lightbox van de galerij. */
  caption?: string;
}

export interface WaypointStat {
  label: string;
  value: string;
}

export interface ExpeditionWaypoint {
  id: string;
  name: string;
  dateLabel: string;
  description: string;
  /** Pad naar een afbeelding in /public/images/expedition, bv. "/images/expedition/antwerpen.jpg" */
  image: string;
  lat: number;
  lon: number;
  /** Categorie voor de fotogalerij-filters. */
  category: PhotoCategory;
  /** Hoe lang de reis onderweg was op het moment van dit waypoint, getoond
   *  in de vaste datasnapshot (temperatuur / windkracht / reisduur) in de
   *  infokaart. Bv. "Dag 0 — vertrek" of "~7 weken onderweg". */
  travelDuration: string;
  /** Optionele extra vaste statistieken (bv. historische temperatuurextremen,
   *  bemanningsgrootte) — los van de temperatuur/windkracht/reisduur-snapshot. */
  stats?: WaypointStat[];
}

export interface Expedition {
  id: string;
  /** Volledige titel zoals getoond in de switcher, bv. "Belgica 1897 — 1899".
   *  LocalizedText: gewone string (alle talen) of een object met een
   *  vertaling per taal — zie lib/language.tsx. */
  label: LocalizedText;
  /** Korte naam voor plekken met weinig ruimte, bv. filterknoppen in de
   *  fotogalerij — "Belgica", "Koning Boudewijnbasis", "Prinses Elisabeth". */
  shortLabel: LocalizedText;
  /** Subtiele accentkleur — kleurt het bolletje in de switcher én de gloed van de routelijn */
  accentColor: string;
  waypoints: ExpeditionWaypoint[];
  /** Losse archieffoto's (bemanning, scheepsdetails, memorabilia, ...) die
   *  wél in de fotogalerij verschijnen maar niet aan één specifieke hotspot
   *  gekoppeld zijn. Optioneel — leeg is prima. */
  photos?: ArchivePhoto[];
}

export const expeditions: Expedition[] = [
  {
    id: "belgica",
    label: {
      nl: "Belgica 1897 — 1899",
      en: "Belgica 1897 — 1899",
      fr: "Belgica 1897 — 1899",
      de: "Belgica 1897 — 1899",
    },
    shortLabel: { nl: "Belgica", en: "Belgica", fr: "Belgica", de: "Belgica" },
    accentColor: "#1f6fd6",
    waypoints: [
      {
        id: "antwerpen",
        name: "Antwerpen",
        dateLabel: "16 augustus 1897",
        description:
          "Vertrek van de Belgica vanuit de haven van Antwerpen, onder leiding van Adrien de Gerlache.",
        image: "/images/expedition/antwerpen.jpg",
        lat: 51.2213,
        lon: 4.4051,
        category: "vertrek",
        travelDuration: "Dag 0 — vertrek",
      },
      {
        id: "rio-de-janeiro",
        name: "Rio de Janeiro",
        dateLabel: "oktober 1897",
        description:
          "Tussenstop voor bevoorrading, voordat het schip verder zuidwaarts koerst richting Vuurland.",
        image: "/images/expedition/rio.jpg",
        lat: -22.9068,
        lon: -43.1729,
        category: "vertrek",
        travelDuration: "~7 weken onderweg",
      },
      {
        id: "straat-magellaan",
        name: "Straat Magellaan",
        dateLabel: "december 1897",
        description:
          "Laatste haven bij Punta Arenas voor de Belgica de Straat van Magellaan verlaat, op weg naar de ijszee.",
        image: "/images/expedition/straat-magellaan.jpg",
        lat: -53.1638,
        lon: -70.9171,
        category: "vertrek",
        travelDuration: "~4 maanden onderweg",
      },
      {
        id: "bellingshausen",
        name: "Bellingshausenzee",
        dateLabel: "maart 1898",
        description:
          "De Belgica raakt vast in het pakijs — het begin van dertien maanden gedwongen overwintering.",
        image: "/images/expedition/bellingshausen.jpg",
        lat: -70.5,
        lon: -85.0,
        category: "ijs",
        travelDuration: "~7 maanden onderweg",
        stats: [
          { label: "Vastgevroren sinds", value: "3 maart 1898" },
          { label: "Duur overwintering", value: "13 maanden" },
          { label: "Laagst gemeten temperatuur", value: "-43,1 °C" },
        ],
      },
      {
        id: "poolnacht",
        name: "De poolnacht",
        dateLabel: "mei – juli 1898",
        description:
          "Ruim twee maanden zonder zonlicht: de bemanning doorstaat de eerste geregistreerde Antarctische poolnacht.",
        image: "/images/expedition/poolnacht.jpg",
        lat: -71.3,
        lon: -89.5,
        category: "ijs",
        travelDuration: "~10 maanden onderweg",
        stats: [
          { label: "Duur zonder zonlicht", value: "70 dagen" },
          { label: "Bemanningsleden", value: "18" },
          { label: "Overleden tijdens overwintering", value: "2" },
        ],
      },
      {
        id: "terugreis-punta-arenas",
        name: "Terugreis via Punta Arenas",
        dateLabel: "januari 1899",
        description:
          "Na de bevrijding uit het pakijs vaart de Belgica noordwaarts en doet opnieuw Punta Arenas aan om te herbevoorraden voor de oversteek naar Europa.",
        image: "/images/expedition/straat-magellaan.jpg",
        lat: -53.1638,
        lon: -70.9171,
        category: "vertrek",
        travelDuration: "~17 maanden onderweg",
      },
      {
        id: "terugkeer",
        name: "Terugkeer naar Antwerpen",
        dateLabel: "5 november 1899",
        description:
          "Na bevrijding uit het ijs keert de Belgica terug — met unieke wetenschappelijke data over Antarctica.",
        image: "/images/expedition/terugkeer.jpg",
        lat: 51.2213,
        lon: 4.4051,
        category: "vertrek",
        travelDuration: "~27 maanden onderweg (aankomst)",
      },
    ],
    photos: [
      {
        id: "belgica-vast-in-ijs",
        src: "/images/expedition/3142_belgicavastinijs.jpg",
        title: "De Belgica vast in het pakijs",
        category: "ijs",
      },
      {
        id: "inspectie-belgica",
        src: "/images/expedition/5316_inspectie-van-de-belgica.jpg",
        title: "Inspectie van de Belgica",
        category: "vertrek",
      },
      {
        id: "belgica-in-antwerpen",
        src: "/images/expedition/5318_belgica-in-antwerpen.jpg",
        title: "De Belgica in de haven van Antwerpen",
        category: "vertrek",
      },
      {
        id: "isfjord",
        src: "/images/expedition/5322_isfjord.jpg",
        title: "IJsfjord",
        category: "ijs",
      },
      {
        id: "scheepsplan",
        src: "/images/expedition/5603_scheepsplan.jpg",
        title: "Scheepsplan van de Belgica",
        category: "archief",
      },
      {
        id: "belgica-oostende-1905",
        src: "/images/expedition/8995_de-belgica-in-oostende-in-1905.jpg",
        title: "De Belgica in Oostende, 1905",
        category: "archief",
      },
      {
        id: "postkaart-belgica",
        src: "/images/expedition/9397_postkaart-getiteld-qyacht-belgica-du-duc-dorleans-et-la-gareq-de-kaart-is-afkomstig-uit-de-collectie-van-omer-vilain.jpg",
        title: "Postkaart 'Yacht Belgica du Duc d'Orléans'",
        category: "archief",
        caption: "Uit de collectie van Omer Vilain.",
      },
      {
        id: "herinneringskaart",
        src: "/images/expedition/9398_herinneringskaart.jpg",
        title: "Herinneringskaart",
        category: "archief",
      },
      {
        id: "bemanning-belgica",
        src: "/images/expedition/9399_bemanning-van-de-belgica.jpg",
        title: "De bemanning van de Belgica",
        category: "bemanning",
      },
      {
        id: "nansen-scheepskat",
        src: "/images/expedition/12495_nansen-de-scheepskat.jpg",
        title: "Nansen, de scheepskat",
        category: "bemanning",
      },
      {
        id: "roald-amundsen-1",
        src: "/images/expedition/12496_roald-amundsen.jpg",
        title: "Roald Amundsen",
        category: "bemanning",
      },
      {
        id: "george-lecointe-1",
        src: "/images/expedition/12498_george-lecointe.jpg",
        title: "Georges Lecointe",
        category: "bemanning",
      },
      {
        id: "henryck-arctowski-1",
        src: "/images/expedition/12499_henryck-arctowski.jpg",
        title: "Henryk Arctowski",
        category: "bemanning",
      },
      {
        id: "frederick-cook",
        src: "/images/expedition/12500_frederick-albert-cook.jpg",
        title: "Frederick Albert Cook",
        category: "bemanning",
      },
      {
        id: "emile-racovitza",
        src: "/images/expedition/12501_emile-racovitza.jpg",
        title: "Emile Racovitza",
        category: "bemanning",
      },
      {
        id: "adrien-de-gerlache",
        src: "/images/expedition/12504_adrien-de-gerlache.jpg",
        title: "Adrien de Gerlache",
        category: "bemanning",
      },
      {
        id: "emile-danco",
        src: "/images/expedition/12513_emile-danco.jpg",
        title: "Emile Danco",
        category: "bemanning",
      },
      {
        id: "george-lecointe-2",
        src: "/images/expedition/12556_george-lecointe.jpg",
        title: "Georges Lecointe",
        category: "bemanning",
      },
      {
        id: "henryck-arctowski-2",
        src: "/images/expedition/12557_henryck-arctowski.jpg",
        title: "Henryk Arctowski",
        category: "bemanning",
      },
      {
        id: "roald-amundsen-2",
        src: "/images/expedition/12785_roald-amundsen.jpg",
        title: "Roald Amundsen",
        category: "bemanning",
      },
      {
        id: "arctowski-thoulet-fig2",
        src: "/images/expedition/32666_arctowski-en-thoulet-1901-fig-2.jpg",
        title: "Arctowski en Thoulet, 1901 (fig. 2)",
        category: "archief",
      },
      {
        id: "arctowski-thoulet-fig6",
        src: "/images/expedition/32670_arctowski-en-thoulet-1901-fig-6.jpg",
        title: "Arctowski en Thoulet, 1901 (fig. 6)",
        category: "archief",
      },
      {
        id: "expo-antarctica",
        src: "/images/expedition/beelden-uit-de-expo-antarctica.avif",
        title: "Beelden uit de expo Antarctica",
        category: "archief",
      },
    ],
  },
  {
    id: "koning-boudewijnbasis",
    label: {
      nl: "Koning Boudewijnbasis 1957 — 1967",
      en: "King Baudouin Base 1957 — 1967",
      fr: "Base Roi Baudouin 1957 — 1967",
      de: "König-Baudouin-Station 1957 — 1967",
    },
    shortLabel: {
      nl: "Koning Boudewijnbasis",
      en: "King Baudouin Base",
      fr: "Base Roi Baudouin",
      de: "König-Baudouin-Station",
    },
    accentColor: "#d6771f",
    // Historische scheepsroute: blijft bewust dicht bij de Atlantische
    // vaarroute langs Afrika (twee eilandstops), zoals schepen uit die tijd
    // daadwerkelijk voeren — geen enkele etappe snijdt over land.
    waypoints: [
      {
        id: "brussel",
        name: "Brussel",
        dateLabel: "1957",
        description:
          "Start van de Belgische voorbereidingen voor het Internationaal Geofysisch Jaar in Antarctica.",
        image: "/images/expedition/brussel.jpg",
        lat: 50.8503,
        lon: 4.3517,
        category: "voorbereiding",
        travelDuration: "Dag 0 — vertrek",
      },
      {
        id: "kaapverdie",
        name: "Kaapverdische Eilanden",
        dateLabel: "1957",
        description:
          "Eerste bevoorradingsstop in de Atlantische Oceaan, ver voor de westkust van Afrika.",
        image: "/images/expedition/kaapverdie.jpg",
        lat: 16.0,
        lon: -24.0,
        category: "vertrek",
        travelDuration: "~1 week onderweg",
      },
      {
        id: "sint-helena",
        name: "Sint-Helena",
        dateLabel: "1957",
        description:
          "Historisch aandoenpunt midden in de Zuid-Atlantische Oceaan, ruim voor de kust van Angola en Namibië — hier buigt de route mee naar het zuidoosten.",
        image: "/images/expedition/sint-helena.jpg",
        lat: -15.96,
        lon: -5.7,
        category: "vertrek",
        travelDuration: "~3 weken onderweg",
      },
      {
        id: "kaapstad",
        name: "Kaapstad",
        dateLabel: "1957",
        description: "Laatste bevoorradingshaven voor de oversteek naar het Antarctische pakijs.",
        image: "/images/expedition/kaapstad.jpg",
        lat: -33.9249,
        lon: 18.4241,
        category: "vertrek",
        travelDuration: "~5 weken onderweg",
      },
      {
        id: "koning-boudewijnbasis",
        name: "Koning Boudewijnbasis",
        dateLabel: "1958 — 1967",
        description:
          "Het eerste Belgische onderzoeksstation in Antarctica, opgericht door Gaston de Gerlache aan de Prinses Ragnhildkust.",
        image: "/images/expedition/koning-boudewijnbasis.jpg",
        lat: -72.8,
        lon: 25.0,
        category: "basis",
        travelDuration: "~7 weken onderweg (aankomst)",
        stats: [
          { label: "Actieve jaren", value: "1958 – 1961, 1964 – 1967" },
          { label: "Gemiddelde wintertemperatuur", value: "-18 °C" },
          { label: "Hoogte boven zeeniveau", value: "~35 m" },
        ],
      },
    ],
    photos: [
      {
        id: "gaston-de-gerlache",
        // Let op: exacte bestandsnaam uit de aangeleverde map — ongebruikelijke
        // schrijfwijze/hoofdlettergebruik, maar moet zo overeenkomen met het
        // bestand op de server (hoofdlettergevoelig!).
        src: "/images/expedition/Gatondegerlache.jpg",
        title: "Gaston de Gerlache",
        category: "bemanning",
        caption: "Oprichter van de Koning Boudewijnbasis.",
      },
    ],
  },
  {
    id: "prinses-elisabeth",
    label: {
      nl: "Prinses Elisabeth Antarctica 2009 — heden",
      en: "Princess Elisabeth Antarctica 2009 — present",
      fr: "Princesse Élisabeth Antarctica 2009 — aujourd'hui",
      de: "Prinzessin-Elisabeth-Antarktis 2009 — heute",
    },
    shortLabel: {
      nl: "Prinses Elisabeth",
      en: "Princess Elisabeth",
      fr: "Princesse Élisabeth",
      de: "Prinzessin Elisabeth",
    },
    accentColor: "#2f9e6b",
    // Moderne luchtlogistieke route: één Atlantische tussenstop (i.p.v. twee
    // bij de Koning Boudewijnbasis) en een extra etappe over de Zuidelijke
    // Oceaan naar het Novo-luchtruimtestation — het echte DROMLAN-netwerk
    // dat vandaag nog gebruikt wordt om het station te bevoorraden. Andere
    // vorm, ander aantal hotspots, duidelijk te onderscheiden van de
    // Koning Boudewijnbasis-route.
    waypoints: [
      {
        id: "brussel-pea",
        name: "Brussel",
        dateLabel: "2007",
        description:
          "De Internationale Polar Foundation start de bouw van een nieuw, volledig duurzaam Belgisch onderzoeksstation in Antarctica.",
        image: "/images/expedition/brussel.jpg",
        lat: 50.8503,
        lon: 4.3517,
        category: "voorbereiding",
        travelDuration: "Dag 0 — vertrek",
      },
      {
        id: "ascension",
        name: "Ascension-eiland",
        dateLabel: "2008",
        description:
          "Tussenstop midden in de Atlantische Oceaan voor materiaal en bouwonderdelen — een directere route dan de historische scheepvaartroute via Kaapverdië.",
        image: "/images/expedition/ascension.jpg",
        lat: -7.95,
        lon: -14.4,
        category: "vertrek",
        travelDuration: "~4 dagen onderweg",
      },
      {
        id: "kaapstad-pea",
        name: "Kaapstad",
        dateLabel: "2008",
        description: "Logistiek knooppunt voor de laatste etappe richting Antarctica.",
        image: "/images/expedition/kaapstad.jpg",
        lat: -33.9249,
        lon: 18.4241,
        category: "vertrek",
        travelDuration: "~1 week onderweg",
      },
      {
        id: "novo-airbase",
        name: "Novo-luchtstation",
        dateLabel: "2008 — heden",
        description:
          "Antarctisch ijslandingsbaan en logistiek knooppunt van het DROMLAN-netwerk, over de Zuidelijke Oceaan bereikt — vandaag nog de belangrijkste toegangspoort tot het station.",
        image: "/images/expedition/novo-airbase.jpg",
        lat: -70.77,
        lon: 11.83,
        category: "vertrek",
        travelDuration: "~9 dagen onderweg",
      },
      {
        id: "prinses-elisabeth-antarctica",
        name: "Prinses Elisabeth Antarctica",
        dateLabel: "15 februari 2009 — heden",
        description:
          "Het eerste 'zero-emission' onderzoeksstation ter wereld, gebouwd op de Utsteinen-rots en volledig op zonne- en windenergie draaiend.",
        image: "/images/expedition/prinses-elisabeth-antarctica.jpg",
        lat: -71.95,
        lon: 23.35,
        category: "basis",
        travelDuration: "~10 dagen onderweg (aankomst)",
        stats: [
          { label: "Energievoorziening", value: "100% zon & wind" },
          { label: "Maximale bezetting", value: "20 personen" },
          { label: "Hoogte boven zeeniveau", value: "~1.390 m" },
        ],
      },
    ],
  },
];

/* ============================================================================
 * GEO-HELPERS
 * ==========================================================================*/

/** Zet breedte-/lengtegraad om naar een positie op het boloppervlak. */
export function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/** De inverse van latLonToVector3: zet een 3D-punt op (of vlak bij) het
 *  boloppervlak terug om naar breedte-/lengtegraad. Nodig voor "Bouw je
 *  eigen expeditie": een klik ergens op de globe moet een coördinaat worden. */
export function vector3ToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const radius = point.length() || 1;
  const phi = Math.acos(THREE.MathUtils.clamp(point.y / radius, -1, 1));
  const theta = Math.atan2(point.z, -point.x);
  const lat = 90 - phi * (180 / Math.PI);
  let lon = theta * (180 / Math.PI) - 180;
  // Normaliseren naar [-180, 180]
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

/** Slerp tussen twee punten óver het boloppervlak — een geodetische
 * ("great circle") lijn, geen rechte lijn dwars door de bol. */
export function slerpOnSphere(a: THREE.Vector3, b: THREE.Vector3, t: number, radius: number): THREE.Vector3 {
  const dirA = a.clone().normalize();
  const dirB = b.clone().normalize();
  const omega = Math.acos(THREE.MathUtils.clamp(dirA.dot(dirB), -1, 1));
  if (omega < 1e-6) return dirA.multiplyScalar(radius);
  const sinOmega = Math.sin(omega);
  const scaleA = Math.sin((1 - t) * omega) / sinOmega;
  const scaleB = Math.sin(t * omega) / sinOmega;
  return dirA.multiplyScalar(scaleA).add(dirB.multiplyScalar(scaleB)).multiplyScalar(radius);
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Hoogte waarop de route/markers boven de kale bol-straal zweven — ruim
 * boven de displacement-piekhoogte van IceGlobe.tsx, zodat de lijn nooit in
 * bergketens verdwijnt (clipping). */
export const ROUTE_ALTITUDE = 0.045;
export const SEGMENTS_PER_LEG = 24;

/** Duur (in seconden) van elke fade-fase (uit ⟶ wisselen ⟶ in) bij het
 * switchen van expeditie. */
const FADE_DURATION = 0.45;

/* ============================================================================
 * ROUTELIJN — dunne, ijsblauwe lijn met zachte gloed (per expeditie getint)
 * ==========================================================================*/

function useRoutePoints(radius: number, waypoints: ExpeditionWaypoint[]): THREE.Vector3[] {
  return useMemo(() => {
    const r = radius + ROUTE_ALTITUDE;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = latLonToVector3(waypoints[i].lat, waypoints[i].lon, r);
      const b = latLonToVector3(waypoints[i + 1].lat, waypoints[i + 1].lon, r);
      for (let s = 0; s < SEGMENTS_PER_LEG; s++) {
        points.push(slerpOnSphere(a, b, s / SEGMENTS_PER_LEG, r));
      }
    }
    const last = waypoints[waypoints.length - 1];
    if (last) points.push(latLonToVector3(last.lat, last.lon, r));
    return points;
  }, [radius, waypoints]);
}

/**
 * Hoe lang (in seconden) één pijltje erover doet om van begin- tot eindpunt
 * van de route te glijden. Bewust traag — dit moet oogrust geven, geen
 * "bewegend object" worden dat de aandacht trekt.
 */
const FLOW_ARROW_DURATION = 28;

/** Positie + tangentrichting op fractie `t` (0..1) langs een polylijn. */
export function samplePolyline(points: THREE.Vector3[], t: number): { position: THREE.Vector3; tangent: THREE.Vector3 } {
  const segmentCount = points.length - 1;
  const scaled = THREE.MathUtils.clamp(t, 0, 1) * segmentCount;
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = scaled - index;
  const a = points[index];
  const b = points[index + 1];
  return {
    position: a.clone().lerp(b, localT),
    tangent: b.clone().sub(a).normalize(),
  };
}

/**
 * Eén klein, plat pijltje dat traag over de route glijdt, altijd plat tegen
 * het boloppervlak en met de punt in de vaarrichting. Fadet zachtjes in/uit
 * rond het begin/eind van zijn lus (i.p.v. abrupt te "springen"), en ademt
 * heel licht in opaciteit — subtiel genoeg om niet af te leiden op een
 * touchwall, duidelijk genoeg om de richting te tonen.
 */
function RouteFlowArrow({
  points,
  color,
  fadeOpacity,
  loopOffset,
}: {
  points: THREE.Vector3[];
  color: string;
  fadeOpacity: number;
  loopOffset: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    const material = materialRef.current;
    if (!group || !material || points.length < 2) return;

    const t = ((clock.elapsedTime / FLOW_ARROW_DURATION + loopOffset) % 1 + 1) % 1;
    const { position, tangent } = samplePolyline(points, t);

    // Vlak tegen het oppervlak leggen: lokaal +Z = naar buiten (de normaal),
    // lokaal +Y = vaarrichting (de tangent, geprojecteerd op het raakvlak).
    const normal = position.clone().normalize();
    const tangentOnSurface = tangent.clone().sub(normal.clone().multiplyScalar(tangent.dot(normal)));
    if (tangentOnSurface.lengthSq() > 1e-8) {
      tangentOnSurface.normalize();
      const right = new THREE.Vector3().crossVectors(tangentOnSurface, normal).normalize();
      const basis = new THREE.Matrix4().makeBasis(right, tangentOnSurface, normal);
      group.quaternion.setFromRotationMatrix(basis);
    }
    group.position.copy(position);

    // Zachte fade nabij begin (t≈0) en eind (t≈1) van de lus — voorkomt een
    // hard "opduiken/verdwijnen"; plus een heel lichte adem in opaciteit.
    const edgeFade = Math.min(
      THREE.MathUtils.smoothstep(t, 0, 0.08),
      THREE.MathUtils.smoothstep(1 - t, 0, 0.08)
    );
    const breathe = 0.75 + Math.sin(clock.elapsedTime * 1.1 + loopOffset * Math.PI * 2) * 0.25;
    material.opacity = 0.55 * edgeFade * breathe * fadeOpacity;
  });

  return (
    <group ref={groupRef}>
      {/* Klein, plat driehoekje — ConeGeometry met weinig segmenten, plat-
          geschaald langs de oppervlaktenormaal (lokale Z), oogt zo als een
          subtiel 2D-pijlpuntje i.p.v. een 3D-object dat uit het ijs steekt.
          De punt (cone-apex) wijst automatisch in de vaarrichting, omdat de
          lokale +Y-as van deze group al op de tangent is uitgelijnd. */}
      <mesh scale={[1, 1, 0.15]}>
        <coneGeometry args={[0.012, 0.03, 3]} />
        <meshBasicMaterial
          ref={materialRef}
          color={color}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function RouteLine({
  radius,
  waypoints,
  color,
  fadeOpacity,
}: {
  radius: number;
  waypoints: ExpeditionWaypoint[];
  color: string;
  fadeOpacity: number;
}) {
  const points = useRoutePoints(radius, waypoints);
  if (points.length < 2) return null;

  return (
    <group>
      {/* Brede, zachte glow-laag ónder de lijn — géén postprocessing nodig.
          De kleur is per expeditie anders, zodat de titelwissel zich ook
          subtiel in de globe zelf laat zien. */}
      <Line points={points} color={color} lineWidth={6} transparent opacity={0.22 * fadeOpacity} depthWrite={false} />
      {/* Scherpe, heldere kernlijn — blijft altijd ijswit, ongeacht expeditie */}
      <Line points={points} color="#eaf4ff" lineWidth={1.6} transparent opacity={0.92 * fadeOpacity} depthWrite={false} />

      {/* Eén klein, zacht ademend pijltje dat traag over de volledige route
          glijdt — geeft de vaarrichting aan zonder de rust te verstoren.
          Bewust maar één stuk: met meerdere, los van elkaar lopende
          pijltjes leek het net of de reis "terugspringt" voordat hij is
          aangekomen, omdat het tweede pijltje dan al verder in zijn eigen
          lus zat. */}
      <RouteFlowArrow points={points} color={color} fadeOpacity={fadeOpacity} loopOffset={0} />
    </group>
  );
}

/* ============================================================================
 * WAYPOINT-MARKER — klikbaar, met hover/select-pulse, faded mee met de route
 * ==========================================================================*/

interface MarkerProps {
  waypoint: ExpeditionWaypoint;
  radius: number;
  isSelected: boolean;
  onSelect: (waypoint: ExpeditionWaypoint) => void;
  fadeOpacity: number;
  /** Accentkleur van de expeditie waar dit waypoint bij hoort — houdt de
   *  hotspot visueel één geheel met zijn eigen routelijn. */
  color: string;
}

function WaypointMarker({ waypoint, radius, isSelected, onSelect, fadeOpacity, color }: MarkerProps) {
  const [hovered, setHovered] = useState(false);
  const ringRef = useRef<THREE.Mesh>(null);

  const position = useMemo(
    () => latLonToVector3(waypoint.lat, waypoint.lon, radius + ROUTE_ALTITUDE + 0.01),
    [waypoint, radius]
  );

  // Zelfde accentkleur als de routelijn, maar dan lichter getint voor de
  // "geselecteerd"-staat van het kernpunt en voor de ring — automatisch
  // afgeleid, dus dit werkt voor elke expeditie-kleur zonder per expeditie
  // losse varianten te hoeven bijhouden.
  const selectedDotColor = useMemo(
    () => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35).getStyle(),
    [color]
  );
  const ringColor = useMemo(
    () => new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.55).getStyle(),
    [color]
  );

  // De marker moet plat tegen het boloppervlak liggen: richt lokaal +Z op
  // de uitgaande oppervlaktenormaal op dat punt.
  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [position]);

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.12;
    const scale = (isSelected ? 1.6 : hovered ? 1.3 : 1) * pulse;
    ringRef.current.scale.setScalar(scale);
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    // Tijdens een expeditie-wissel (fade < 1) niet klikbaar — voorkomt dat je
    // per ongeluk een marker van de "oude" route selecteert terwijl die wegfadet.
    if (fadeOpacity < 0.98) return;
    onSelect(waypoint);
  };

  return (
    <group position={position} quaternion={quaternion}>
      {/* Onzichtbaar, ruimer hit-target — prettiger klikken/tikken op een touchwall */}
      <mesh
        onClick={handleClick}
        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <circleGeometry args={[0.09, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Kernpunt */}
      <mesh>
        <circleGeometry args={[0.028, 24]} />
        <meshBasicMaterial
          color={isSelected ? selectedDotColor : color}
          transparent
          opacity={fadeOpacity}
          depthWrite={false}
        />
      </mesh>

      {/* Pulserende ring */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.04, 0.052, 32]} />
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={(hovered || isSelected ? 0.85 : 0.5) * fadeOpacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ============================================================================
 * 3D-MODEL VAN DE KONING BOUDEWIJNBASIS — alleen zichtbaar in díe modus
 * ----------------------------------------------------------------------------
 * Verwacht het bestand op public/assets/koning_boudewijnbasis.glb (dus
 * bereikbaar via de URL "/assets/koning_boudewijnbasis.glb"). Alles onder
 * public/ wordt door Next.js 1-op-1 op de root geserveerd: de mapstructuur
 * in public/ ná "public/" zélf bepaalt het URL-pad.
 * ==========================================================================*/

const BASE_MODEL_URL = "/assets/koning_boudewijnbasis.glb";
// Alvast op de achtergrond laden zodra de app opstart, zodat er geen
// merkbare laadvertraging is op het moment dat de gebruiker naar deze
// expeditie schakelt.
useGLTF.preload(BASE_MODEL_URL);

/** Doelgrootte (in globe-eenheden) waarnaar het model automatisch wordt
 * geschaald — ongeacht in welke native eenheden (m, cm, ...) het .glb-bestand
 * oorspronkelijk geëxporteerd is. Zo blijft het altijd een passend "hotspot"-
 * formaat op de bol, in plaats van piepklein of torenhoog. Dit is de knop om
 * aan te draaien als het je nog te groot/klein oogt. */
const BASE_MODEL_TARGET_SIZE = 0.19;

/**
 * Welke lokale as van het model "omhoog" betekent, vóórdat het op de bol
 * wordt uitgelijnd. glTF-standaard is Y-omhoog — de meeste exporters
 * (waaronder Blender's eigen glTF-exporter) zetten dat automatisch goed,
 * maar sommige tools (o.a. bepaalde Meshy-exports) laten een model in zijn
 * Blender-oriëntatie (Z-omhoog) staan. Ligt het model plat/op zijn kant op
 * het ijs? Zet dit dan op `new THREE.Vector3(0, 0, 1)`.
 */
const MODEL_LOCAL_UP = new THREE.Vector3(0, 1, 0);

/**
 * Extra draai (in radialen) om de eigen verticale as van het model, ná het
 * rechtop zetten — voor als de basis wel plat ligt maar met de verkeerde
 * gevel naar de camera/route toe wijst. Begin op 0; probeer bv.
 * `Math.PI / 2` of `Math.PI` als het er nog gedraaid bij staat.
 */
const MODEL_EXTRA_TWIST = 0;

/**
 * Fijn-afstelling bovenop de (nu terrein-correcte) oppervlaktehoogte. Positief
 * = iets boven het ijs, negatief = iets erin. Laat op een heel kleine positieve
 * waarde staan om te voorkomen dat het model op de millimeter nauwkeurig
 * exact in het ijsvlak "snijdt" (flikkerende randen/z-fighting).
 */
const MODEL_SURFACE_OFFSET = 0.004;

// Moet gelijk blijven aan displacementMap/displacementScale/displacementBias
// van TerrainGlobe in IceGlobe.tsx — dit ís letterlijk dezelfde hoogtekaart,
// op dezelfde manier toegepast, zodat het model op de wérkelijke (bergachtige/
// oneffen) ijsoppervlakte rust in plaats van op een denkbeeldige gladde bol.
const TERRAIN_DISPLACEMENT_URL = "https://unpkg.com/three-globe/example/img/earth-topology.png";
const TERRAIN_DISPLACEMENT_SCALE = 0.2;
const TERRAIN_DISPLACEMENT_BIAS = -0.075;

/**
 * Leest de daadwerkelijke terreinhoogte op een lat/lon af uit dezelfde
 * hoogtekaart die TerrainGlobe gebruikt, en geeft de bijbehorende straal
 * terug. Dít is de kern van de "zweven"-fix: een vlakke `radius` klopt niet
 * op plekken waar het reliëf van de bol zelf hoger of lager ligt dan
 * gemiddeld. Valt terug op de vlakke straal + `MODEL_SURFACE_OFFSET` als het
 * uitlezen om wat voor reden dan ook niet lukt (bv. canvas-CORS-restricties).
 */
function useDisplacedSurfaceRadius(
  baseRadius: number,
  waypoint: ExpeditionWaypoint | undefined
): number {
  const { map: displacementMap } = useTexture({ map: TERRAIN_DISPLACEMENT_URL });
  const [radius, setRadius] = useState(baseRadius + MODEL_SURFACE_OFFSET);

  useEffect(() => {
    if (!waypoint) return;
    const image = displacementMap.image as HTMLImageElement | ImageBitmap | undefined;
    if (!image || !("width" in image) || !image.width) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D-canvascontext niet beschikbaar");
      ctx.drawImage(image as CanvasImageSource, 0, 0);

      // Standaard equirectangular-mapping: rij 0 (boven) = Noordpool,
      // kolom 0 (links) = lengtegraad -180 — consistent met hoe
      // latLonToVector3 lat/lon al naar XYZ vertaalt.
      const colFraction = (waypoint.lon + 180) / 360;
      const rowFraction = (90 - waypoint.lat) / 180;
      const px = Math.min(image.width - 1, Math.max(0, Math.round(colFraction * (image.width - 1))));
      const py = Math.min(image.height - 1, Math.max(0, Math.round(rowFraction * (image.height - 1))));

      const [gray] = ctx.getImageData(px, py, 1, 1).data;
      const heightValue = gray / 255;
      const displaced =
        baseRadius +
        heightValue * TERRAIN_DISPLACEMENT_SCALE +
        TERRAIN_DISPLACEMENT_BIAS +
        MODEL_SURFACE_OFFSET;
      setRadius(displaced);
    } catch {
      // Canvas kon niet gelezen worden (bv. CORS) — nette fallback op de
      // vlakke straal, beter een kleine zweefafwijking dan een crash.
      setRadius(baseRadius + MODEL_SURFACE_OFFSET);
    }
  }, [waypoint, displacementMap, baseRadius]);

  return radius;
}

function AntarcticStationModel({ radius, fadeOpacity }: { radius: number; fadeOpacity: number }) {
  const { scene } = useGLTF(BASE_MODEL_URL);

  // Eigen kloon per instantie: drei cachet en hergebruikt de geladen
  // scene-graph, dus zonder clone zouden we straks de gedeelde (gecachete)
  // materialen/opacity muteren i.p.v. alleen deze ene instantie.
  const model = useMemo(() => scene.clone(true), [scene]);

  // Zelfde coördinaten als de laatste stop van de Prinses Elisabeth-route
  // ("prinses-elisabeth-antarctica") — opgezocht i.p.v. hardcoded, zodat de
  // twee nooit uit elkaar kunnen lopen.
  const baseWaypoint = useMemo(
    () =>
      expeditions
        .find((expedition) => expedition.id === "prinses-elisabeth")
        ?.waypoints.find((waypoint) => waypoint.id === "prinses-elisabeth-antarctica"),
    []
  );

  // De écht correcte straal op dít punt (rekening houdend met het reliëf),
  // niet de gemiddelde bolstraal — dát was de resterende oorzaak van het zweven.
  const surfaceRadius = useDisplacedSurfaceRadius(radius, baseWaypoint);

  const position = useMemo(() => {
    if (!baseWaypoint) return new THREE.Vector3(0, 0, surfaceRadius);
    return latLonToVector3(baseWaypoint.lat, baseWaypoint.lon, surfaceRadius);
  }, [baseWaypoint, surfaceRadius]);

  // Het model "staat" overeind: lijn `MODEL_LOCAL_UP` uit met de uitgaande
  // oppervlaktenormaal op dat punt, plus een optionele extra twist.
  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(MODEL_LOCAL_UP, normal);
    if (MODEL_EXTRA_TWIST !== 0) {
      const twist = new THREE.Quaternion().setFromAxisAngle(MODEL_LOCAL_UP, MODEL_EXTRA_TWIST);
      q.multiply(twist);
    }
    return q;
  }, [position]);

  // Automatisch schalen op basis van de werkelijke bounding box van het
  // geladen model — werkt ongeacht de native grootte van het .glb-bestand.
  // Tegelijk meten we hoe ver het laagste punt van het model onder zijn
  // eigen oorsprong (0,0,0) zit: veel Blender-exports hebben hun pivot in
  // het midden van het object i.p.v. aan de onderkant. Zonder correctie
  // "zweeft" dan effectief de helft van het model boven het oppervlak.
  const { scale, baseOffset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z) || 1;
    const computedScale = BASE_MODEL_TARGET_SIZE / largestDimension;
    // Offset in de lokale, ongeschaalde ruimte van het model zelf — hoeft
    // dus niet met `computedScale` vermenigvuldigd te worden: dat gebeurt
    // vanzelf doordat dit een kind-transform is van de geschaalde groep.
    return { scale: computedScale, baseOffset: -box.min.y };
  }, [model]);

  // Materialen transparant maken zodat het model meefadet met de route/
  // markers (zie `fadeOpacity` in het hoofdcomponent) i.p.v. abrupt te
  // verschijnen/verdwijnen bij het wisselen van expeditie. Klikken op het
  // model zelf worden uitgeschakeld: de bijbehorende WaypointMarker eronder
  // blijft het aanspreekpunt voor selectie/camera-focus.
  useEffect(() => {
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.raycast = () => {};
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = fadeOpacity;
        // Alleen dieptetests laten schrijven bij (bijna) volledige opaciteit
        // — voorkomt sorteer-artefacten van doorschijnende driehoeken
        // tijdens de fade, zonder de normale occlusie bij vol zicht te verliezen.
        material.depthWrite = fadeOpacity > 0.98;
      }
    });
  }, [model, fadeOpacity]);

  if (!baseWaypoint) return null;

  return (
    // Buitenste groep: plaatsing/oriëntatie/schaal op de bol.
    <group position={position} quaternion={quaternion} scale={scale}>
      {/* Binnenste primitive: lokale verschuiving zodat de ONDERKANT van
          het model (niet zijn pivot) precies op de bolstraal rust. */}
      <primitive object={model} position={[0, baseOffset, 0]} />
    </group>
  );
}

/* ============================================================================
 * 3D-MODEL VAN DE BELGICA — alleen zichtbaar in díe modus
 * ----------------------------------------------------------------------------
 * Verwacht het bestand op public/assets/belgica.glb (dus bereikbaar via
 * "/assets/belgica.glb"). Staat het ergens anders in jouw public-map, pas
 * dan enkel BELGICA_MODEL_URL hieronder aan.
 * ==========================================================================*/

const BELGICA_MODEL_URL = "/assets/belgica.glb";
useGLTF.preload(BELGICA_MODEL_URL);

/** Doelgrootte in globe-eenheden — een schip mag zichtbaar kleiner ogen dan
 * de basis-gebouwen, vandaar een kleinere waarde dan BASE_MODEL_TARGET_SIZE. */
const SHIP_MODEL_TARGET_SIZE = 0.1;

/** Zelfde idee als bij de basis: welke lokale as is "omhoog" vóór het plat
 * op het wateroppervlak leggen. Ligt het schip op zijn kant/kop? Probeer
 * `new THREE.Vector3(0, 0, 1)`. */
const SHIP_LOCAL_UP = new THREE.Vector3(0, 1, 0);

/** Welke lokale as de boeg/voorsteven van het model is — hiermee wordt het
 * schip zo gedraaid dat de boeg de vaarrichting op volgt (zie hieronder).
 * Standaard +Z (voorkant "naar de kijker" bij veel exports); staat het
 * zijwaarts, probeer `new THREE.Vector3(1, 0, 0)` of `(0, 0, -1)`. */
const SHIP_LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

/** Extra correctiehoek (radialen) bovenop de berekende vaarrichting — voor
 * als de boeg na het testen tóch de verkeerde kant op blijkt te wijzen
 * (bv. precies 180° verkeerd om). Begin op 0, probeer anders `Math.PI`. */
const SHIP_HEADING_OFFSET = -Math.PI / 2 + Math.PI;

/** Hoeveel van de scheepsromp-hoogte (van kiel tot dek, als fractie 0–1)
 * "onder water" mag zitten. 0 = kiel precies op het zeeniveau (lijkt op de
 * golven te balanceren), 1 = hele schip verzonken. Een schip dat écht op
 * het water ligt, heeft doorgaans zo'n 30–45% van de romp onder de
 * waterlijn — vandaar deze middenwaarde. Het is geen apart watervlak: de
 * globe zelf (het reliëf-mesh) "snijdt" gewoon het onderste stuk van de
 * romp weg, wat precies het verzonken-in-het-water-effect geeft. */
const SHIP_SUBMERGE_FRACTION = 0.08;

/** Hoe lang (in seconden) één etappe van de doorlopende showcase-vaart duurt
 * (Antwerpen → Antarctica, of terug) wanneer er GEEN hotspot geselecteerd
 * is. Het schip pendelt heen-en-weer tussen beide uiteinden van de route —
 * een volledige heen-en-terugreis duurt dus ongeveer het dubbele van deze
 * waarde. Herstart vanzelf bij Antwerpen zodra je de Belgica-expeditie
 * opnieuw kiest (het model wordt dan opnieuw gemount). */
const SHIP_AMBIENT_VOYAGE_DURATION = 100;

/** Vaarsnelheid (fractie van de totale route per seconde) wanneer het schip
 * wél naar een specifiek, aangeklikt hotspot onderweg is. Hoger = sneller
 * ter plaatse, lager = een trager, nadrukkelijker gevoel van "onderweg zijn". */
const SHIP_SAIL_TO_HOTSPOT_SPEED = 0.05;

/** Beweegt `current` een vaste stap (`maxStep`, altijd positief) richting
 * `target`, zonder eraan voorbij te schieten — simpele, voorspelbare
 * constante-snelheid-animatie (i.p.v. een exponentiële ease die nooit
 * helemaal aankomt). */
function stepTowards(current: number, target: number, maxStep: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

function BelgicaShipModel({
  radius,
  fadeOpacity,
  targetWaypointId,
  livePositionRef,
}: {
  radius: number;
  fadeOpacity: number;
  /** Id van het momenteel geselecteerde hotspot (of null). Is dit gezet, dan
   *  vaart het schip er expliciet naartoe langs de route i.p.v. de trage
   *  doorlopende showcase-vaart te blijven volgen. */
  targetWaypointId: string | null;
  /** Optioneel: hierin wordt elke frame de live wereldpositie van het schip
   *  gekopieerd — gebruikt door FixedExpeditionAudio om de koude wind luider
   *  te maken naarmate het schip dichter bij Antarctica vaart. */
  livePositionRef?: RefObject<THREE.Vector3>;
}) {
  const { scene } = useGLTF(BELGICA_MODEL_URL);
  const model = useMemo(() => scene.clone(true), [scene]);
  const groupRef = useRef<THREE.Group>(null);

  const belgicaExpedition = useMemo(() => expeditions.find((expedition) => expedition.id === "belgica"), []);
  const waypoints = belgicaExpedition?.waypoints ?? [];

  // Dezelfde punten als de zichtbare routelijn zelf (RouteLine/useRoutePoints)
  // — het schip "rijdt" dus letterlijk exact over de getekende lijn, geen
  // aparte/afwijkende hoogteberekening meer nodig.
  const points = useRoutePoints(radius, waypoints);

  // Fractie (0–1) langs de route waar het geselecteerde hotspot zich bevindt
  // — hotspots liggen evenredig verdeeld over de waypoint-volgorde, dus de
  // index van het waypoint in de lijst volstaat als schatting.
  const targetProgress = useMemo(() => {
    if (!targetWaypointId || waypoints.length < 2) return null;
    const index = waypoints.findIndex((waypoint) => waypoint.id === targetWaypointId);
    if (index < 0) return null;
    return index / (waypoints.length - 1);
  }, [targetWaypointId, waypoints]);

  const progressRef = useRef(0);
  // Vaarrichting tijdens de doorlopende showcase-vaart: 1 = op weg naar
  // Antarctica, -1 = op de terugreis. Wisselt vanzelf bij het bereiken van
  // beide uiteinden van de route (zie useFrame hieronder).
  const ambientDirectionRef = useRef(1);
  // Laatst bekende bewegingsrichting (los van de modus) — nodig om de boeg
  // ook correct om te draaien wanneer er ACTIEF teruggevaren wordt naar een
  // eerder hotspot (targetProgress < huidige progress).
  const headingSignRef = useRef(1);

  // Automatisch schalen + verzink-offset — puur gebaseerd op de bounding box
  // van het model zelf, dus onafhankelijk van waar het schip zich op de
  // route bevindt. Zelfde "in het water verzonken"-truc als voorheen: i.p.v.
  // de kiel exact op het oppervlak te leggen, leggen we het punt op
  // SHIP_SUBMERGE_FRACTION van de romphoogte op het oppervlak, zodat het
  // onderste stuk van de romp letterlijk het reliëf-mesh insteekt.
  const { scale, baseOffset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z) || 1;
    const computedScale = SHIP_MODEL_TARGET_SIZE / largestDimension;
    const hullHeight = size.y || 1;
    const waterlineLocalY = box.min.y + hullHeight * SHIP_SUBMERGE_FRACTION;
    return { scale: computedScale, baseOffset: -waterlineLocalY };
  }, [model]);

  useEffect(() => {
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.raycast = () => {};
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = fadeOpacity;
        material.depthWrite = fadeOpacity > 0.98;
      }
    });
  }, [model, fadeOpacity]);

  // Elke frame: bereken hoe ver het schip nu langs de route staat, en
  // plaats/oriënteer de group daarop — exact dezelfde tangent-vlak-
  // uitlijning als RouteFlowArrow, maar dan toegepast op de eigen
  // "omhoog"/"boeg"-assen van het scheepsmodel (SHIP_LOCAL_UP/FORWARD).
  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || points.length < 2) return;

    const previousProgress = progressRef.current;

    if (targetProgress === null) {
      // Geen hotspot geselecteerd: trage, doorlopende showcase-vaart die
      // heen-en-weer pendelt tussen Antwerpen (0) en Antarctica (1) — bij
      // het bereiken van een uiteinde keert het schip gewoon om, i.p.v. een
      // harde teleport-sprong terug naar het begin.
      progressRef.current += ambientDirectionRef.current * (delta / SHIP_AMBIENT_VOYAGE_DURATION);
      if (progressRef.current >= 1) {
        progressRef.current = 1;
        ambientDirectionRef.current = -1;
      } else if (progressRef.current <= 0) {
        progressRef.current = 0;
        ambientDirectionRef.current = 1;
      }
    } else {
      // Wél een hotspot geselecteerd: actief ernaartoe varen (kan ook
      // "terugvaren" zijn als een eerder punt op de route werd gekozen).
      progressRef.current = stepTowards(
        progressRef.current,
        targetProgress,
        delta * SHIP_SAIL_TO_HOTSPOT_SPEED
      );
    }

    // Onthoud in welke richting het schip daadwerkelijk beweegt (voorwaarts
    // of achterwaarts langs de route) — bepaalt zo dadelijk of de boeg moet
    // omdraaien. Bij (bijna) geen beweging (net aangekomen) houden we de
    // laatst bekende richting aan, zodat de boeg niet blijft "trillen".
    const movementDelta = progressRef.current - previousProgress;
    if (Math.abs(movementDelta) > 1e-6) {
      headingSignRef.current = Math.sign(movementDelta);
    }

    const { position, tangent } = samplePolyline(points, progressRef.current);
    const normal = position.clone().normalize();
    // De raaklijn van samplePolyline wijst altijd "voorwaarts" langs de
    // route (richting Antarctica); bij achterwaartse vaart draaien we 'm om,
    // zodat de boeg ook echt de kant op wijst waar het schip heen vaart.
    const travelTangent = tangent.clone().multiplyScalar(headingSignRef.current);
    const tangentOnSurface = travelTangent.sub(normal.clone().multiplyScalar(travelTangent.dot(normal)));

    if (tangentOnSurface.lengthSq() > 1e-8) {
      tangentOnSurface.normalize();
      // Bouw de rotatie zo dat SHIP_LOCAL_UP (standaard lokaal +Y) op de
      // oppervlaktenormaal uitkomt, en SHIP_LOCAL_FORWARD (standaard +Z) op
      // de vaarrichting — dezelfde assen-conventie als de eenmalige
      // heading-berekening hiervoor, nu alleen per frame herberekend zodat
      // de boeg netjes meebuigt met elke bocht in de route.
      const shipRight = new THREE.Vector3().crossVectors(normal, tangentOnSurface).normalize();
      const orthoForward = new THREE.Vector3().crossVectors(shipRight, normal).normalize();
      const basis = new THREE.Matrix4().makeBasis(shipRight, normal, orthoForward);
      const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis);

      // De handmatig afgestelde correctiehoek (SHIP_HEADING_OFFSET) blijft
      // van toepassing, nu toegepast als extra twist om de normaal-as.
      const twist = new THREE.Quaternion().setFromAxisAngle(normal, SHIP_HEADING_OFFSET);
      group.quaternion.copy(twist.multiply(baseQuaternion));
    }

    group.position.copy(position);
    livePositionRef?.current?.copy(position);
  });

  if (!belgicaExpedition || points.length < 2) return null;

  return (
    <group ref={groupRef} scale={scale}>
      <primitive object={model} position={[0, baseOffset, 0]} />
    </group>
  );
}

/* ============================================================================
 * CINEMATISCHE CAMERA-CONTROLLER (Mapbox-achtige "fly to")
 * ==========================================================================*/

/** Minimale interface — we hebben alleen deze velden van OrbitControls nodig,
 * zodat dit bestand niet hard gekoppeld is aan één specifiek drei-type.
 * De ref uit `<OrbitControls ref={controlsRef} />` in IceGlobe.tsx voldoet
 * hier automatisch aan. */
export interface OrbitControlsLike {
  target: THREE.Vector3;
  autoRotate: boolean;
  enabled: boolean;
  update: () => void;
}

interface CameraRigProps {
  focusPoint: THREE.Vector3 | null;
  controlsRef: RefObject<OrbitControlsLike | null>;
  defaultDistance?: number;
  focusDistance?: number;
  duration?: number; // seconden
}

export function CameraRig({
  focusPoint,
  controlsRef,
  defaultDistance = 5.6,
  focusDistance = 2.5,
  duration = 1.15,
}: CameraRigProps) {
  const { camera } = useThree();

  const anim = useRef({
    active: false,
    elapsed: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  });

  // Nieuwe animatie starten zodra het focuspunt wijzigt — ook wanneer het
  // terugvalt naar `null` (bv. bij het sluiten van een paneel of het
  // switchen van expeditie): dan vliegt de camera netjes terug naar de overview.
  useEffect(() => {
    const a = anim.current;
    a.elapsed = 0;
    a.active = true;
    a.fromPos.copy(camera.position);
    a.fromTarget.copy(controlsRef.current?.target ?? new THREE.Vector3());

    if (focusPoint) {
      const dir = focusPoint.clone().normalize();
      a.toPos.copy(dir.multiplyScalar(focusDistance));
      a.toTarget.copy(focusPoint);
    } else {
      a.toPos.set(0, 0, defaultDistance);
      a.toTarget.set(0, 0, 0);
    }

    if (controlsRef.current) {
      controlsRef.current.enabled = false;
      controlsRef.current.autoRotate = false;
    }
  }, [focusPoint, camera, controlsRef, defaultDistance, focusDistance]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a.active) return;

    a.elapsed += delta;
    const t = Math.min(a.elapsed / duration, 1);
    const eased = easeInOutCubic(t);

    camera.position.lerpVectors(a.fromPos, a.toPos, eased);

    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(a.fromTarget, a.toTarget, eased);
      controlsRef.current.update();
    } else {
      camera.lookAt(a.toTarget);
    }

    if (t >= 1) {
      a.active = false;
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
        controlsRef.current.autoRotate = !focusPoint;
      }
    }
  });

  return null;
}

/* ============================================================================
 * INFO-PANEEL — HTML-overlay bovenop de Canvas
 * ==========================================================================*/

/* ============================================================================
 * PUBLIEK COMPONENT
 * ==========================================================================*/

/** Geselecteerd waypoint + de accentkleur van zijn expeditie samen — zo kan
 *  de (buiten de Canvas levende) infokaart in page.tsx exact dezelfde kleur
 *  gebruiken als de hotspot/route zelf, zonder zelf in `expeditions` te
 *  hoeven opzoeken bij welke expeditie een waypoint hoort. */
export interface SelectedWaypoint {
  waypoint: ExpeditionWaypoint;
  accentColor: string;
}

export interface ExpeditionRouteProps {
  /** Straal van de IceGlobe-bol — moet overeenkomen met de sphereGeometry-radius (1.55). */
  radius?: number;
  /** Ref naar de OrbitControls-instantie uit IceGlobe.tsx. */
  controlsRef: RefObject<OrbitControlsLike | null>;
  /** Welke expeditie (uit `expeditions`) momenteel getoond moet worden. */
  activeExpeditionId: string;
  /** Naar de ouder-component doorgeven welk waypoint actief is — de infokaart
   *  zelf leeft NIET meer in de 3D-scène (zie ExpeditionRoute.tsx-historie:
   *  die kon meebewegen met de camera zodra die om een waypoint draaide in
   *  plaats van om het middelpunt). De ouder rendert 'm als gewoon 2D-DOM-
   *  element, volledig buiten de Canvas. */
  onActiveChange?: (selected: SelectedWaypoint | null) => void;
}

/** Methoden die de ouder-component van buiten de Canvas kan aanroepen. */
export interface ExpeditionRouteHandle {
  /** Sluit een eventueel geselecteerd waypoint: camera vliegt terug naar de
   *  overview, marker-pulse stopt. Bedoeld voor de sluitknop van de externe
   *  (DOM-)infokaart. */
  closeWaypoint: () => void;
}

/**
 * FixedExpeditionAudio
 * ----------------------------------------------------------------------------
 * Zelfde sfeergeluid-aanpak als "Bouw je eigen expeditie" (zie
 * CustomExpedition.tsx), nu voor de drie vaste expedities — zodat de
 * Belgica, Koning Boudewijnbasis én Prinses Elisabeth Antarctica precies
 * dezelfde zintuiglijke ervaring krijgen:
 *   - Zee-ambiance als constante basislaag, zolang er een expeditie getoond
 *     wordt (volume volgt automatisch de bestaande crossfade-`fadeOpacity`
 *     tussen expedities — audio en beeld faden dus altijd synchroon).
 *   - Een zachte, constante koude-windlaag bij de twee Antarctica-
 *     basisexpedities (Koning Boudewijnbasis, Prinses Elisabeth) — de
 *     Belgica blijft puur op zee-ambiance, passend bij een schipreis.
 *   - Een korte havengeluid-vlaag telkens wanneer de bezoeker een nieuwe
 *     hotspot selecteert.
 * Stopt direct en volledig zodra dit component ontkoppeld wordt (bv. de
 * bezoeker schakelt over naar "Bouw je eigen expeditie" — ExpeditionRoute
 * wordt dan in IceGlobe.tsx niet meer gerenderd) — geen geluid dat blijft
 * doorlopen als je van modus wisselt.
 */
/** Hoe dichtbij Antarctica een breedtegraad "voelt", als factor 0–1. Vanaf
 *  ongeveer -55° zuiderbreedte begint het geleidelijk op te bouwen; op -70°
 *  (grofweg de pakijsgrens) zit het al op volle sterkte. Puur op breedtegraad
 *  gebaseerd — eenvoudig, en precies genoeg voor een sfeer-effect. */
function antarcticaProximityFactor(lat: number): number {
  const START_LAT = -55;
  const FULL_LAT = -70;
  if (lat >= START_LAT) return 0;
  if (lat <= FULL_LAT) return 1;
  return (START_LAT - lat) / (START_LAT - FULL_LAT);
}

function FixedExpeditionAudio({
  expeditionId,
  fadeOpacity,
  selectedWaypointId,
  shipPositionRef,
}: {
  expeditionId: string;
  fadeOpacity: number;
  selectedWaypointId: string | null;
  /** Live wereldpositie van het Belgica-scheepsmodel (zie BelgicaShipModel)
   *  — blijft (0,0,0) zolang er geen schip actief is. */
  shipPositionRef: RefObject<THREE.Vector3>;
}) {
  const sea = useFadingTrack(AUDIO_SEA_AMBIENCE, true);
  const harbour = useFadingTrack(AUDIO_HARBOUR_DEPARTURE, false);
  const wind = useFadingTrack(AUDIO_COLD_WIND, true);

  // Alleen de twee Antarctica-basisexpedities krijgen sowieso een basisniveau
  // wind — de Belgica bouwt zijn windsterkte volledig op uit de live positie
  // van het schip zelf (zie hieronder).
  const hasIcyAmbience = expeditionId === "koning-boudewijnbasis" || expeditionId === "prinses-elisabeth";

  // Breedtegraad van het geselecteerde hotspot, indien van toepassing — voor
  // Koning Boudewijnbasis/Prinses Elisabeth is er geen varend schip, dus
  // gebruiken we welke locatie de bezoeker net bekijkt als beste indicator
  // van "hoe dicht bij Antarctica".
  const selectedWaypointLat = useMemo(() => {
    if (!selectedWaypointId) return null;
    for (const expedition of expeditions) {
      const waypoint = expedition.waypoints.find((w) => w.id === selectedWaypointId);
      if (waypoint) return waypoint.lat;
    }
    return null;
  }, [selectedWaypointId]);

  useFrame(() => {
    // `fadeOpacity` komt rechtstreeks van dezelfde crossfade die de route/
    // markers ook gebruiken bij het wisselen van expeditie — dus het geluid
    // faadt altijd exact synchroon mee met het beeld, zonder los te lopen.
    sea.setVolume(AUDIO_SEA_VOLUME * fadeOpacity);

    let proximity = 0;
    if (expeditionId === "belgica") {
      // Koude wind volgt de daadwerkelijke, live positie van het schip: vaart
      // het richting Bellingshausenzee/Poolnacht, dan zwelt de wind aan; op
      // de terugreis richting Antwerpen ebt hij weer weg — precies zoals bij
      // "Bouw je eigen expeditie".
      const shipPosition = shipPositionRef.current;
      if (shipPosition && shipPosition.lengthSq() > 0.001) {
        const { lat } = vector3ToLatLon(shipPosition);
        proximity = antarcticaProximityFactor(lat);
      }
    } else if (hasIcyAmbience) {
      // Basisniveau (het zijn nu eenmaal Antarctische stations) plus een
      // extra boost zodra de bezoeker specifiek een hotspot dicht bij de
      // pool bekijkt.
      const baseline = 0.55;
      const selectionBoost = selectedWaypointLat !== null ? antarcticaProximityFactor(selectedWaypointLat) : 0;
      proximity = Math.max(baseline, selectionBoost);
    }

    wind.setVolume(proximity * AUDIO_WIND_PEAK_VOLUME * fadeOpacity);
  });

  // Korte havengeluid-vlaag bij elke nieuwe hotspot-selectie.
  const previousWaypointIdRef = useRef<string | null>(null);
  useEffect(() => {
    const isNewSelection = selectedWaypointId !== null && selectedWaypointId !== previousWaypointIdRef.current;
    previousWaypointIdRef.current = selectedWaypointId;
    if (!isNewSelection) return;

    harbour.setVolume(AUDIO_HARBOUR_PEAK_VOLUME * 0.7 * fadeOpacity);
    const timeout = window.setTimeout(() => harbour.setVolume(0), 2200);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWaypointId]);

  // Vangnet: direct en volledig stoppen zodra dit component ontkoppeld wordt
  // (bv. overschakelen naar "Bouw je eigen expeditie") — geen nagalmend geluid.
  useEffect(() => {
    return () => {
      sea.stopImmediately();
      harbour.stopImmediately();
      wind.stopImmediately();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

const ExpeditionRoute = forwardRef<ExpeditionRouteHandle, ExpeditionRouteProps>(function ExpeditionRoute(
  { radius = 1.55, controlsRef, activeExpeditionId, onActiveChange },
  ref
) {
  const [selected, setSelected] = useState<ExpeditionWaypoint | null>(null);
  // Gedeelde live positie van het Belgica-scheepsmodel — FixedExpeditionAudio
  // leest hieruit de breedtegraad af om de koude wind luider te maken
  // naarmate het schip dichter bij Antarctica vaart. Blijft (0,0,0) zolang
  // er geen schip actief is (Koning Boudewijnbasis/Prinses Elisabeth).
  const shipPositionRef = useRef(new THREE.Vector3());

  // `displayedExpeditionId` is wat er ECHT gerenderd wordt; `activeExpeditionId`
  // (prop) is waar we NAARTOE willen. Het verschil daartussen drijft de fade.
  const [displayedExpeditionId, setDisplayedExpeditionId] = useState(activeExpeditionId);
  const [fadeOpacity, setFadeOpacity] = useState(1);
  const fadeState = useRef<{ phase: "idle" | "out" | "in"; t: number }>({ phase: "idle", t: 0 });

  // Zodra de gebruiker een andere expeditie kiest: sluit een eventueel open
  // paneel (camera vliegt vanzelf terug naar de overview) en start de fade.
  useEffect(() => {
    if (activeExpeditionId === displayedExpeditionId) return;
    setSelected(null);
    onActiveChange?.(null);
    fadeState.current = { phase: "out", t: 0 };
  }, [activeExpeditionId, displayedExpeditionId, onActiveChange]);

  useFrame((_, delta) => {
    const f = fadeState.current;
    if (f.phase === "idle") return;

    f.t += delta / FADE_DURATION;
    const eased = easeInOutCubic(Math.min(f.t, 1));

    if (f.phase === "out") {
      setFadeOpacity(1 - eased);
      if (f.t >= 1) {
        // Pas ná het volledig wegfaden de daadwerkelijke data wisselen —
        // zo lopen de oude en nieuwe route nooit door elkaar heen.
        setDisplayedExpeditionId(activeExpeditionId);
        f.phase = "in";
        f.t = 0;
      }
    } else if (f.phase === "in") {
      setFadeOpacity(eased);
      if (f.t >= 1) {
        f.phase = "idle";
        setFadeOpacity(1);
      }
    }
  });

  const displayedExpedition = useMemo(
    () => expeditions.find((expedition) => expedition.id === displayedExpeditionId) ?? expeditions[0],
    [displayedExpeditionId]
  );

  const focusPoint = useMemo(
    () => (selected ? latLonToVector3(selected.lat, selected.lon, radius + ROUTE_ALTITUDE) : null),
    [selected, radius]
  );

  const handleSelect = (waypoint: ExpeditionWaypoint) => {
    setSelected((current) => {
      // Nogmaals op dezelfde marker klikken deselecteert (camera zoomt terug uit).
      const next = current?.id === waypoint.id ? null : waypoint;
      onActiveChange?.(next ? { waypoint: next, accentColor: displayedExpedition.accentColor } : null);
      return next;
    });
  };

  const handleClose = () => {
    setSelected(null);
    onActiveChange?.(null);
  };

  useImperativeHandle(ref, () => ({ closeWaypoint: handleClose }), []);

  return (
    <group>
      <RouteLine
        radius={radius}
        waypoints={displayedExpedition.waypoints}
        color={displayedExpedition.accentColor}
        fadeOpacity={fadeOpacity}
      />

      {displayedExpedition.waypoints.map((waypoint) => (
        <WaypointMarker
          key={waypoint.id}
          waypoint={waypoint}
          radius={radius}
          isSelected={selected?.id === waypoint.id}
          onSelect={handleSelect}
          fadeOpacity={fadeOpacity}
          color={displayedExpedition.accentColor}
        />
      ))}

      {/* 3D-model van het schip zelf — enkel gemount in deze modus, dus
          automatisch verborgen zodra er naar een andere expeditie geswitcht
          wordt. Eigen Suspense-grens, zelfde reden als bij het stationsmodel. */}
      {displayedExpeditionId === "belgica" && (
        <Suspense fallback={null}>
          <BelgicaShipModel
            radius={radius}
            fadeOpacity={fadeOpacity}
            targetWaypointId={selected?.id ?? null}
            livePositionRef={shipPositionRef}
          />
        </Suspense>
      )}

      {/* 3D-model van het stationsgebouw — enkel gemount op de Prinses
          Elisabeth-route (groen), bij de laatste stop van die route. Eigen
          Suspense-grens: als het (relatief grote) .glb-bestand nog laadt,
          blokkeert dat niet de rest van de globe/route. */}
      {displayedExpeditionId === "prinses-elisabeth" && (
        <Suspense fallback={null}>
          <AntarcticStationModel radius={radius} fadeOpacity={fadeOpacity} />
        </Suspense>
      )}

      {/* Sfeergeluid — volgt automatisch dezelfde fadeOpacity als de route/
          markers hierboven, dus audio en beeld faden altijd synchroon mee bij
          het wisselen van expeditie. Stopt direct zodra dit hele component
          ontkoppeld wordt (bv. overschakelen naar "Bouw je eigen expeditie"). */}
      <FixedExpeditionAudio
        expeditionId={displayedExpeditionId}
        fadeOpacity={fadeOpacity}
        selectedWaypointId={selected?.id ?? null}
        shipPositionRef={shipPositionRef}
      />

      <CameraRig focusPoint={focusPoint} controlsRef={controlsRef} />
    </group>
  );
});

export default ExpeditionRoute;