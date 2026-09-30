import * as THREE from 'three';
import { CONFIG, type BotSkill, type Team } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { WeaponSystem } from '../weapons/WeaponSystem';
import type { MapDef, SiteDef } from '../world/MapDef';
import { BotBrain, type BotContext, type BotOrder } from './BotBrain';
import type { NavGraph, NavNode } from './NavGraph';

export type BombStatus = 'none' | 'carried' | 'dropped' | 'planted' | 'defused' | 'exploded';

/** Read-only view of round/bomb state the bots plan around. */
export interface ObjectiveView {
  live: boolean;
  bomb: BombStatus;
  /** carrier position, dropped position or planted position */
  bombPos: THREE.Vector3;
  carrier: Actor | null;
  plantedSite: 'A' | 'B' | null;
  roundTime: number;
}

interface TeamIntel {
  pos: THREE.Vector3;
  time: number;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Team-level planning: picks the attack site each round, assigns defender
 * posts, rotates defenders on intel, sends the carrier to plant and the
 * nearest defender to defuse. Individual combat lives in BotBrain.
 */
export class BotManager {
  readonly brains = new Map<Actor, BotBrain>();
  private attackSite: SiteDef;
  private readonly intel: Record<Team, TeamIntel> = {
    attack: { pos: new THREE.Vector3(), time: -100 },
    defend: { pos: new THREE.Vector3(), time: -100 },
  };
  private rotated = false;
  private time = 0;
  private readonly ctx: BotContext;
  /** per-bot preferred node for this round */
  private readonly posts = new Map<Actor, NavNode>();
  /** per-bot entrance to watch, keyed by actor id + site */
  private readonly looks = new Map<string, THREE.Vector3>();
  private readonly nextOrder = new Map<Actor, number>();

  constructor(
    private readonly map: MapDef,
    private readonly nav: NavGraph,
    world: CollisionWorld,
    weapons: WeaponSystem,
    actors: () => Actor[],
    events: EventBus<GameEvents>,
  ) {
    this.attackSite = map.sites[0];
    this.ctx = {
      world,
      nav,
      weapons,
      actors,
      report: (_obs, enemy) => {
        const intel = this.intel[_obs.team];
        intel.pos.copy(enemy.pos);
        intel.time = this.time;
      },
    };
    // hearing
    events.on('shot', (e) => {
      const r = CONFIG.bots.hearingRange * (e.weapon.id === 'talon' ? 0.2 : 1);
      for (const [a, b] of this.brains) {
        if (!a.alive || a.team === e.shooter.team) continue;
        if (a.pos.distanceTo(e.shooter.pos) < r) b.hear(e.shooter.pos, this.time);
      }
    });
    events.on('footstep', (e) => {
      if (!e.loud) return;
      for (const [a, b] of this.brains) {
        if (!a.alive || a.team === e.actor.team) continue;
        if (a.pos.distanceTo(e.actor.pos) < 16) b.hear(e.actor.pos, this.time);
      }
    });
  }

  add(actor: Actor, skill: BotSkill): BotBrain {
    const b = new BotBrain(actor, this.ctx, skill);
    this.brains.set(actor, b);
    return b;
  }

  clear(): void {
    this.brains.clear();
  }

  setSkill(skill: BotSkill): void {
    for (const [a, b] of this.brains) {
      b.skill = skill;
      a.recoilControl = skill.recoilControl;
    }
  }

  /** call at the start of each round */
  newRound(): void {
    this.attackSite = pick(this.map.sites);
    this.rotated = false;
    this.intel.attack.time = this.intel.defend.time = -100;
    this.posts.clear();
    this.looks.clear();
    this.nextOrder.clear();
    for (const b of this.brains.values()) b.resetForRound();

    // defenders: 2 A, 2 B, 1 mid (order shuffled)
    const defenders = [...this.brains.keys()].filter((a) => a.team === 'defend');
    const slots = ['holdA', 'holdB', 'holdMid', 'holdA', 'holdB'];
    defenders.sort(() => Math.random() - 0.5);
    defenders.forEach((a, i) => {
      const nodes = this.nav.byTag(slots[i % slots.length]);
      const used = new Set(this.posts.values());
      const free = nodes.filter((n) => !used.has(n));
      this.posts.set(a, pick(free.length ? free : nodes));
    });
    // attackers: spread over nodes of the chosen site
    const attackers = [...this.brains.keys()].filter((a) => a.team === 'attack');
    const siteNodes = this.nav.byTag(this.attackSite.name);
    attackers.forEach((a) => this.posts.set(a, pick(siteNodes)));
  }

  get targetSite(): SiteDef {
    return this.attackSite;
  }

