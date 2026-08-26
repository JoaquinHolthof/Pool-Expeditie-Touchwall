"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import {
  CameraRig,
  ROUTE_ALTITUDE,
  SEGMENTS_PER_LEG,
  easeInOutCubic,
  latLonToVector3,
  samplePolyline,
  slerpOnSphere,
  type OrbitControlsLike,
} from "./ExpeditionRoute";
import {
  AUDIO_SEA_AMBIENCE,
  AUDIO_HARBOUR_DEPARTURE,
  AUDIO_COLD_WIND,
  AUDIO_SEA_VOLUME,
  AUDIO_HARBOUR_PEAK_VOLUME,
  AUDIO_WIND_PEAK_VOLUME,
  useFadingTrack,
} from "./ExpeditionAudio";

/**
 * "Bouw je eigen expeditie" — Custom Route Creator
 * ----------------------------------------------------------------------------
 * Zelfstandig 3D-onderdeel, los van de vaste expedities in ExpeditionRoute.tsx.
 * Hergebruikt bewust dezelfde technieken die daar al bewezen werken:
 *   - `latLonToVector3` / `slerpOnSphere` voor de route-geometrie
 *   - `samplePolyline` + tangentvlak-uitlijning voor het reizende voertuig
 *     (exact dezelfde aanpak als BelgicaShipModel)
 *   - `CameraRig` voor het "aankomst"-shot zodra het voertuig arriveert
 *
 * Nieuw t.o.v. de vaste expedities:
 *   - Een LIVE camera die het voertuig tijdens de reis blijft volgen
 *     (i.p.v. één keer naar een vast punt vliegen)
 *   - Configureerbare vervoermiddelen (historisch schip / modern poolschip /
 *     vliegtuig), elk met hun eigen 3D-model, snelheid en vlieghoogte
 *   - Een foutbestendige model-loader: ontbreekt een .glb-bestand (bv. omdat
 *     "modern poolschip"/"vliegtuig" nog geen echt model heeft), dan valt de
 *     component terug op een simpele placeholder-vorm i.p.v. te crashen.
 */

// ---------------------------------------------------------------------------
// Vaste start- en eindpunten
// ---------------------------------------------------------------------------

/** Vertrek: Antwerpen — dezelfde haven als de Belgica-expeditie, logisch als
 *  "thuisbasis" voor elke zelfgebouwde reis. */
export const CUSTOM_ROUTE_START = { lat: 51.2213, lon: 4.4051 };

/** Aankomst: een neutraal, al eerder gevalideerd veilig oceaanpunt vlak bij
 *  Antarctica (Bellingshausenzee) — bewust niet gekoppeld aan één specifiek
 *  station, want dit is de reis van de bezoeker zelf. */
export const CUSTOM_ROUTE_DESTINATION = { lat: -70.5, lon: -85.0 };

