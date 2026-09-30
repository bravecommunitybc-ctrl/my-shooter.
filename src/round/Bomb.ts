import * as THREE from 'three';
import type { BombStatus } from '../ai/BotManager';
import { CONFIG } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';
import { applyDamage } from '../weapons/Damage';
import type { MapDef, SiteDef } from '../world/MapDef';

const C = CONFIG.bomb;

/**
 * The Pulse Charge: carried → (dropped ↔ carried) → planted → defused | exploded.
 * Plant/defuse progress resets if the use key is released.
 */
export class Bomb {
  status: BombStatus = 'none';
  readonly pos = new THREE.Vector3();
  carrier: Actor | null = null;
  site: 'A' | 'B' | null = null;
  /** seconds until detonation once planted */
  timer = 0;
  planter: Actor | null = null;
  plantProgress = 0;
  defuser: Actor | null = null;
  defuseProgress = 0;
  private nextBeep = 0;
  private lampOffAt = 0;

  readonly mesh = new THREE.Group();
  private readonly lamp: THREE.Mesh;
  private readonly lampMat: THREE.MeshBasicMaterial;
  private readonly light: THREE.PointLight;

  constructor(private readonly map: MapDef, private readonly events: EventBus<GameEvents>) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.16, 0.26),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.2 }),
    );
    body.position.y = 0.08;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), new THREE.MeshStandardMaterial({ color: 0x151719 }));
    panel.position.set(-0.04, 0.17, 0);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x551111 });
    this.lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), this.lampMat);
    this.lamp.position.set(0.11, 0.175, 0);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xf2a541 }));
    strap.position.set(0, 0.08, 0.1);
    this.mesh.add(body, panel, this.lamp, strap);
    this.light = new THREE.PointLight(0xff3030, 0, 4, 2);
    this.light.position.y = 0.4;
    this.mesh.add(this.light);
    this.mesh.visible = false;
  }

  reset(): void {
    this.status = 'none';
    this.carrier = null;
    this.site = null;
    this.timer = 0;
    this.planter = null;
    this.plantProgress = 0;
    this.defuser = null;
    this.defuseProgress = 0;
    this.mesh.visible = false;
    this.light.intensity = 0;
  }

  giveTo(a: Actor): void {
    if (this.carrier) this.carrier.hasBomb = false;
    this.status = 'carried';
    this.carrier = a;
    a.hasBomb = true;
    this.mesh.visible = false;
    this.events.emit('bombPickup', { actor: a });
  }

  siteAt(p: THREE.Vector3): SiteDef | null {
    for (const s of this.map.sites) {
      if (p.x >= s.min[0] && p.x <= s.max[0] && p.z >= s.min[1] && p.z <= s.max[1]) return s;
    }
    return null;
  }

  /** planting / defusing actors cannot move or shoot */
  isBusy(a: Actor): boolean {
    return (this.planter === a && this.plantProgress > 0) || (this.defuser === a && this.defuseProgress > 0);
  }

  canPlant(a: Actor): boolean {
    return this.status === 'carried' && this.carrier === a && a.alive && a.onGround && this.siteAt(a.pos) !== null;
  }

  canDefuse(a: Actor): boolean {
    return (
      this.status === 'planted' && a.alive && a.team === 'defend' && a.onGround &&
      Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < C.useRange && Math.abs(a.pos.y - this.pos.y) < 1.5 &&
      (!this.defuser || this.defuser === a)
    );
  }

  /** advances plant/defuse/timer; the round manager reacts to `status` changes via events */
  update(dt: number, time: number, actors: Actor[]): void {
    switch (this.status) {
      case 'carried': {
        const c = this.carrier;
        if (!c || !c.alive) {
          this.drop(c);
          break;
        }
        if (c.weaponIntent.use && this.canPlant(c)) {
          if (this.planter !== c || this.plantProgress === 0) {
            this.planter = c;
            this.events.emit('plantStart', { actor: c });
          }
          this.plantProgress += dt;
          if (this.plantProgress >= C.plantTime) this.plant(c, time);
        } else {
          this.planter = null;
          this.plantProgress = 0;
        }
        break;
      }
      case 'dropped': {
        for (const a of actors) {
          if (!a.alive || a.team !== 'attack') continue;
          if (Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < C.pickupRange && Math.abs(a.pos.y - this.pos.y) < 1.2) {
            this.giveTo(a);
            break;
          }
        }
        this.spin(dt);
        break;
      }
      case 'planted': {
        this.timer -= dt;
        // defuse
        if (this.defuser && (!this.defuser.alive || !this.defuser.weaponIntent.use || !this.canDefuse(this.defuser))) {
          this.defuser = null;
          this.defuseProgress = 0;
        }
        if (!this.defuser) {
          for (const a of actors) {
            if (a.team === 'defend' && a.weaponIntent.use && this.canDefuse(a)) {
              this.defuser = a;
              this.defuseProgress = 0;
              this.events.emit('defuseStart', { actor: a, kit: a.hasKit });
              break;
            }
          }
        }
        if (this.defuser) {
          this.defuseProgress += dt;
          if (this.defuseProgress >= this.defuseTime(this.defuser)) {
            this.status = 'defused';
            this.light.intensity = 0;
            this.lampMat.color.setHex(0x113311);
            this.events.emit('bombDefused', { actor: this.defuser });
            break;
          }
        }
        if (this.timer <= 0) {
          this.explode(actors, time);
          break;
        }
        if (time >= this.nextBeep) {
          const urgency = 1 - Math.max(0, this.timer) / C.timer;
          this.nextBeep = time + Math.max(0.1, 1.1 - urgency * 1.05);
          this.lampOffAt = time + 0.09;
          this.lampMat.color.setHex(0xff2020);
          this.light.intensity = 2.5;
          this.events.emit('bombBeep', { pos: this.pos, urgency });
        } else if (time >= this.lampOffAt && this.light.intensity > 0) {
          this.lampMat.color.setHex(0x551111);
          this.light.intensity = 0;
        }
        break;
      }
      default:
        break;
    }
  }

  defuseTime(a: Actor): number {
    return a.hasKit ? C.defuseTimeKit : C.defuseTime;
  }

  private drop(c: Actor | null): void {
    this.status = 'dropped';
    this.planter = null;
    this.plantProgress = 0;
    if (c) {
      c.hasBomb = false;
      this.pos.set(c.pos.x, c.pos.y, c.pos.z);
      this.events.emit('bombDrop', { actor: c, pos: this.pos });
    }
    this.carrier = null;
    this.mesh.position.copy(this.pos);
    this.mesh.visible = true;
  }

  private plant(c: Actor, time: number): void {
    const site = this.siteAt(c.pos);
    this.status = 'planted';
    this.site = site ? site.name : 'A';
    this.timer = C.timer;
    this.nextBeep = time;
    this.pos.set(c.pos.x, c.pos.y, c.pos.z);
    c.hasBomb = false;
    this.carrier = null;
    this.planter = null;
    this.plantProgress = 0;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, c.yaw, 0);
    this.mesh.visible = true;
    this.events.emit('bombPlanted', { actor: c, site: this.site, pos: this.pos });
  }

  private explode(actors: Actor[], time: number): void {
    this.status = 'exploded';
    this.mesh.visible = false;
    this.light.intensity = 0;
    const sigma = C.blastRadius / 3;
    for (const a of actors) {
      if (!a.alive) continue;
      const d = a.pos.distanceTo(this.pos);
      if (d > C.blastRadius) continue;
      const dmg = C.blastDamage * Math.exp(-(d * d) / (2 * sigma * sigma));
      applyDamage(this.events, a, null, dmg, null, 'bomb', 0.6, time);
    }
    this.events.emit('bombExploded', { pos: this.pos });
  }

  private spin(dt: number): void {
    this.mesh.rotation.y += dt * 0.8;
  }
}