  update(dt: number, time: number, obj: ObjectiveView, frozen: boolean): void {
    this.time = time;
    for (const [a, b] of this.brains) {
      if (!a.alive) continue;
      if (!frozen && obj.live && time >= (this.nextOrder.get(a) ?? 0)) {
        this.nextOrder.set(a, time + 0.25);
        b.order = this.orderFor(a, b, obj);
      }
      b.update(dt, time);
      if (frozen) {
        a.intent.forward = a.intent.right = 0;
        a.intent.jump = false;
        a.weaponIntent.fire = false;
      }
    }
  }

  private siteLook(a: Actor, site: SiteDef): THREE.Vector3 {
    const key = `${a.id}:${site.name}`;
    let v = this.looks.get(key);
    if (!v) {
      const e = pick(site.entrances);
      v = new THREE.Vector3(e[0], 1.4, e[1]);
      this.looks.set(key, v);
    }
    return v;
  }

  private siteByName(n: 'A' | 'B'): SiteDef {
    return this.map.sites.find((s) => s.name === n) ?? this.map.sites[0];
  }

  private order(goal: THREE.Vector3, look: THREE.Vector3 | null, use = false, walk = false, radius = 0.8): BotOrder {
    return { goal, look, use, walk, radius };
  }

  private orderFor(a: Actor, b: BotBrain, obj: ObjectiveView): BotOrder {
    const prev = b.order;
    const keep = (goal: THREE.Vector3, look: THREE.Vector3 | null, use = false, walk = false, radius = 0.8): BotOrder => {
      if (prev && prev.goal.distanceToSquared(goal) < 0.25 && prev.use === use) {
        prev.look = look;
        prev.walk = walk;
        return prev;
      }
      return this.order(goal.clone(), look ? look.clone() : null, use, walk, radius);
    };

    if (a.team === 'attack') {
      if (obj.bomb === 'carried' && obj.carrier === a) {
        const plant = this.nav.byTag('plant' + this.attackSite.name)[0];
        return keep(plant.pos, this.siteLook(a, this.attackSite), true, false, 0.9);
      }
      if (obj.bomb === 'dropped') {
        // nearest living attacker fetches it
        let nearest: Actor | null = null;
        let nd = Infinity;
        for (const x of this.brains.keys()) {
          if (!x.alive || x.team !== 'attack') continue;
          const d = x.pos.distanceTo(obj.bombPos);
          if (d < nd) {
            nd = d;
            nearest = x;
          }
        }
        if (nearest === a) return keep(obj.bombPos, null, false, false, 0.5);
      }
      if (obj.bomb === 'planted' && obj.plantedSite) {
        const site = this.siteByName(obj.plantedSite);
        let post = this.posts.get(a);
        if (!post || !post.tags.has(site.name)) {
          post = pick(this.nav.byTag(site.name));
          this.posts.set(a, post);
        }
        return keep(post.pos, this.siteLook(a, site));
      }
      const post = this.posts.get(a) ?? this.nav.nodes[0];
      return keep(post.pos, this.siteLook(a, this.attackSite));
    }

    // defenders
    if (obj.bomb === 'planted') {
      let nearest: Actor | null = null;
      let nd = Infinity;
      for (const x of this.brains.keys()) {
        if (!x.alive || x.team !== 'defend') continue;
        const d = x.pos.distanceTo(obj.bombPos);
        if (d < nd) {
          nd = d;
          nearest = x;
        }
      }
      if (nearest === a) return keep(obj.bombPos, null, !b.targetVisible, false, CONFIG.bomb.useRange * 0.6);
      const site = this.siteByName(obj.plantedSite ?? 'A');
      let post = this.posts.get(a);
      if (!post || !post.tags.has(site.name)) {
        post = pick(this.nav.byTag(site.name));
        this.posts.set(a, post);
      }
      return keep(post.pos, obj.bombPos);
    }

    // rotate one or two defenders toward reported contact on a site
    const intel = this.intel.defend;
    if (!this.rotated && this.time - intel.time < 2 && obj.roundTime > 20) {
      const site = this.map.sites.find((s) => inRect(s, intel.pos, 8));
      if (site) {
        this.rotated = true;
        let moved = 0;
        for (const [x] of this.brains) {
          if (x.team !== 'defend' || !x.alive || moved >= 2) continue;
          const post = this.posts.get(x);
          if (post && !post.tags.has(site.name)) {
            this.posts.set(x, pick(this.nav.byTag(site.name)));
            moved++;
          }
        }
      }
    }
    const post = this.posts.get(a) ?? this.nav.nodes[0];
    return keep(post.pos, post.look);
  }
}

function inRect(s: SiteDef, p: THREE.Vector3, margin: number): boolean {
  return p.x > s.min[0] - margin && p.x < s.max[0] + margin && p.z > s.min[1] - margin && p.z < s.max[1] + margin;
}

