"use client";

import { Suspense, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, useTexture } from "@react-three/drei";
import * as THREE from "three";
import ExpeditionRoute, {
  type ExpeditionRouteHandle,
  type SelectedWaypoint,
  type OrbitControlsLike,
  latLonToVector3,
  vector3ToLatLon,
} from "./ExpeditionRoute";
import { CustomExpeditionRoute, CustomRoutePreview, PlanningCameraRig, type CustomRoutePoint, type CustomRoutePhase, type TransportConfig } from "./CustomExpedition";

/**
 * IceGlobe
 * ----------------------------------------------------------------------------
 * Een monochrome, ijskoude 3D-reliëfglobe voor een museum-touchwall.
 *
 * - Drie gestapelde reliëflagen op dezelfde topografische bron:
 *   1) displacementMap  -> echte geometrie-verhoging (macro: bergketens/kustlijnen)
 *   2) normalMap        -> georiënteerd oppervlaktedetail (mid: continentcontouren)
 *   3) bumpMap          -> fijne randjes op de bergkammen zelf (micro)
 * - Gebalanceerd studio-lichtrig: genoeg richting voor reliëf-microschaduw,
 *   maar nooit een grote donkere "nachtkant" — de bol blijft overal leesbaar.
 * - Eén dun, strak ijsblauw randlichtje (Fresnel), correct geklemd.
 * - Een zachte, diffuse slagschaduw ÁCHTER de bol op de achtergrond (géén
 *   harde ring) — wekt het gevoel dat de globe vóór het scherm zweeft.
 * - Trage, continue auto-rotatie; op het touchwall gewoon met de vinger
 *   verder te draaien.
 */

