import * as THREE from 'three';
import { CONFIG, DEG, type BotSkill } from '../config';
import type { Actor } from '../entities/Actor';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { WeaponSystem } from '../weapons/WeaponSystem';
import type { NavGraph } from './NavGraph';
import { chestPoint, hasLineOfSight, headPoint, inFov } from './Perception';

const B = CONFIG.bots;
const M = CONFIG.movement;

export interface BotContext {
  world: CollisionWorld;
  nav: NavGraph;
  weapons: WeaponSystem;
  actors(): Actor[];
  /** team-shared sighting: called whenever a bot sees an enemy */
  report(observer: Actor, enemy: Actor): void;
}

/** What the bot should be doing when not fighting; written by BotManager. */
export interface BotOrder {
  goal: THREE.Vector3;
  look: THREE.Vector3 | null;
  /** hold E on arrival (plant / defuse) */
  use: boolean;
  walk: boolean;
  /** arrival radius */
  radius: number;
}

const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _to = new THREE.Vector3();

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Per-bot behaviour: perception (FOV + LOS), reaction delay, imperfect
 * aim that tightens while tracking, burst fire with recoil control,
 * waypoint path following and order execution.
 */
export class BotBrain {
  order: BotOrder | null = null;
  target: Actor | null = null;
  targetVisible = false;
  readonly lastSeenPos = new THREE.Vector3();
  lastSeenTime = -100;
  /** true while standing at the order goal */
  arrived = false;

  private path: THREE.Vector3[] = [];
  private pathIdx = 0;
  private readonly plannedGoal = new THREE.Vector3(Infinity, 0, 0);
  private reactUntil = 0;
  private trackStart = 0;
  private aimHead = false;
  private errYaw = 0;
  private errPitch = 0;
  private nextErrAt = 0;
  private burstLeft = 0;
  private burstPauseUntil = 0;
  private lastShotSeen = -100;
  private crouchInFight = false;
  private scopedSince = 0;
  private interest: THREE.Vector3 | null = null;
  private interestUntil = 0;
  private nextThink = 0;
  private readonly progressPos = new THREE.Vector3();
  private progressTime = 0;
  private stuckCount = 0;
  private idleLookYaw = 0;
  private nextIdleLook = 0;
  private readonly cosHalfFov = Math.cos((B.fovDeg / 2) * DEG);

  constructor(readonly actor: Actor, private readonly ctx: BotContext, public skill: BotSkill) {
    actor.recoilControl = skill.recoilControl;
    this.nextThink = Math.random() * B.thinkInterval;
  }

  resetForRound(): void {
    this.order = null;
    this.target = null;
    this.targetVisible = false;
    this.lastSeenTime = -100;
    this.path = [];
    this.pathIdx = 0;
    this.plannedGoal.set(Infinity, 0, 0);
    this.interest = null;
    this.arrived = false;
    this.burstLeft = 0;
    this.stuckCount = 0;
    this.progressTime = 0;
  }

  /** heard a gunshot / footstep */
  hear(pos: THREE.Vector3, time: number): void {
    if (this.targetVisible) return;
    this.interest = (this.interest ?? new THREE.Vector3()).copy(pos);
    this.interest.y += 1.2;
    this.interestUntil = time + 2.5;
  }

  // ─── perception / decisions (≈10 Hz) ─────────────────────────────

  private think(time: number): void {
    const a = this.actor;
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const e of this.ctx.actors()) {
      if (!e.alive || e.team === a.team) continue;
      const d = a.pos.distanceTo(e.pos);
      if (d > B.viewDistance) continue;
      const tracking = e === this.target && time - this.lastSeenTime < 1;
      if (!tracking && d > 2.5 && !inFov(a, e, this.cosHalfFov)) continue;
      if (!hasLineOfSight(a, e, this.ctx.world)) continue;
      // prefer the current target slightly
      const score = e === this.target ? d * 0.7 : d;
      if (score < bestD) {
        bestD = score;
        best = e;
      }
    }

    if (best) {
      if (best !== this.target) {
        const fresh = !this.target || !this.targetVisible;
        this.reactUntil = time + (fresh ? rand(this.skill.reaction[0], this.skill.reaction[1]) : 0.15);
        this.trackStart = time;
        this.aimHead = Math.random() < this.skill.headshotChance;
        const dist = a.pos.distanceTo(best.pos);
        this.crouchInFight = dist > 14 && Math.random() < 0.35 && a.weapon.stats.id !== 'longbow';
        this.nextErrAt = 0;
        this.target = best;
      }
      this.targetVisible = true;
      this.lastSeenPos.copy(best.pos);
      this.lastSeenTime = time;
      this.ctx.report(a, best);
    } else {
      this.targetVisible = false;
      if (this.target && (!this.target.alive || time - this.lastSeenTime > B.memoryTime)) this.target = null;
    }

