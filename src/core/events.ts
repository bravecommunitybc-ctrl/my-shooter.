import type * as THREE from 'three';
import type { HitZone, Team, WeaponId, WeaponStats } from '../config';
import type { Actor } from '../entities/Actor';

export type DamageSource = WeaponId | 'bomb' | 'fall';

export type RoundEndReason = 'elimination' | 'time' | 'bomb' | 'defuse';

export interface GameEvents {
  /** vectors are shared temporaries — copy them if you keep them */
  shot: { shooter: Actor; weapon: WeaponStats; origin: THREE.Vector3; end: THREE.Vector3; hitActor: boolean };
  impact: { point: THREE.Vector3; normal: THREE.Vector3; surface: string };
  damage: { attacker: Actor | null; victim: Actor; amount: number; zone: HitZone | null; source: DamageSource };
  kill: { killer: Actor | null; victim: Actor; source: DamageSource; headshot: boolean };
  reload: { actor: Actor; weapon: WeaponId };
  dryFire: { actor: Actor };
  weaponSwitch: { actor: Actor; weapon: WeaponId };
  scope: { actor: Actor; scoped: boolean };
  melee: { actor: Actor; hit: boolean };
  footstep: { actor: Actor; loud: boolean };
  land: { actor: Actor; speed: number };
  roundPhase: { phase: 'buy' | 'live' | 'post' | 'over'; round: number };
  roundEnd: { winner: Team; reason: RoundEndReason; round: number };
  halftime: Record<string, never>;
  matchEnd: { winner: Team };
  bombPickup: { actor: Actor };
  bombDrop: { actor: Actor; pos: THREE.Vector3 };
  plantStart: { actor: Actor };
  bombPlanted: { actor: Actor; site: 'A' | 'B'; pos: THREE.Vector3 };
  defuseStart: { actor: Actor; kit: boolean };
  bombDefused: { actor: Actor };
  bombExploded: { pos: THREE.Vector3 };
  bombBeep: { pos: THREE.Vector3; urgency: number };
  purchase: { actor: Actor; item: string };
}