// ---- Reliëf & materiaal ----------------------------------------------------
function TerrainGlobe({
  pickingActive,
  onPick,
}: {
  /** Actief tijdens "Bouw je eigen expeditie" → punten plaatsen. */
  pickingActive: boolean;
  /** `isOcean` geeft aan of het getikte punt op zee ligt — bij `false` heeft
   *  de aanroeper het punt geweigerd (dit component beslist zelf niet wat
   *  daarmee gebeurt, dat is aan de UI-laag in page.tsx). */
  onPick?: (lat: number, lon: number, isOcean: boolean) => void;
}) {
  // Topografische hoogtekaart (grayscale) => echte geometrie-verhoging.
  // Normal map => fijn, georiënteerd oppervlaktedetail bovenop die geometrie.
  const [displacementMap, normalMap] = useTexture([
    "https://unpkg.com/three-globe/example/img/earth-topology.png",
    "https://threejs.org/examples/textures/planets/earth_normal_2048.jpg",
  ]);

  // ---- Fix voor de zichtbare naad tijdens het draaien ----------------------
  // Beide textures zijn equirectangular: de linker- en rechterrand (u=0 en
  // u=1) zijn dezelfde lengtegraad en moeten dus naadloos op elkaar aansluiten.
  // Three.js gebruikt standaard `ClampToEdgeWrapping`, waardoor er op die naad
  // NIET gewrapt wordt maar geklemd — dat geeft een harde stap, zowel in de
  // displacement-geometrie (een letterlijke richel) als in de normal-map-
  // belichting (een harde licht/donker-overgang). `RepeatWrapping` laat de
  // rand weer echt in de andere rand overlopen, dus de naad verdwijnt volledig.
  useMemo(() => {
    for (const tex of [displacementMap, normalMap]) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
    }
  }, [displacementMap, normalMap]);

  // ---- Land/oceaan-detectie voor "Bouw je eigen expeditie" -----------------
  // Hergebruikt exact dezelfde hoogtekaart die het reliëf tekent: een
  // offscreen canvas waarop we die éénmalig natekenen, zodat we per klik
  // synchroon één pixel kunnen uitlezen.
  //
  // LET OP — dit was eerder fout: we gingen ervan uit dat de drempel waarop
  // displacementScale/-Bias de gemiddelde bolstraal snijden (~waarde 0,375)
  // ook meteen de land/zee-grens in de bróntextuur zou zijn. Dat bleek niet
  // zo te werken: die twee dingen hebben niets met elkaar te maken (de
  // scale/bias zijn puur voor het ogende reliëf gekozen, niet gekalibreerd
  // op deze textuur se werkelijke landgrenzen).
  //
  // We hebben de daadwerkelijke earth-topology.png (uit het three-globe-
  // pakket) opgehaald en pixelwaarden gemeten op bekende locaties: ALLE
  // getoetste oceanen (Atlantische/Grote/Indische Oceaan, Bellingshausenzee)
  // gaven exact 0. Land begint al bij waarde 1 (Amazone, Siberië, Centraal-
  // Europa, Australië liggen allemaal tussen 1–11; Sahara 31; Rocky
  // Mountains 99). 66,5% van alle pixels is exact 0 — vrijwel identiek aan
  // de werkelijke ~71% aardoppervlak dat water is. Dus: de enige correcte,
  // betrouwbare regel is "waarde === 0 → zee", niet een of andere fractie.
  const heightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const OCEAN_MAX_GRAY_VALUE = 0;

  useEffect(() => {
    const image = displacementMap.image as HTMLImageElement | undefined;
    if (!image || !image.width) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      heightCanvasRef.current = canvas;
    } catch {
      // Kon niet getekend worden (bv. CORS) — blijft `null`, sampleIsOcean
      // valt dan terug op "weigeren" i.p.v. de bezoeker per ongeluk overal
      // op te laten klikken (fail-safe in plaats van fail-open, want "land
      // mag niet aanklikbaar zijn" is hier de harde eis).
      heightCanvasRef.current = null;
    }
  }, [displacementMap]);

  function sampleIsOcean(lat: number, lon: number): boolean {
    const canvas = heightCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return false; // geen data beschikbaar -> uit voorzorg weigeren
    try {
      const colFraction = (lon + 180) / 360;
      const rowFraction = (90 - lat) / 180;
      const px = Math.min(canvas.width - 1, Math.max(0, Math.round(colFraction * (canvas.width - 1))));
      const py = Math.min(canvas.height - 1, Math.max(0, Math.round(rowFraction * (canvas.height - 1))));
      const [gray] = ctx.getImageData(px, py, 1, 1).data;
      return gray <= OCEAN_MAX_GRAY_VALUE;
    } catch {
      return false; // kon niet uitgelezen worden -> uit voorzorg weigeren
    }
  }

  // Tik-vs-sleep-detectie: alleen als de aanraking nauwelijks bewogen heeft
  // tussen indrukken en loslaten telt het als "punt plaatsen". Zonder dit
  // zou elke rotatie-sleepbeweging per ongeluk een waypoint neerzetten.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const TAP_THRESHOLD_PX = 6;

  return (
    <mesh
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (!pickingActive) return;
        pointerDownRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event: ThreeEvent<PointerEvent>) => {
        if (!pickingActive || !onPick) return;
        const start = pointerDownRef.current;
        pointerDownRef.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD_PX) return; // was een sleep, geen tik
        // De displacement gebeurt op de GPU (vertex shader) — het raycast-
        // punt ligt dus op de onvervormde bol. Dat is geen probleem: hoogte
        // verschuift een punt alleen radiaal, nooit in hoek, dus de
        // afgeleide lat/lon blijft exact correct.
        const { lat, lon } = vector3ToLatLon(event.point);
        onPick(lat, lon, sampleIsOcean(lat, lon));
      }}
    >
      {/* Hoge subdivisie: nodig zodat de displacement scherp én vloeiend blijft */}
      <sphereGeometry args={[1.55, 320, 320]} />
      <meshStandardMaterial
        color="#f7f8fa"
        // Macro-reliëf: echte geometrie-verhoging van bergketens/kustlijnen
        displacementMap={displacementMap}
        displacementScale={0.2}
        displacementBias={-0.075}
        // Mid-detail: georiënteerde oppervlaktenormalen (continentcontouren)
        normalMap={normalMap}
        normalScale={new THREE.Vector2(3.0, 3.0)}
        // Micro-detail: dezelfde hoogtekaart nogmaals, nu als fijne bump —
        // dit laat de bergkammen zelf onder scherend licht crisp afsteken
        bumpMap={displacementMap}
        bumpScale={0.02}
        // Matte, krijtachtige finish — geen glans die het reliëf plat trekt
        roughness={0.6}
        metalness={0.02}
        // ---- IJsblauwe rim-glow, direct in het materiaal gebakken ----
        // Volgt de échte oppervlaktenormalen, dus hij omarmt bergkammen en
        // randen organisch i.p.v. een vlakke ring.
        onBeforeCompile={(shader: THREE.WebGLProgramParametersWithUniforms) => {
          shader.uniforms.rimColor = { value: new THREE.Color("#bfe0ff") };
          shader.uniforms.rimPower = { value: 3.2 };
          shader.uniforms.rimIntensity = { value: 0.28 };

          shader.fragmentShader = shader.fragmentShader.replace(
            "void main() {",
            `
            uniform vec3 rimColor;
            uniform float rimPower;
            uniform float rimIntensity;
            void main() {
            `
          );

          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            `
            float rimFresnel = pow(
              1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0),
              rimPower
            );
            gl_FragColor.rgb += rimColor * rimFresnel * rimIntensity;
            #include <dithering_fragment>
            `
          );
        }}
      />
    </mesh>
  );
}