    // took damage from someone we cannot see: turn toward them
    const att = a.lastDamageFrom;
    if (!this.targetVisible && att && att.alive && time - a.lastDamageTime < 0.4) {
      this.interest = (this.interest ?? new THREE.Vector3()).copy(att.pos);
      this.interest.y += 1.3;
      this.interest.x += gauss() * 1.5;
      this.interest.z += gauss() * 1.5;
      this.interestUntil = time + 2.5;
    }

    // path planning
    const o = this.order;
    if (o && this.plannedGoal.distanceToSquared(o.goal) > 1) this.planPath(o.goal, time);

    // stuck detection
    if (o && !this.arrived && !this.targetVisible && this.path.length) {
      if (time - this.progressTime > B.stuckTime) {
        if (a.pos.distanceTo(this.progressPos) < 0.35) {
          this.stuckCount++;
          a.intent.jump = true;
          if (this.stuckCount > 1) this.planPath(o.goal, time, true);
        } else {
          this.stuckCount = 0;
        }
        this.progressPos.copy(a.pos);
        this.progressTime = time;
      }
    }
  }

  private planPath(goal: THREE.Vector3, time: number, forceJitter = false): void {
    const nav = this.ctx.nav;
    const a = this.actor;
    this.plannedGoal.copy(goal);
    this.arrived = false;
    this.path = [];
    this.pathIdx = 0;
    this.progressPos.copy(a.pos);
    this.progressTime = time;
    const start = nav.nearest(a.pos);
    const end = nav.nearest(goal);
    const ids = nav.findPath(start.id, end.id, forceJitter ? 1.2 : 0.7);
    if (ids) {
      for (const id of ids) this.path.push(nav.nodes[id].pos.clone());
      // skip the first node if the second is directly reachable
      if (this.path.length > 1 && nav.corridorClear(a.pos, this.path[1])) this.path.shift();
    }
    this.path.push(goal.clone());
  }

  // ─── per tick ────────────────────────────────────────────────────

  update(dt: number, time: number): void {
    const a = this.actor;
    const it = a.intent;
    const wi = a.weaponIntent;
    it.forward = it.right = 0;
    it.jump = false;
    it.walk = false;
    it.crouch = false;
    wi.fire = false;
    wi.use = false;
    if (!a.alive) return;

    if (time >= this.nextThink) {
      this.nextThink = time + B.thinkInterval;
      this.think(time);
    }

    this.manageWeapons(time);

    const w = a.weapon;
    if (w.lastShotTime > this.lastShotSeen) {
      this.lastShotSeen = w.lastShotTime;
      if (this.burstLeft > 0) {
        this.burstLeft--;
        if (this.burstLeft === 0) this.burstPauseUntil = time + rand(0.28, 0.5);
      }
    }

    a.eyePosition(_eye);
    let wantYaw = a.yaw;
    let wantPitch = 0;
    let fighting = false;
    const target = this.target;

    if (target && target.alive && (this.targetVisible || time - this.lastSeenTime < 0.5)) {
      fighting = true;
      if (this.targetVisible) {
        if (this.aimHead) headPoint(target, _aim);
        else chestPoint(target, _aim);
      } else {
        _aim.copy(this.lastSeenPos);
        _aim.y += 1.3;
      }
      if (time >= this.nextErrAt) {
        const track = Math.min(1, (time - this.trackStart) / 1.2);
        const moving = a.horizontalSpeed() > 1.5 ? 1.5 : 1;
        const err = this.skill.aimErrorDeg * DEG * (1.35 - track * 0.95) * moving;
        this.errYaw = gauss() * err;
        this.errPitch = gauss() * err * 0.6;
        this.nextErrAt = time + 0.35;
      }
      _to.subVectors(_aim, _eye);
      wantYaw = Math.atan2(-_to.x, -_to.z) + this.errYaw;
      wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) + this.errPitch;
    } else if (this.interest && time < this.interestUntil) {
      _to.subVectors(this.interest, _eye);
      wantYaw = Math.atan2(-_to.x, -_to.z);
      wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) * 0.5;
    } else if (!this.arrived && this.pathIdx < this.path.length) {
      const p = this.path[Math.min(this.pathIdx + 1, this.path.length - 1)];
      _to.subVectors(p, a.pos);
      if (_to.lengthSq() > 0.25) wantYaw = Math.atan2(-_to.x, -_to.z);
    } else if (this.order?.look) {
      _to.subVectors(this.order.look, _eye);
      if (time >= this.nextIdleLook) {
        this.idleLookYaw = gauss() * 0.25;
        this.nextIdleLook = time + rand(1.5, 4);
      }
      wantYaw = Math.atan2(-_to.x, -_to.z) + this.idleLookYaw;
      wantPitch = Math.atan2(_to.y, Math.hypot(_to.x, _to.z));
    }

    // turn with a speed cap
    const maxStep = this.skill.turnDegPerSec * DEG * dt;
    const dyaw = wrapAngle(wantYaw - a.yaw);
    const dpitch = wantPitch - a.pitch;
    const k = Math.min(1, dt * 14);
    a.yaw = wrapAngle(a.yaw + Math.max(-maxStep, Math.min(maxStep, dyaw * k)));
    a.pitch += Math.max(-maxStep, Math.min(maxStep, dpitch * k));
    a.pitch = Math.max(-1.4, Math.min(1.4, a.pitch));

    if (fighting && target) {
      this.fight(target, time, Math.abs(wrapAngle(wantYaw - a.yaw)), Math.abs(wantPitch - a.pitch));
      return;
    }
    if (w.scoped && time - this.lastSeenTime > 1.5) wi.alt = true;
    this.followOrder(time);
  }

  private fight(target: Actor, time: number, yawErr: number, pitchErr: number): void {
    const a = this.actor;
    const it = a.intent;
    const wi = a.weaponIntent;
    const w = a.weapon;
    const st = w.stats;
    const dist = a.pos.distanceTo(target.pos);

    if (st.melee) {
      // knife: run at them
      this.moveToward(target.pos);
      if (dist < st.range + 0.3 && yawErr < 0.4) wi.fire = true;
      return;
    }

    if (this.crouchInFight) it.crouch = true;
    // stop to shoot accurately (counter-strafe); pistols may keep walking at close range
    if (dist < 6 && st.slot === 'secondary') {
      it.right = Math.sin(time * 2.3 + this.actor.id) > 0 ? 1 : -1;
      it.walk = true;
    }

    if (!this.targetVisible || time < this.reactUntil) return;
    const tol = Math.max(Math.atan2(0.28, dist), 0.9 * DEG) + 0.4 * DEG;
    if (yawErr > tol * 1.6 || pitchErr > tol * 2) return;
    const slowEnough = a.horizontalSpeed() < M.runSpeed * st.mobility * M.accurateSpeedFrac * 1.2 || dist < 6;
    if (!slowEnough) return;

    if (st.scope) {
      if (!w.scoped) {
        if (!w.reloading && w.resumeScopeAt === 0) {
          wi.alt = true;
          this.scopedSince = time;
        }
        return;
      }
      if (time - this.scopedSince > 0.3) wi.fire = true;
      return;
    }
    if (st.automatic) {
      if (this.burstLeft <= 0 && time >= this.burstPauseUntil) {
        const [lo, hi] = this.skill.burst;
        const longRange = dist > 25;
        this.burstLeft = longRange ? Math.round(rand(1, 3)) : Math.round(rand(lo, hi));
      }
      if (this.burstLeft > 0) wi.fire = true;
    } else if (time - w.lastShotTime > rand(0.22, 0.4)) {
      wi.fire = true;
    }
  }

  private followOrder(time: number): void {
    const a = this.actor;
    const o = this.order;
    if (!o) return;
    const it = a.intent;
    if (!this.arrived) {
      // advance along the path
      while (this.pathIdx < this.path.length) {
        const p = this.path[this.pathIdx];
        const last = this.pathIdx === this.path.length - 1;
        const d = Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
        if (d < (last ? o.radius : 1.1)) this.pathIdx++;
        else break;
      }
      if (this.pathIdx >= this.path.length) {
        this.arrived = true;
      } else {
        this.moveToward(this.path[this.pathIdx]);
        it.walk = o.walk;
        return;
      }
    }
    if (o.use) a.weaponIntent.use = true;
    void time;
  }

  private moveToward(p: THREE.Vector3): void {
    const a = this.actor;
    const dx = p.x - a.pos.x;
    const dz = p.z - a.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const mx = dx / len;
    const mz = dz / len;
    // express the world direction in the actor's view frame
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    const rx = Math.cos(a.yaw);
    const rz = -Math.sin(a.yaw);
    a.intent.forward = mx * fx + mz * fz;
    a.intent.right = mx * rx + mz * rz;
  }

  private manageWeapons(time: number): void {
    const a = this.actor;
    const w = a.weapon;
    const wi = a.weaponIntent;
    const L = a.loadout;
    const hasAmmo = (x: typeof w | null) => !!x && (x.mag > 0 || x.reserve > 0);
    if (!w.stats.melee && w.mag === 0 && w.reserve === 0) {
      if (a.currentSlot !== 'secondary' && hasAmmo(L.secondary)) wi.switchTo = 'secondary';
      else if (a.currentSlot !== 'primary' && hasAmmo(L.primary)) wi.switchTo = 'primary';
      else wi.switchTo = 'melee';
      return;
    }
    const inFight = this.target && time - this.lastSeenTime < 2;
    if (!inFight) {
      if (a.currentSlot !== 'primary' && hasAmmo(L.primary)) wi.switchTo = 'primary';
      else if (!L.primary && a.currentSlot !== 'secondary' && hasAmmo(L.secondary)) wi.switchTo = 'secondary';
      else if (!w.stats.melee && !w.reloading && w.mag < w.stats.magSize * 0.5 && w.reserve > 0) wi.reload = true;
    } else if (a.currentSlot === 'primary' && w.mag === 0 && w.reloading && hasAmmo(L.secondary) && this.targetVisible) {
      // mid-fight dry: pistol is faster than a reload
      wi.switchTo = 'secondary';
    }
  }
}
