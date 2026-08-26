"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * ExpeditionAudio — gedeelde audio-infrastructuur
 * ----------------------------------------------------------------------------
 * Eén bron van waarheid voor sfeergeluid, gebruikt door zowel de vaste
 * expedities (ExpeditionRoute.tsx) als "Bouw je eigen expeditie"
 * (CustomExpedition.tsx) — zodat beide zich exact hetzelfde gedragen: zacht
 * museumvolume, vloeiend faden i.p.v. hard klikken, en een directe, harde
 * stop zodra een expeditie sluit (geen geluid dat blijft doorlopen).
 *
 * Verwacht deze drie bestanden in public/audio/:
 *   public/audio/sea-ambience.mp3       (rustige zee + meeuwen)
 *   public/audio/harbour-departure.mp3  (haven/meeuwen bij vertrek of een hotspot)
 *   public/audio/cold-wind.mp3          (koude wind/storm)
 */
export const AUDIO_SEA_AMBIENCE = "/audio/sea-ambience.mp3";
export const AUDIO_HARBOUR_DEPARTURE = "/audio/harbour-departure.mp3";
export const AUDIO_COLD_WIND = "/audio/cold-wind.mp3";

// Museum-vriendelijk: zacht en sfeervol, nooit dominant of storend. Dezelfde
// waarden overal, zodat de vaste expedities en de eigen route nooit anders
// aanvoelen qua volume.
export const AUDIO_SEA_VOLUME = 0.22;
export const AUDIO_HARBOUR_PEAK_VOLUME = 0.3;
export const AUDIO_WIND_PEAK_VOLUME = 0.26;
/** Hoe snel het volume per seconde richting zijn doel beweegt (fractie van
 *  het resterende verschil) — hoger = snellere fade, geen harde sprongen. */
const AUDIO_FADE_RATE = 4;

/** Eén los geluidsspoor met vloeiend faden i.p.v. hard aan/uit-klikken.
 *  Gewoon een HTMLAudioElement — geen positionele 3D-audio nodig, dit is
 *  sfeergeluid, geen geluid dat uit één specifiek 3D-object hoort te komen. */
export function useFadingTrack(src: string, loop: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const targetVolumeRef = useRef(0);

  useEffect(() => {
    const audio = new Audio(src);
    audio.loop = loop;
    audio.volume = 0;
    audio.preload = "auto";
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [src, loop]);

  useFrame((_, delta) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = targetVolumeRef.current;
    const diff = target - audio.volume;
    if (Math.abs(diff) > 0.003) {
      audio.volume = THREE.MathUtils.clamp(audio.volume + diff * Math.min(1, AUDIO_FADE_RATE * delta), 0, 1);
    } else if (audio.volume !== target) {
      audio.volume = target;
    }
    // Pas écht afspelen/pauzeren op basis van het (bijna) bereikte volume —
    // zo blijft een track nooit onhoorbaar "aan" staan op de achtergrond.
    if (audio.volume > 0.004 && audio.paused) {
      // Browsers vereisen gebruikersinteractie voor geluid — die is er altijd
      // al geweest (een klik op de expeditie-switcher of "Start Expeditie"
      // zet deze keten in gang), dus dit werkt betrouwbaar. .catch() vangt
      // het stille, uitzonderlijke geval op waarin een browser het toch weigert.
      audio.play().catch(() => {});
    }
    if (audio.volume <= 0.004 && !audio.paused) {
      audio.pause();
    }
  });

  return {
    setVolume: (value: number) => {
      targetVolumeRef.current = THREE.MathUtils.clamp(value, 0, 1);
    },
    /** Direct en volledig stoppen — geen fade, voor het moment dat een
     *  expeditie sluit en er ECHT niets meer hoorbaar mag zijn. */
    stopImmediately: () => {
      targetVolumeRef.current = 0;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 0;
      }
    },
  };
}