// ---- Dun, strak randlichtje (géén losse halo/ring) -------------------------
// De waarde wordt eerst naar [0, 1] geklemd vóór de pow(): een negatieve
// basis met een gebroken exponent is undefined gedrag in GLSL en gaf
// voorheen precies de grauwe "vieze vlek". De schil zit vlak tegen de bol
// (scale 1.02) met een scherpe val-off, dus je ziet enkel een dun sliertje
// ijsblauw licht op de échte rand — nooit een bredere ring.
function RimLight() {
  return (
    <mesh scale={1.02}>
      <sphereGeometry args={[1.55, 128, 128]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={THREE.FrontSide}
        blending={THREE.AdditiveBlending}
        uniforms={{
          glowColor: { value: new THREE.Color("#bfe0ff") },
          power: { value: 7.5 },
          opacity: { value: 0.22 },
        }}
        vertexShader={/* glsl */ `
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vViewDir = normalize(-mvPosition.xyz);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 glowColor;
          uniform float power;
          uniform float opacity;
          varying vec3 vNormal;
          varying vec3 vViewDir;
          void main() {
            // Geklemd naar [0, 1] vóór de pow() — kan nooit negatief worden.
            float rim = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
            float alpha = pow(rim, power) * opacity;
            gl_FragColor = vec4(glowColor, alpha);
          }
        `}
      />
    </mesh>
  );
}

// ---- Zachte, diffuse slagschaduw op de achtergrond -------------------------
// Een vlak vér áchter de bol (kleinere z dan de sphere) met een radiale
// gradient-shader: helderste punt in het midden (wordt toch grotendeels
// bedekt door de opake bol zelf) en een zachte, vloeiende val-off naar
// transparant — géén harde rand, dus nooit een "ring". Dit is precies wat
// het gevoel geeft dat de globe vóór het scherm zweeft, zoals een zacht
// box-shadow achter een cirkelvormig element.
function DropShadow() {
  return (
    <mesh position={[0.15, -0.25, -0.9]}>
      <planeGeometry args={[5.5, 5.5]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        uniforms={{
          shadowColor: { value: new THREE.Color("#aab7c9") },
          opacity: { value: 0.32 },
        }}
        vertexShader={/* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          uniform vec3 shadowColor;
          uniform float opacity;
          varying vec2 vUv;
          void main() {
            vec2 centered = vUv - 0.5;
            float dist = length(centered) * 2.0; // 0 in het midden .. 1 aan de rand
            // Zachte, brede val-off — geen harde cirkelrand
            float alpha = smoothstep(1.0, 0.0, dist);
            alpha = pow(alpha, 2.2) * opacity;
            gl_FragColor = vec4(shadowColor, alpha);
          }
        `}
      />
    </mesh>
  );
}

function Loader() {
  return (
    <mesh>
      <sphereGeometry args={[1.55, 16, 16]} />
      <meshBasicMaterial color="#eceff1" wireframe transparent opacity={0.2} />
    </mesh>
  );
}

/** Korte, zichtbare "geweigerd"-flits op precies de plek waar er op land
 *  werd getikt tijdens het plaatsen van een eigen route — een rode ring die
 *  groeit en tegelijk wegfaadt, duidelijk anders (kleur + gedrag) dan de
 *  bronzen "geaccepteerd"-pin, zodat meteen zichtbaar is dat dít punt niet
 *  is toegevoegd. Verdwijnt vanzelf; geen state nodig om 'm op te ruimen. */
function RejectedClickMarker({ lat, lon, radius }: { lat: number; lon: number; radius: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const ageRef = useRef(0);

  const position = useMemo(() => latLonToVector3(lat, lon, radius + 0.05), [lat, lon, radius]);
  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  }, [position]);

  useFrame((_, delta) => {
    ageRef.current += delta;
    const DURATION = 1.1;
    const t = Math.min(ageRef.current / DURATION, 1);
    if (groupRef.current) groupRef.current.scale.setScalar(1 + t * 0.7);
    if (materialRef.current) materialRef.current.opacity = 0.85 * (1 - t);
  });

  return (
    <group ref={groupRef} position={position} quaternion={quaternion}>
      <mesh>
        <ringGeometry args={[0.05, 0.078, 32]} />
        <meshBasicMaterial
          ref={materialRef}
          color="#c0483f"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ---- Lichtrig: gebalanceerd — genoeg richting voor micro-schaduw in het ---
// reliëf, maar geen grote donkere "nachtkant". Ambient/hemisphere/fill liggen
// dicht bij de key light, zodat de continenten overal even goed leesbaar
// blijven en alléén het reliëf zelf (via normal/bump-perturbatie) nog lokaal,
// scherp schaduw toont.
function StudioLights() {
  return (
    <>
      {/* Brede basis: houdt de hele bol overal even goed leesbaar */}
      <ambientLight intensity={0.5} color="#ffffff" />
      <hemisphereLight args={["#ffffff", "#dfe9f7", 0.5]} />
      {/* Key light: geeft richting zodat bergstructuren scherpe
          micro-schaduw krijgen en driedimensionaal aftekenen */}
      <directionalLight position={[-4, 3.2, 3]} intensity={1.5} color="#ffffff" />
      {/* Fill light: bijna even sterk als de key — voorkomt een donkere
          schaduwhelft; het reliëf zelf blijft door normal/bump toch zichtbaar */}
      <directionalLight position={[3.5, -1, 2.5]} intensity={1.15} color="#f3f8ff" />
      {/* Rim/back light: subtiele ijsblauwe randdefinitie rechtsonder */}
      <directionalLight position={[2.5, -2, -3]} intensity={0.35} color="#bfe0ff" />
    </>
  );
}

export interface IceGlobeHandle {
  /** Sluit een eventueel geselecteerd waypoint (camera terug naar overview). 
   *  Voor de sluitknop van de infokaart, die nu als DOM-element buiten deze
   *  Canvas leeft (zie page.tsx) — vandaar dat hij deze kant op moet kunnen
   *  "roepen" in plaats van zelf in de 3D-scène te zitten. */
  closeWaypoint: () => void;
}

interface IceGlobeProps {
  className?: string;
  /** Optioneel: vaste pixelgrootte. Zonder deze prop vult de globe gewoon
   *  zijn omliggende container (aanbevolen — bepaal de afmeting via de
   *  wrapper-div in je layout, dan blijft het altijd responsief). */
  size?: number;
  /** Welke expeditie er getoond wordt op de globe — id uit `expeditions`
   *  in ExpeditionRoute.tsx (bv. "belgica" of "koning-boudewijnbasis"). */
  activeExpeditionId?: string;
  /** Wordt aangeroepen zodra de gebruiker een waypoint selecteert/deselecteert.
   *  De ouder-pagina rendert hiermee de infokaart als gewoon 2D-DOM-element,
   *  volledig los van de 3D-camera. */
  onActiveWaypointChange?: (selected: SelectedWaypoint | null) => void;

  /** "Bouw je eigen expeditie" — actief zolang de bezoeker punten aan het
   *  plaatsen is op de globe. Schakelt de tik-naar-coördinaat-detectie in. */
  pickingActive?: boolean;
  /** Wordt aangeroepen zodra de bezoeker (in plaatsingsmodus) ergens op de
   *  bol tikt, met de bijbehorende lat/lon. `isOcean` geeft aan of het punt
   *  op zee ligt — de UI-laag beslist zelf wat er gebeurt bij `false`
   *  (typisch: het punt weigeren en een melding tonen). */
  onGlobePick?: (lat: number, lon: number, isOcean: boolean) => void;
  /** De punten die tijdens het plaatsen al zijn aangetikt — worden meteen
   *  als pin + concept-lijn getoond, zodat de bezoeker directe bevestiging
   *  krijgt van elke tik. */
  previewPoints?: CustomRoutePoint[];
  /** Een net geweigerde tik op land — toont kort een rode flits op precies
   *  die plek. `nonce` moet bij elke nieuwe (zelfs identieke) tik veranderen,
   *  zodat de animatie altijd opnieuw start. */
  invalidClickPoint?: { lat: number; lon: number; nonce: number } | null;
  /** De actieve zelfgebouwde reis (route + vervoermiddel + fase), of `null`
   *  als er geen eigen expeditie onderweg/aangekomen is. */
  customRoute?: {
    clickedPoints: CustomRoutePoint[];
    transport: TransportConfig;
    phase: CustomRoutePhase;
  } | null;
  /** Wordt aangeroepen zodra het zelfgekozen vervoermiddel de bestemming bereikt. */
  onCustomArrive?: () => void;
  /** Wordt aangeroepen zodra het vervoermiddel een mijlpaal van de eigen
   *  route passeert (index in [start, ...aangeklikte punten, bestemming]) —
   *  de UI-laag toont hiermee de "je vaart nu langs..."-pop-up. */
  onPassMilestone?: (index: number) => void;
}

const IceGlobe = forwardRef<IceGlobeHandle, IceGlobeProps>(function IceGlobe(
  {
    className = "",
    size,
    activeExpeditionId = "belgica",
    onActiveWaypointChange,
    pickingActive = false,
    onGlobePick,
    previewPoints = [],
    invalidClickPoint = null,
    customRoute = null,
    onCustomArrive,
    onPassMilestone,
  },
  ref
) {
  const controlsRef = useRef<OrbitControlsLike | null>(null);
  const expeditionRouteRef = useRef<ExpeditionRouteHandle | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      closeWaypoint: () => expeditionRouteRef.current?.closeWaypoint(),
    }),
    []
  );

  // Zodra "Bouw je eigen expeditie" actief is (punten plaatsen, varen,
  // aangekomen, of nog even terugvliegend na het sluiten), verdwijnt de
  // vaste expeditieroute volledig — geen dubbele lijnen/hotspots die het
  // scherm "druk" maken. Zodra alles weer op "closed" staat, komt de vaste
  // route gewoon weer normaal in beeld.
  const isCustomModeActive = pickingActive || customRoute !== null;

  return (
    <div
      className={className}
      style={
        size
          ? { width: size, height: size, maxWidth: "100%", maxHeight: "100%", touchAction: "none" }
          : { width: "100%", height: "100%", touchAction: "none" }
      }
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5.6], fov: 42 }}
        gl={{ antialias: true, alpha: true, toneMappingExposure: 1.0 }}
        style={{ background: "transparent", touchAction: "none" }}
      >
        <StudioLights />

        <Suspense fallback={<Loader />}>
          <DropShadow />
          <TerrainGlobe pickingActive={pickingActive} onPick={onGlobePick} />
          <RimLight />

          {!isCustomModeActive && (
            <ExpeditionRoute
              ref={expeditionRouteRef}
              controlsRef={controlsRef}
              radius={1.55}
              activeExpeditionId={activeExpeditionId}
              onActiveChange={onActiveWaypointChange}
            />
          )}

          {/* Tijdens het plaatsen van punten: camera zoomt eenmalig uit naar
              een overzichtelijke stand, en elk getikt punt krijgt meteen een
              zichtbare pin + concept-lijn — directe bevestiging dat de tik
              is geregistreerd. */}
          {pickingActive && customRoute === null && (
            <>
              <PlanningCameraRig controlsRef={controlsRef} />
              <CustomRoutePreview radius={1.55} points={previewPoints} />
            </>
          )}

          {/* Korte rode flits op precies de plek waar een tik op land werd
              geweigerd — key op `nonce` zodat de animatie ook herstart als
              er twee keer (bijna) op dezelfde plek wordt getikt. */}
          {invalidClickPoint && (
            <RejectedClickMarker
              key={invalidClickPoint.nonce}
              lat={invalidClickPoint.lat}
              lon={invalidClickPoint.lon}
              radius={1.55}
            />
          )}

          {customRoute && (
            <CustomExpeditionRoute
              radius={1.55}
              clickedPoints={customRoute.clickedPoints}
              transport={customRoute.transport}
              phase={customRoute.phase}
              onArrive={() => onCustomArrive?.()}
              onPassMilestone={(index) => onPassMilestone?.(index)}
              controlsRef={controlsRef}
            />
          )}
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableZoom={false}
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
          autoRotate
          autoRotateSpeed={0.55}
          rotateSpeed={0.5}
          enableDamping
          dampingFactor={0.08}
          // Multi-touch/multi-bezoeker: standaard interpreteert OrbitControls
          // TWEE gelijktijdige aanrakingen als "knijp om te zoomen" (DOLLY_PAN)
          // — precies fout voor een touchwall waar persoon A draait terwijl
          // persoon B ergens anders tikt. Door ook TWO op ROTATE te zetten
          // (i.p.v. de default DOLLY_PAN) claimt een tweede vinger nooit meer
          // een zoom/pan-gebaar; een korte tik elders blijft gewoon een tik
          // (R3F's eigen pointer-events zijn al per aanraking/pointerId
          // onafhankelijk, dus die tik bereikt de hotspot sowieso — dit
          // voorkomt alleen dat OrbitControls die tweede aanraking ondertussen
          // verkeerd interpreteert als onderdeel van een zoom-gebaar).
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.ROTATE }}
        />
      </Canvas>
    </div>
  );
});

export default IceGlobe;