import * as THREE from 'three';
import { CONFIG, type HitZone, type Slot, type Team } from '../config';
import { AABB } from '../physics/AABB';
import { Weapon } from '../weapons/Weapon';
import type { MoveIntent } from './Movement';

const M = CONFIG.movement;

let nextId = 1;

export interface WeaponIntent {
  /** trigger held (or tapped since last tick) */
  fire: boolean;
  /** alt fire / scope, edge */
  alt: boolean;
  reload: boolean;
  switchTo: Slot | null;
  /** plant / defuse held */
  use: boolean;
}

/**
 * Shared state for the human player and bots: transform, physics,
 * health/armour, loadout and stats. Controllers (Player / BotBrain) only
 * write `intent`, view angles and weapon requests.
 */
export class Actor {
  readonly id = nextId++;
  name: string;
  team: Team;
  readonly isBot: boolean;

  /** feet position */
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  onGround = false;
  crouching = false;
  height: number = M.standHeight;
  eyeHeight: number = M.standEye;
  prevEyeHeight: number = M.standEye;
  /** seconds since landing (for accuracy penalty) */
  sinceLanding = 10;
  airTime = 0;
  /** distance accumulator for footsteps */
  stepDist = 0;

  hp: number = CONFIG.damage.maxHp;
  armor = 0;
  helmet = false;
  alive = true;
  hasKit = false;
  hasBomb = false;
  money: number = CONFIG.economy.startMoney;

  kills = 0;
  deaths = 0;
  roundKills = 0;
  /** seconds since the actor was last hit (bots turn toward damage) */
  lastDamageFrom: Actor | null = null;
  lastDamageTime = -100;

  readonly intent: MoveIntent = { forward: 0, right: 0, jump: false, crouch: false, walk: false };

  /** hitboxes, refreshed after movement */
  readonly hitboxes: Record<HitZone, AABB> = { head: new AABB(), body: new AABB(), legs: new AABB() };

  /** weapons carried; knife can never be dropped */
  readonly loadout: { primary: Weapon | null; secondary: Weapon | null; melee: Weapon } = {
    primary: null,
    secondary: new Weapon('hornet'),
    melee: new Weapon('talon'),
  };
  currentSlot: Slot = 'secondary';
  /** 0..1 — bots cancel this share of recoil (humans do it with the mouse) */
  recoilControl = 0;
  lastSlot: Slot = 'melee';

  /** weapon requests for this tick, written by the controller */
  readonly weaponIntent: WeaponIntent = { fire: false, alt: false, reload: false, switchTo: null, use: false };

  constructor(name: string, team: Team, isBot: boolean) {
    this.name = name;
    this.team = team;
    this.isBot = isBot;
  }

  get weapon(): Weapon {
    return this.loadout[this.currentSlot] ?? this.loadout.melee;
  }

  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  /** view direction from yaw/pitch (three.js camera convention: yaw 0 looks at -Z) */
  viewDir(out: THREE.Vector3, extraPitch = 0, extraYaw = 0): THREE.Vector3 {
    const p = this.pitch + extraPitch;
    const y = this.yaw + extraYaw;
    const cp = Math.cos(p);
    return out.set(-Math.sin(y) * cp, Math.sin(p), -Math.cos(y) * cp);
  }

  horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  updateHitboxes(): void {
    const { x, y, z } = this.pos;
    const h = this.height;
    const legsTop = y + h * 0.47;
    const headBottom = y + h - 0.27;
    this.hitboxes.legs.set(x - 0.2, y, z - 0.2, x + 0.2, legsTop, z + 0.2);
    this.hitboxes.body.set(x - 0.26, legsTop, z - 0.26, x + 0.26, headBottom, z + 0.26);
    this.hitboxes.head.set(x - 0.14, headBottom, z - 0.14, x + 0.14, y + h, z + 0.14);
  }

  resetForRound(): void {
    this.hp = CONFIG.damage.maxHp;
    this.alive = true;
    this.vel.set(0, 0, 0);
    this.crouching = false;
    this.height = M.standHeight;
    this.eyeHeight = this.prevEyeHeight = M.standEye;
    this.onGround = false;
    this.hasBomb = false;
    this.roundKills = 0;
    this.lastDamageFrom = null;
    this.lastDamageTime = -100;
    this.pitch = 0;
  }
}
