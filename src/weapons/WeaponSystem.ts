import * as THREE from 'three';
import { CONFIG, DEG, WEAPONS, type HitZone, type Slot, type WeaponId } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';
import { AABB, rayAABB } from '../physics/AABB';
import { makeRayHit, type CollisionWorld } from '../physics/CollisionWorld';
import { applyDamage } from './Damage';
import { Weapon } from './Weapon';

const M = CONFIG.movement;
const ZONES: HitZone[] = ['head', 'body', 'legs'];

export interface TraceResult {
  t: number;
  actor: Actor | null;
  zone: HitZone | null;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  surface: string;
  hitWorld: boolean;
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _rh = makeRayHit();

/**
 * Hitscan weapons for every actor: switching, reloading, spread, recoil
 * patterns, zone damage, melee. Emits events; visuals and audio subscribe.
 */
export class WeaponSystem {
  private readonly trace: TraceResult = {
    t: 0, actor: null, zone: null, point: new THREE.Vector3(), normal: new THREE.Vector3(), surface: '', hitWorld: false,
  };

  constructor(
    private readonly world: CollisionWorld,
    private readonly actors: () => Actor[],
    private readonly events: EventBus<GameEvents>,
    private readonly friendlyFire = false,
  ) {}

  // ─── loadout ─────────────────────────────────────────────────────

  give(a: Actor, id: WeaponId, time: number, equip = true): Weapon {
    const w = new Weapon(id);
    const slot = WEAPONS[id].slot;
    if (slot === 'primary') a.loadout.primary = w;
    else if (slot === 'secondary') a.loadout.secondary = w;
    if (equip) this.switchTo(a, slot, time, true);
    return w;
  }

  switchTo(a: Actor, slot: Slot, time: number, force = false): void {
    const next = a.loadout[slot];
    if (!next || (!force && slot === a.currentSlot)) return;
    const cur = a.weapon;
    cur.reloadEnd = 0;
    if (cur.scoped) this.setScoped(a, cur, false);
    cur.resumeScopeAt = 0;
    if (slot !== a.currentSlot) a.lastSlot = a.currentSlot;
    a.currentSlot = slot;
    next.drawEnd = time + next.stats.drawTime;
    next.latched = true;
    this.events.emit('weaponSwitch', { actor: a, weapon: next.id });
  }

  /** movement speed multiplier from the held weapon */
  mobility(a: Actor): number {
    const w = a.weapon;
    return w.scoped && w.stats.scope ? w.stats.scope.mobility : w.stats.mobility;
  }

  /** current cone half-angle (radians) */
  inaccuracy(a: Actor, w: Weapon = a.weapon): number {
    const st = w.stats;
    const sp = st.spread;
    let base = sp.base;
    if (st.scope) base = w.scoped ? st.scope.spreadScoped : st.scope.spreadUnscoped;
    if (a.crouching && a.onGround) base *= sp.crouchMul;
    const frac = a.horizontalSpeed() / (M.runSpeed * st.mobility);
    const mf = Math.min(1, Math.max(0, (frac - M.accurateSpeedFrac) / (1 - M.accurateSpeedFrac)));
    let inacc = base + sp.move * mf + w.shotSpread;
    if (!a.onGround) inacc += sp.air;
    else if (a.sinceLanding < M.landingPenaltyTime) inacc += sp.air * M.landingPenalty * (1 - a.sinceLanding / M.landingPenaltyTime);
    return inacc;
  }

  // ─── per tick ────────────────────────────────────────────────────

