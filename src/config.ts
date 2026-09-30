/**
 * All gameplay / balance parameters live here.
 * Units: metres, seconds, radians (unless a field name says `Deg`).
 */

export const DEG = Math.PI / 180;

export type WeaponId = 'talon' | 'hornet' | 'kestrel' | 'longbow';
export type Slot = 'primary' | 'secondary' | 'melee';
export type Team = 'attack' | 'defend';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type HitZone = 'head' | 'body' | 'legs';

export interface SpreadStats {
  /** cone half-angle when standing still */
  base: number;
  crouchMul: number;
  /** extra spread at full run speed (scaled from `accurateSpeedFrac`) */
  move: number;
  air: number;
  /** spread added per shot, decays by `recovery` rad/s */
  perShot: number;
  maxShot: number;
  recovery: number;
}

export interface RecoilStats {
  /** per-shot deltas [pitchDeg, yawDeg]; last entry repeats */
  pattern: [number, number][];
  /** random jitter added per shot (deg) */
  jitterDeg: number;
  /** how fast the accumulated recoil returns to zero while not firing (deg/s) */
  recoveryDegPerSec: number;
  /** idle time after which the spray pattern restarts */
  resetTime: number;
  /** fraction of recoil shown as camera kick (bullets go to the full offset) */
  viewKick: number;
}

export interface WeaponStats {
  id: WeaponId;
  name: string;
  slot: Slot;
  price: number;
  killReward: number;
  damage: number;
  /** fraction of damage that goes through armour */
  armorPen: number;
  /** damage multiplier per 10 m travelled */
  rangeModifier: number;
  range: number;
  fireInterval: number;
  automatic: boolean;
  magSize: number;
  reserve: number;
  reloadTime: number;
  drawTime: number;
  /** movement speed multiplier while holding */
  mobility: number;
  spread: SpreadStats;
  recoil: RecoilStats;
  scope?: { fov: number; spreadScoped: number; spreadUnscoped: number; sensitivityMul: number; mobility: number };
  melee?: { heavyDamage: number; heavyInterval: number; backstabMul: number };
  /** sound synth profile key */
  sound: 'pistol' | 'rifle' | 'sniper' | 'knife';
}

/** Kestrel AR-7 spray: climbs, drifts left, then swings right. */
function kestrelPattern(): [number, number][] {
  const p: [number, number][] = [];
  const climb = [0, 0.45, 0.6, 0.75, 0.85, 0.85, 0.8, 0.7, 0.6, 0.5];
  for (let i = 0; i < 10; i++) p.push([climb[i], i < 4 ? 0.05 : -0.08]);
  for (let i = 0; i < 10; i++) p.push([0.18, -0.42]);
  for (let i = 0; i < 10; i++) p.push([0.08, 0.5]);
  return p;
}

export const WEAPONS: Record<WeaponId, WeaponStats> = {
  talon: {
    id: 'talon', name: 'Talon', slot: 'melee', price: 0, killReward: 1500,
    damage: 40, armorPen: 0.85, rangeModifier: 1, range: 1.9,
    fireInterval: 0.45, automatic: true, magSize: 0, reserve: 0, reloadTime: 0, drawTime: 0.4, mobility: 1.0,
    spread: { base: 0, crouchMul: 1, move: 0, air: 0, perShot: 0, maxShot: 0, recovery: 1 },
    recoil: { pattern: [[0, 0]], jitterDeg: 0, recoveryDegPerSec: 30, resetTime: 0.2, viewKick: 0 },
    melee: { heavyDamage: 65, heavyInterval: 1.0, backstabMul: 2.5 },
    sound: 'knife',
  },
  hornet: {
    id: 'hornet', name: 'Hornet P9', slot: 'secondary', price: 200, killReward: 300,
    damage: 32, armorPen: 0.5, rangeModifier: 0.86, range: 120,
    fireInterval: 0.15, automatic: false, magSize: 12, reserve: 36, reloadTime: 2.1, drawTime: 0.5, mobility: 0.96,
    spread: { base: 0.006, crouchMul: 0.8, move: 0.05, air: 0.18, perShot: 0.018, maxShot: 0.065, recovery: 0.16 },
    recoil: { pattern: [[1.3, 0]], jitterDeg: 0.35, recoveryDegPerSec: 10, resetTime: 0.3, viewKick: 0.55 },
    sound: 'pistol',
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel AR-7', slot: 'primary', price: 2700, killReward: 300,
    damage: 34, armorPen: 0.78, rangeModifier: 0.98, range: 200,
    fireInterval: 0.1, automatic: true, magSize: 30, reserve: 90, reloadTime: 2.4, drawTime: 0.9, mobility: 0.86,
    spread: { base: 0.0035, crouchMul: 0.75, move: 0.09, air: 0.26, perShot: 0.0035, maxShot: 0.03, recovery: 0.09 },
    recoil: { pattern: kestrelPattern(), jitterDeg: 0.08, recoveryDegPerSec: 11, resetTime: 0.4, viewKick: 0.5 },
    sound: 'rifle',
  },
  longbow: {
    id: 'longbow', name: 'Longbow SR', slot: 'primary', price: 4750, killReward: 100,
    damage: 115, armorPen: 0.97, rangeModifier: 0.99, range: 300,
    fireInterval: 1.35, automatic: false, magSize: 5, reserve: 20, reloadTime: 3.3, drawTime: 1.1, mobility: 0.8,
    spread: { base: 0.08, crouchMul: 1, move: 0.16, air: 0.32, perShot: 0, maxShot: 0, recovery: 1 },
    recoil: { pattern: [[3.2, 0]], jitterDeg: 0.4, recoveryDegPerSec: 6, resetTime: 1.2, viewKick: 0.9 },
    scope: { fov: 20, spreadScoped: 0.0008, spreadUnscoped: 0.08, sensitivityMul: 0.45, mobility: 0.55 },
    sound: 'sniper',
  },
};