export interface CustomRoutePoint {
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Vervoermiddelen
// ---------------------------------------------------------------------------

export type TransportId = "historic-ship";

export interface TransportConfig {
  id: TransportId;
  /** Pad in /public — zelfde patroon als BELGICA_MODEL_URL in ExpeditionRoute.tsx. */
  modelUrl: string;
  targetSize: number;
  headingOffset: number;
  /** 0 voor een vliegtuig (dat vliegt boven het oppervlak i.p.v. erin te liggen). */
  submergeFraction: number;
  /** Extra hoogte boven de normale route-hoogte — 0 voor schepen, een
   *  duidelijke waarde voor het vliegtuig zodat het zichtbaar "vliegt". */
  flightAltitude: number;
  /** Fictieve/gemiddelde snelheid, gebruikt om de reisduur in het
   *  expeditierapport te berekenen. */
  speedKmh: number;
}

export const TRANSPORTS: TransportConfig[] = [
  {
    id: "historic-ship",
    modelUrl: "/assets/belgica.glb",
    targetSize: 0.1,
    headingOffset: Math.PI / 2,
    submergeFraction: 0.08,
    flightAltitude: 0,
    speedKmh: 15,
  },
];

/** Er is bewust maar één vervoermiddel: het klassieke schip. Modern
 *  poolschip/vliegtuig zijn eruit gehaald — die pasten niet bij het
 *  historische thema van de touchwall. */
export const DEFAULT_TRANSPORT = TRANSPORTS[0];

// ---------------------------------------------------------------------------
// Sfeergeluid tijdens de eigen expeditie
// ---------------------------------------------------------------------------
// De eigenlijke audio-infrastructuur (paden, volumes, de useFadingTrack-hook)
// is verplaatst naar ExpeditionAudio.tsx — gedeeld met de vaste expedities in
// ExpeditionRoute.tsx, zodat beide systemen zich exact hetzelfde gedragen.

/**
 * CustomExpeditionAudio
 * ----------------------------------------------------------------------------
 * Regelt de hele soundtrack van de eigen expeditie in drie lagen:
 *   1. Havengeluid — kort bij vertrek (~4s), en nog eens kort telkens als het
 *      voertuig een mijlpaal passeert.
 *   2. Zee-ambiance — de constante basislaag zolang er gevaren wordt.
 *   3. Koude wind — bouwt vanaf ~40% van de reis geleidelijk op, als "het
 *      wordt kouder en heftiger richting Antarctica"-effect.
 * Bij aankomst faden harbour/wind weg en blijft er nog even zachte zee over;
 * wordt de expeditie gesloten (component unmount, zie CustomExpeditionRoute
 * hieronder), dan stopt alles DIRECT — geen nagalmend geluid terug in het
 * hoofdmenu.
 */
function CustomExpeditionAudio({
  phase,
  progressRef,
  milestoneNonce,
}: {
  phase: "traveling" | "arrived";
  progressRef: RefObject<number>;
  /** Verhoogt bij elke gepasseerde mijlpaal — triggert een korte, subtiele
   *  vlaag havengeluid, ook halverwege de reis. */
  milestoneNonce: number;
}) {
  const sea = useFadingTrack(AUDIO_SEA_AMBIENCE, true);
  const harbour = useFadingTrack(AUDIO_HARBOUR_DEPARTURE, false);
  const wind = useFadingTrack(AUDIO_COLD_WIND, true);

  const departureElapsedRef = useRef(0);
  const hasDepartedRef = useRef(false);

  // Faseovergangen: vertrek (harbour + zee aan) en aankomst (harbour/wind uit,
  // zee blijft nog heel zacht door).
  useEffect(() => {
    if (phase === "traveling") {
      hasDepartedRef.current = false;
      departureElapsedRef.current = 0;
      harbour.setVolume(AUDIO_HARBOUR_PEAK_VOLUME);
      sea.setVolume(AUDIO_SEA_VOLUME);
    } else if (phase === "arrived") {
      harbour.setVolume(0);
      wind.setVolume(0);
      sea.setVolume(AUDIO_SEA_VOLUME * 0.5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Doorlopende opbouw tijdens het varen: havengeluid sterft na een paar
  // seconden vertrek vanzelf uit, wind bouwt geleidelijk op naarmate de reis
  // vordert (kouder/heftiger richting Antarctica), zee dempt daarbij iets.
  useFrame((_, delta) => {
    if (phase !== "traveling") return;

    if (!hasDepartedRef.current) {
      departureElapsedRef.current += delta;
      if (departureElapsedRef.current > 4) {
        hasDepartedRef.current = true;
        harbour.setVolume(0);
      }
    }

    const progress = progressRef.current ?? 0;
    const windProgress = THREE.MathUtils.clamp((progress - 0.4) / 0.5, 0, 1);
    wind.setVolume(windProgress * AUDIO_WIND_PEAK_VOLUME);
    sea.setVolume(AUDIO_SEA_VOLUME * (1 - 0.4 * windProgress));
  });

  // Mijlpaal gepasseerd: een korte, subtiele vlaag havengeluid — ook
  // halverwege de reis, als je toevallig langs een kuststip vaart.
  const previousMilestoneNonceRef = useRef(milestoneNonce);
  useEffect(() => {
    if (milestoneNonce === previousMilestoneNonceRef.current) return;
    previousMilestoneNonceRef.current = milestoneNonce;
    if (phase !== "traveling") return;
    harbour.setVolume(AUDIO_HARBOUR_PEAK_VOLUME * 0.7);
    const timeout = window.setTimeout(() => harbour.setVolume(0), 2200);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestoneNonce, phase]);

  // Vangnet: zodra dit component om welke reden dan ook verdwijnt (de eigen
  // expeditie wordt gesloten/gereset — zie de vroege "resetting"-return in
  // CustomExpeditionRoute hieronder, die dit component niet meer rendert),
  // stopt alles DIRECT. Geen fade, geen nagalm terug in het hoofdmenu.
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

// ---------------------------------------------------------------------------
// Foutbestendige GLTF-loader (geen Suspense/crash bij een ontbrekend bestand)
// ---------------------------------------------------------------------------

const gltfLoader = new GLTFLoader();

/** Laadt een .glb-bestand handmatig (buiten Suspense om) en geeft `null`
 *  terug als het bestand ontbreekt of niet valide is — de aanroepende
 *  component kan dan gewoon een placeholder tonen i.p.v. te crashen. */
function useOptionalGLTF(url: string): THREE.Group | null {
  const [scene, setScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    let cancelled = false;
    setScene(null);
    gltfLoader.load(
      url,
      (gltf) => {
        if (!cancelled) setScene(gltf.scene);
      },
      undefined,
      () => {
        // Laden mislukt (bestand ontbreekt, ongeldig, ...) — stil terugvallen
        // op de placeholder-geometrie in CustomExpeditionVehicle.
        if (!cancelled) setScene(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return scene;
}

// ---------------------------------------------------------------------------
// Route-geometrie
// ---------------------------------------------------------------------------

function useCustomRoutePolyline(radius: number, waypoints: CustomRoutePoint[]): THREE.Vector3[] {
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

// ---------------------------------------------------------------------------
// Het reizende voertuig
// ---------------------------------------------------------------------------

function CustomExpeditionVehicle({
  transport,
  points,
  isTraveling,
  onArrive,
  livePositionRef,
  progressRef,
  milestoneFractions,
  onPassMilestone,
}: {
  transport: TransportConfig;
  points: THREE.Vector3[];
  isTraveling: boolean;
  onArrive: () => void;
  livePositionRef: RefObject<THREE.Vector3>;
  /** Gedeelde voortgangs-ref (0–1) — ook gebruikt door CustomExpeditionAudio
   *  om de windgeluid-opbouw op te baseren, dus hier bewust NIET een eigen
   *  lokale ref, maar eentje die de ouder (CustomExpeditionRoute) aanmaakt
   *  en aan beide doorgeeft. */
  progressRef: RefObject<number>;
  /** Voortgangsfracties (0–1) van elke mijlpaal langs de route — bv. [0, 0.33,
   *  0.66, 1] voor start + twee aangeklikte punten + bestemming. */
  milestoneFractions: number[];
  /** Vuurt precies één keer per mijlpaal, op het moment dat het voertuig
   *  er voorbij vaart (niet bij het opnieuw doorlopen van dezelfde fractie). */
  onPassMilestone: (index: number) => void;
}) {
  const scene = useOptionalGLTF(transport.modelUrl);
  const model = useMemo(() => (scene ? scene.clone(true) : null), [scene]);
  const groupRef = useRef<THREE.Group>(null);
  const arrivedRef = useRef(false);
  const passedMilestonesRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    // Nieuw vervoermiddel/nieuwe reis → altijd weer bij het vertrekpunt beginnen.
    progressRef.current = 0;
    arrivedRef.current = false;
    passedMilestonesRef.current = new Set();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport.id, points]);

  const { scale, baseOffset } = useMemo(() => {
    if (!model) return { scale: 1, baseOffset: 0 };
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const largestDimension = Math.max(size.x, size.y, size.z) || 1;
    const computedScale = transport.targetSize / largestDimension;
    const hullHeight = size.y || 1;
    const waterlineLocalY = box.min.y + hullHeight * transport.submergeFraction;
    return { scale: computedScale, baseOffset: -waterlineLocalY };
  }, [model, transport]);

  useEffect(() => {
    if (!model) return;
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Klikken moeten niet op het voertuig zelf kunnen landen.
      mesh.raycast = () => {};
    });
  }, [model]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || points.length < 2) return;

    const previousProgress = progressRef.current;

    if (isTraveling && !arrivedRef.current) {
      // Volledige (aangeklikte) route in ~16 seconden — lang genoeg om
      // cinematisch te ogen, kort genoeg om niet te gaan vervelen.
      const SAIL_DURATION = 16;
      progressRef.current = Math.min(1, progressRef.current + delta / SAIL_DURATION);
      if (progressRef.current >= 1 && !arrivedRef.current) {
        arrivedRef.current = true;
        onArrive();
      }
    }

    // Mijlpaal gepasseerd? Vuur precies één keer per mijlpaal, op het moment
    // dat de voortgang er voorbij komt (niet als hij er al voorbij was).
    for (let index = 0; index < milestoneFractions.length; index++) {
      const fraction = milestoneFractions[index];
      if (
        !passedMilestonesRef.current.has(index) &&
        previousProgress < fraction &&
        progressRef.current >= fraction
      ) {
        passedMilestonesRef.current.add(index);
        onPassMilestone(index);
      }
    }

    const { position, tangent } = samplePolyline(points, progressRef.current);
    const normal = position.clone().normalize();
    if (transport.flightAltitude > 0) {
      position.add(normal.clone().multiplyScalar(transport.flightAltitude));
    }

    const tangentOnSurface = tangent.clone().sub(normal.clone().multiplyScalar(tangent.dot(normal)));
    if (tangentOnSurface.lengthSq() > 1e-8) {
      tangentOnSurface.normalize();
      const right = new THREE.Vector3().crossVectors(normal, tangentOnSurface).normalize();
      const orthoForward = new THREE.Vector3().crossVectors(right, normal).normalize();
      const basis = new THREE.Matrix4().makeBasis(right, normal, orthoForward);
      const baseQuaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
      const twist = new THREE.Quaternion().setFromAxisAngle(normal, transport.headingOffset);
      group.quaternion.copy(twist.multiply(baseQuaternion));
    }

    group.position.copy(position);
    livePositionRef.current?.copy(position);
  });

  return (
    <group ref={groupRef} scale={scale}>
      {model ? (
        <primitive object={model} position={[0, baseOffset, 0]} />
      ) : (
        // Placeholder zolang er geen geldig model geladen kon worden —
        // zorgt dat "modern poolschip"/"vliegtuig" nu al volledig werken,
        // ook zonder de echte .glb-bestanden.
        <mesh>
          <coneGeometry args={[0.55, 1.6, 7]} />
          <meshStandardMaterial color="#4b5563" roughness={0.55} metalness={0.1} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera-overzicht bij het starten van het plannen
// ---------------------------------------------------------------------------

/** Eenmalige camerabeweging zodra de bezoeker begint met punten plaatsen:
 *  rustig uitzoomen naar een overzichtelijke stand (in plaats van de vaak
 *  veel te dichtbij ingezoomde stand van een net gesloten hotspot-paneel),
 *  en daar blijven staan — bewust zónder auto-rotatie weer aan te zetten,
 *  zodat precies tikken makkelijk blijft. */
export function PlanningCameraRig({
  controlsRef,
  distance = 6.4,
  duration = 1.1,
}: {
  controlsRef: RefObject<OrbitControlsLike | null>;
  distance?: number;
  duration?: number;
}) {
  const { camera } = useThree();
  const anim = useRef({
    active: true,
    elapsed: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
  });

  useEffect(() => {
    const a = anim.current;
    a.elapsed = 0;
    a.active = true;
    a.fromPos.copy(camera.position);
    a.fromTarget.copy(controlsRef.current?.target ?? new THREE.Vector3());
    // Vanuit de huidige richting verder naar achteren — voelt natuurlijker
    // dan van camerastandpunt te wisselen.
    const direction =
      camera.position.lengthSq() > 0 ? camera.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
    a.toPos.copy(direction.multiplyScalar(distance));

    if (controlsRef.current) {
      controlsRef.current.enabled = false;
      controlsRef.current.autoRotate = false;
    }
  }, [controlsRef, distance]);

  useFrame((_, delta) => {
    const a = anim.current;
    if (!a.active) return;
    a.elapsed += delta;
    const t = Math.min(a.elapsed / duration, 1);
    const eased = easeInOutCubic(t);

    camera.position.lerpVectors(a.fromPos, a.toPos, eased);
    if (controlsRef.current) {
      controlsRef.current.target.lerpVectors(a.fromTarget, new THREE.Vector3(0, 0, 0), eased);
      controlsRef.current.update();
    }

    if (t >= 1) {
      a.active = false;
      if (controlsRef.current) {
        // Weer bedienbaar, maar bewust GEEN autoRotate — rustig laten staan
        // zolang er punten geplaatst worden.
        controlsRef.current.enabled = true;
      }
    }
  });

  return null;
}

// ---------------------------------------------------------------------------
// Directe visuele feedback bij het plaatsen van een punt
// ---------------------------------------------------------------------------

/** Eén geplaatst punt: een duidelijke pin met een korte "pop-in"-animatie
 *  zodra hij verschijnt, plus een zachte voortdurende pols — dezelfde taal
 *  als de bestaande hotspot-markers, nu in de bronzen accentkleur van de
 *  eigen route. */
function PlacementMarker({ radius, point }: { radius: number; point: CustomRoutePoint }) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ageRef = useRef(0);

  const position = useMemo(
    () => latLonToVector3(point.lat, point.lon, radius + ROUTE_ALTITUDE + 0.02),
    [point, radius]
  );
  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [position]);

  useFrame((_, delta) => {
    ageRef.current += delta;
    const group = groupRef.current;
    const ring = ringRef.current;
    if (!group) return;

    // Pop-in: snel van 0 naar iets voorbij 1 en terug naar 1 — voelt als een
    // "klik"-bevestiging in plaats van gewoon stil te verschijnen.
    const POP_DURATION = 0.35;
    const popT = Math.min(ageRef.current / POP_DURATION, 1);
    const overshoot = popT < 1 ? 1 + Math.sin(popT * Math.PI) * 0.3 * (1 - popT) : 1;
    group.scale.setScalar(easeInOutCubic(popT) * overshoot || 0.001);

    if (ring) {
      const pulse = 1 + Math.sin(ageRef.current * 2.6) * 0.15;
      ring.scale.setScalar(pulse);
    }
  });

  return (
    <group position={position} quaternion={quaternion} ref={groupRef} scale={0.001}>
      {/* Kernpunt */}
      <mesh>
        <circleGeometry args={[0.045, 24]} />
        <meshBasicMaterial color="#8a6d3b" depthWrite={false} />
      </mesh>
      {/* Pulserende ring — goed zichtbaar op afstand */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.062, 0.08, 32]} />
        <meshBasicMaterial color="#c9ad7a" transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Tijdens het plannen (nog vóór "Start Expeditie"): toont elk al geplaatst
 *  punt als duidelijke pin, verbonden met een dunne, gestippelde "concept"-
 *  lijn vanaf Antwerpen — zo ziet de bezoeker meteen "hé, hier zet ik nu een
 *  punt neer" én hoe de route zich vormt, zonder dat het al de definitieve,
 *  volle route-lijn is (die verschijnt pas zodra de reis start). */
export function CustomRoutePreview({ radius, points }: { radius: number; points: CustomRoutePoint[] }) {
  const chain = useMemo(() => [CUSTOM_ROUTE_START, ...points], [points]);
  const linePoints = useCustomRoutePolyline(radius, chain);

  return (
    <group>
      {chain.length >= 2 && (
        <>
          <Line points={linePoints} color="#8a6d3b" lineWidth={4} transparent opacity={0.18} depthWrite={false} />
          <Line
            points={linePoints}
            color="#c9ad7a"
            lineWidth={1.4}
            transparent
            opacity={0.8}
            depthWrite={false}
            dashed
            dashSize={0.04}
            gapSize={0.03}
          />
        </>
      )}
      {points.map((point, index) => (
        <PlacementMarker key={`${point.lat}-${point.lon}-${index}`} radius={radius} point={point} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera die het voertuig live volgt tijdens de reis
// ---------------------------------------------------------------------------

function CustomRouteCameraFollow({
  livePositionRef,
  controlsRef,
}: {
  livePositionRef: RefObject<THREE.Vector3>;
  controlsRef: RefObject<OrbitControlsLike | null>;
}) {
  const { camera } = useThree();

  useEffect(() => {
    // Tijdens het volgen neemt deze component de camera volledig over —
    // exact dezelfde aanpak als CameraRig gebruikt tijdens zijn fly-to.
    if (controlsRef.current) {
      controlsRef.current.enabled = false;
      controlsRef.current.autoRotate = false;
    }
    // Defensieve cleanup: mocht dit component abrupt verdwijnen (bv. de
    // bezoeker sluit de eigen expeditie midden in de vaart, vóór de
    // "resetting"-fase de kans krijgt om netjes over te nemen), dan blijft
    // OrbitControls nooit "voor altijd" uitgeschakeld staan.
    return () => {
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    };
  }, [controlsRef]);

  useFrame(() => {
    const target = livePositionRef.current;
    if (!target || target.lengthSq() === 0) return;
    const direction = target.clone().normalize();
    // Ruimer dan voorheen (was 2.4) — geeft tijdens het varen een mooi
    // overzicht van het schip mét een flink stuk omliggend continent/oceaan,
    // i.p.v. een té strak ingezoomde close-up.
    const desiredCameraPosition = direction.multiplyScalar(4.2);
    camera.position.lerp(desiredCameraPosition, 0.05);
    camera.lookAt(target);
  });

  return null;
}

// ---------------------------------------------------------------------------
// Publiek component
// ---------------------------------------------------------------------------

export type CustomRoutePhase = "traveling" | "arrived" | "resetting";

export function CustomExpeditionRoute({
  radius,
  clickedPoints,
  transport,
  phase,
  onArrive,
  onPassMilestone,
  controlsRef,
}: {
  radius: number;
  clickedPoints: CustomRoutePoint[];
  transport: TransportConfig;
  phase: CustomRoutePhase;
  onArrive: () => void;
  /** Vuurt telkens wanneer het voertuig een mijlpaal passeert — index in
   *  [start, ...clickedPoints, bestemming]. De UI-laag (page.tsx) toont
   *  hiermee de "je vaart nu langs..."-pop-up. */
  onPassMilestone: (index: number) => void;
  controlsRef: RefObject<OrbitControlsLike | null>;
}) {
  const waypoints = useMemo(
    () => [CUSTOM_ROUTE_START, ...clickedPoints, CUSTOM_ROUTE_DESTINATION],
    [clickedPoints]
  );
  const points = useCustomRoutePolyline(radius, waypoints);
  const livePositionRef = useRef(new THREE.Vector3());
  const progressRef = useRef(0);

  // Losse teller die alleen bijhoudt HOEVEEL mijlpalen er gepasseerd zijn
  // (niet welke) — de audio-regelaar gebruikt dit puur als trigger voor een
  // korte havengeluid-vlaag, los van de "je vaart nu langs..."-pop-up die
  // via `onPassMilestone` naar page.tsx gaat.
  const [milestoneNonce, setMilestoneNonce] = useState(0);
  const handlePassMilestone = (index: number) => {
    setMilestoneNonce((current) => current + 1);
    onPassMilestone(index);
  };

  // Elke mijlpaal (start, elk aangeklikt punt, bestemming) evenredig verdeeld
  // over [0, 1] — index i correspondeert met dezelfde volgorde als `waypoints`.
  const milestoneFractions = useMemo(
    () => (waypoints.length < 2 ? [] : waypoints.map((_, index) => index / (waypoints.length - 1))),
    [waypoints]
  );

  const destinationPoint = useMemo(
    () => latLonToVector3(CUSTOM_ROUTE_DESTINATION.lat, CUSTOM_ROUTE_DESTINATION.lon, radius + ROUTE_ALTITUDE),
    [radius]
  );

  // "resetting": de bezoeker heeft de eigen expeditie gesloten/geannuleerd.
  // Route en voertuig verdwijnen meteen; alleen de camera vliegt nog netjes
  // terug naar de standaard-overview (dezelfde CameraRig als overal elders),
  // zodat de volgende bezoeker met een schone lei — en een rustig
  // ronddraaiende globe — kan beginnen. Zie page.tsx: pas een fractie later
  // wordt deze component pas echt volledig ontkoppeld.
  if (phase === "resetting") {
    return <CameraRig focusPoint={null} controlsRef={controlsRef} />;
  }

  if (points.length < 2) return null;

  return (
    <group>
      {/* Zachte, warme koper/brons-gloed — historisch getint, geen paars —
          met dezelfde ijswitte kernlijn als de vaste expeditieroutes. */}
      <Line points={points} color="#8a6d3b" lineWidth={6} transparent opacity={0.22} depthWrite={false} />
      <Line points={points} color="#eaf4ff" lineWidth={1.8} transparent opacity={0.95} depthWrite={false} />

      <CustomExpeditionVehicle
        transport={transport}
        points={points}
        isTraveling={phase === "traveling"}
        onArrive={onArrive}
        livePositionRef={livePositionRef}
        progressRef={progressRef}
        milestoneFractions={milestoneFractions}
        onPassMilestone={handlePassMilestone}
      />

      {/* Sfeergeluid — enkel actief tijdens varen/aankomst; verdwijnt (en
          stopt dus direct, zie CustomExpeditionAudio's cleanup) zodra deze
          hele component ontkoppeld wordt via de "resetting"-fase hierboven. */}
      <CustomExpeditionAudio phase={phase} progressRef={progressRef} milestoneNonce={milestoneNonce} />

      {phase === "traveling" && (
        <CustomRouteCameraFollow livePositionRef={livePositionRef} controlsRef={controlsRef} />
      )}

      {/* Bij aankomst: hergebruik dezelfde cinematische "fly to"-camera als
          bij de vaste hotspots, nu gericht op het eindpunt van de eigen reis. */}
      {phase === "arrived" && <CameraRig focusPoint={destinationPoint} controlsRef={controlsRef} />}
    </group>
  );
}