  update(a: Actor, dt: number, time: number): void {
    const wi = a.weaponIntent;
    if (!a.alive) {
      wi.fire = wi.alt = wi.reload = false;
      wi.switchTo = null;
      return;
    }
    if (wi.switchTo) {
      this.switchTo(a, wi.switchTo, time);
      wi.switchTo = null;
    }
    const w = a.weapon;
    const st = w.stats;

    if (time - w.lastShotTime > st.recoil.resetTime) w.sprayIndex = 0;
    if (time - w.lastShotTime > st.fireInterval * 1.2) {
      const mag = Math.hypot(w.recoilPitch, w.recoilYaw);
      if (mag > 0) {
        const k = Math.max(0, mag - st.recoil.recoveryDegPerSec * DEG * dt) / mag;
        w.recoilPitch *= k;
        w.recoilYaw *= k;
      }
    }
    w.shotSpread = Math.max(0, w.shotSpread - st.spread.recovery * dt);

    if (w.reloadEnd && time >= w.reloadEnd) {
      const take = Math.min(st.magSize - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w.reloadEnd = 0;
    }
    if (w.resumeScopeAt && time >= w.resumeScopeAt) {
      w.resumeScopeAt = 0;
      if (!w.reloading && w.mag > 0) this.setScoped(a, w, true);
    }

    if (wi.reload) {
      wi.reload = false;
      this.startReload(a, w, time);
    }
    if (wi.alt) {
      wi.alt = false;
      if (st.scope && !w.reloading && time >= w.drawEnd) {
        w.resumeScopeAt = 0;
        this.setScoped(a, w, !w.scoped);
      } else if (st.melee && time >= w.nextFireTime && time >= w.drawEnd) {
        this.melee(a, w, time, true);
      }
    }

    if (!wi.fire) {
      w.latched = false;
    } else if (time >= w.nextFireTime && time >= w.drawEnd) {
      if (st.melee) {
        this.melee(a, w, time, false);
      } else if (w.reloading) {
        // cannot shoot mid-reload
      } else if (w.mag <= 0) {
        if (!w.latched) {
          this.events.emit('dryFire', { actor: a });
          w.latched = true;
        }
        this.startReload(a, w, time);
      } else if (st.automatic || !w.latched) {
        this.fire(a, w, time);
      }
    }
  }

  private setScoped(a: Actor, w: Weapon, scoped: boolean): void {
    if (w.scoped === scoped) return;
    w.scoped = scoped;
    this.events.emit('scope', { actor: a, scoped });
  }

  startReload(a: Actor, w: Weapon, time: number): void {
    const st = w.stats;
    if (st.melee || w.reloading || w.mag >= st.magSize || w.reserve <= 0) return;
    if (w.scoped) this.setScoped(a, w, false);
    w.resumeScopeAt = 0;
    const start = Math.max(time, w.nextFireTime);
    w.reloadStart = start;
    w.reloadEnd = start + st.reloadTime;
    this.events.emit('reload', { actor: a, weapon: w.id });
  }

  // ─── firing ──────────────────────────────────────────────────────

  private fire(a: Actor, w: Weapon, time: number): void {
    const st = w.stats;
    w.mag--;
    w.nextFireTime = time + st.fireInterval;
    w.lastShotTime = time;
    w.latched = true;

    const inacc = this.inaccuracy(a, w);
    const rc = 1 - a.recoilControl;
    a.eyePosition(_origin);
    a.viewDir(_dir, w.recoilPitch * rc, w.recoilYaw * rc);
    applySpread(_dir, inacc);

    const tr = this.traceRay(_origin, _dir, st.range, a);
    if (tr.actor && tr.zone) {
      const dmg = st.damage * CONFIG.damage.zones[tr.zone] * Math.pow(st.rangeModifier, tr.t / 10);
      applyDamage(this.events, tr.actor, a, dmg, tr.zone, st.id, st.armorPen, time);
    } else if (tr.hitWorld) {
      this.events.emit('impact', { point: tr.point, normal: tr.normal, surface: tr.surface });
    }
    this.events.emit('shot', { shooter: a, weapon: st, origin: _origin, end: tr.point, hitActor: !!tr.actor });

    const pat = st.recoil.pattern;
    const d = pat[Math.min(w.sprayIndex, pat.length - 1)];
    const j = st.recoil.jitterDeg;
    w.recoilPitch += (d[0] + (Math.random() * 2 - 1) * j * 0.5) * DEG;
    w.recoilYaw += (d[1] + (Math.random() * 2 - 1) * j) * DEG;
    w.sprayIndex++;
    w.shotSpread = Math.min(st.spread.maxShot, w.shotSpread + st.spread.perShot);

    if (st.scope && w.scoped) {
      this.setScoped(a, w, false);
      w.resumeScopeAt = w.nextFireTime;
    }
    if (w.mag === 0 && w.reserve > 0) this.startReload(a, w, time);
  }

  private melee(a: Actor, w: Weapon, time: number, heavy: boolean): void {
    const st = w.stats;
    const m = st.melee;
    if (!m) return;
    w.nextFireTime = time + (heavy ? m.heavyInterval : st.fireInterval);
    w.lastShotTime = time;
    a.eyePosition(_origin);
    a.viewDir(_dir);
    const tr = this.traceRay(_origin, _dir, st.range, a);
    if (tr.actor) {
      const victim = tr.actor;
      let dmg = heavy ? m.heavyDamage : st.damage;
      // behind the victim?
      const vx = -Math.sin(victim.yaw);
      const vz = -Math.cos(victim.yaw);
      const dx = victim.pos.x - a.pos.x;
      const dz = victim.pos.z - a.pos.z;
      const dl = Math.hypot(dx, dz) || 1;
      if ((vx * dx + vz * dz) / dl > 0.5) dmg *= m.backstabMul;
      applyDamage(this.events, victim, a, dmg, null, st.id, st.armorPen, time);
    } else if (tr.hitWorld) {
      this.events.emit('impact', { point: tr.point, normal: tr.normal, surface: tr.surface });
    }
    this.events.emit('melee', { actor: a, hit: !!tr.actor });
  }

  /** Nearest hit among level geometry and enemy hitboxes. */
  traceRay(origin: THREE.Vector3, dir: THREE.Vector3, range: number, shooter: Actor | null): TraceResult {
    const tr = this.trace;
    tr.actor = null;
    tr.zone = null;
    tr.hitWorld = false;
    tr.surface = '';
    let best = range;
    if (this.world.raycast(origin, dir, range, _rh)) {
      best = _rh.t;
      tr.hitWorld = true;
      tr.normal.copy(_rh.normal);
      tr.surface = _rh.box?.tag ?? '';
    }
    for (const b of this.actors()) {
      if (b === shooter || !b.alive) continue;
      if (shooter && !this.friendlyFire && b.team === shooter.team) continue;
      const hb = b.hitboxes;
      // coarse reject with a box around the whole body
      if (!rayHitsBody(origin, dir, b, best)) continue;
      for (const z of ZONES) {
        const t = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, hb[z], best);
        if (t >= 0 && t < best) {
          best = t;
          tr.actor = b;
          tr.zone = z;
        }
      }
    }
    if (tr.actor) tr.hitWorld = false;
    tr.t = best;
    tr.point.copy(dir).multiplyScalar(best).add(origin);
    return tr;
  }
}

const _union = new AABB();

function rayHitsBody(o: THREE.Vector3, d: THREE.Vector3, b: Actor, maxT: number): boolean {
  const hb = b.hitboxes;
  _union.set(hb.body.min[0], hb.legs.min[1], hb.body.min[2], hb.body.max[0], hb.head.max[1], hb.body.max[2]);
  return rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, _union, maxT) >= 0;
}

/** Random direction inside a cone; center-weighted like classic tactical shooters. */
export function applySpread(dir: THREE.Vector3, halfAngle: number): void {
  if (halfAngle <= 0) return;
  _right.crossVectors(dir, _worldUp);
  if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
  _right.normalize();
  _up.crossVectors(_right, dir).normalize();
  const theta = Math.random() * Math.PI * 2;
  const r = Math.tan(Math.random() * halfAngle);
  dir.addScaledVector(_right, Math.cos(theta) * r).addScaledVector(_up, Math.sin(theta) * r).normalize();
}