export const CONFIG = {
  sim: { tickRate: 60 },

  render: {
    maxPixelRatio: 1.5,
    shadowMapSize: 2048,
    viewModelFov: 60,
  },

  movement: {
    /** m/s with knife out */
    runSpeed: 6.0,
    walkMul: 0.52,
    crouchMul: 0.34,
    /** Source-style acceleration factor (× wishspeed per second) */
    groundAccel: 5.5,
    airAccel: 12,
    airWishCap: 0.6,
    friction: 5.2,
    stopSpeed: 2.2,
    jumpVelocity: 5.4,
    gravity: 16,
    maxFallSpeed: 30,
    stepHeight: 0.45,
    halfWidth: 0.3,
    standHeight: 1.8,
    crouchHeight: 1.25,
    standEye: 1.64,
    crouchEye: 1.1,
    /** eye height lerp speed (1/s) */
    eyeLerp: 12,
    /** below this fraction of run speed you shoot with base spread (counter-strafe) */
    accurateSpeedFrac: 0.34,
    /** extra spread multiplier right after landing */
    landingPenalty: 0.6,
    landingPenaltyTime: 0.3,
  },

  damage: {
    zones: { head: 4, body: 1, legs: 0.75 } as Record<HitZone, number>,
    /** portion of absorbed damage that is subtracted from armour points */
    armorRatio: 0.5,
    maxHp: 100,
    maxArmor: 100,
    fallDamageMinSpeed: 11,
    fallDamagePerMs: 9,
  },

  round: {
    buyTime: 15,
    roundTime: 115,
    postRoundTime: 5,
    /** buying still allowed this long after the live phase starts (in spawn zone) */
    buyWindowAfterStart: 20,
    winsToWin: 13,
    halftimeAfter: 12,
    freezeDuringBuy: true,
  },

  bomb: {
    name: 'Pulse Charge',
    timer: 40,
    plantTime: 3.2,
    defuseTime: 10,
    defuseTimeKit: 5,
    useRange: 1.6,
    pickupRange: 1.2,
    blastRadius: 24,
    blastDamage: 500,
  },

  economy: {
    startMoney: 800,
    maxMoney: 16000,
    winElimination: 3250,
    winTime: 3250,
    winBomb: 3500,
    winDefuse: 3500,
    lossBase: 1400,
    lossStep: 500,
    lossMax: 3400,
    /** attackers that lose after planting get this on top of the loss bonus */
    plantedLossBonus: 800,
    planterBonus: 300,
    defuserBonus: 300,
    prices: { vest: 650, vestHelmet: 1000, kit: 400 },
  },

  bots: {
    count: 9,
    thinkInterval: 0.1,
    fovDeg: 115,
    viewDistance: 80,
    hearingRange: 38,
    memoryTime: 3.5,
    stuckTime: 1.2,
    names: ['Rook', 'Vesper', 'Tamsin', 'Oko', 'Brask', 'Lintel', 'Quill', 'Harrow', 'Mako', 'Juniper', 'Sable', 'Tern'],
    difficulty: {
      easy: { reaction: [0.5, 0.8], aimErrorDeg: 3.0, turnDegPerSec: 240, headshotChance: 0.08, recoilControl: 0.35, burst: [2, 5] },
      normal: { reaction: [0.3, 0.5], aimErrorDeg: 1.8, turnDegPerSec: 380, headshotChance: 0.22, recoilControl: 0.65, burst: [3, 7] },
      hard: { reaction: [0.18, 0.32], aimErrorDeg: 1.0, turnDegPerSec: 560, headshotChance: 0.38, recoilControl: 0.85, burst: [4, 9] },
    } as Record<Difficulty, BotSkill>,
  },

  audio: {
    maxDistance: 70,
    refDistance: 4,
    footstepInterval: 0.36,
  },

  effects: {
    maxDecals: 160,
    maxTracers: 48,
    tracerSpeed: 400,
    tracerLength: 3,
    maxParticles: 240,
  },

  defaults: {
    sensitivity: 1.2,
    fov: 74,
    volume: 0.7,
    side: 'attack' as Team,
    difficulty: 'normal' as Difficulty,
    fullscreen: false,
    crosshair: { size: 6, gap: 3, thickness: 2, color: '#5cff7a', dot: false, outline: true, dynamic: true },
  },
};

export interface BotSkill {
  reaction: [number, number];
  aimErrorDeg: number;
  turnDegPerSec: number;
  headshotChance: number;
  recoilControl: number;
  burst: [number, number];
}

export const TEAM_NAMES: Record<Team, string> = { attack: 'Strikers', defend: 'Wardens' };
export const TEAM_NAMES_RU: Record<Team, string> = { attack: 'Атака', defend: 'Защита' };
