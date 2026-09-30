import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { MapDef } from '../world/MapDef';

export interface NavLink {
  to: number;
  cost: number;
}

export interface NavNode {
  id: number;
  pos: THREE.Vector3;
  tags: Set<string>;
  look: THREE.Vector3 | null;
  links: NavLink[];
}

const MAX_LINK = 17;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Waypoint graph. Nodes come from the map; links are generated
 * automatically when a body-wide corridor between two nodes is clear.
 */
export class NavGraph {
  readonly nodes: NavNode[] = [];

  constructor(def: MapDef, private readonly world: CollisionWorld) {
    def.waypoints.forEach((w, i) => {
      this.nodes.push({
        id: i,
        pos: new THREE.Vector3(w.pos[0], 0, w.pos[1]),
        tags: new Set(w.tags ?? []),
        look: w.look ? new THREE.Vector3(w.look[0], 1.4, w.look[1]) : null,
        links: [],
      });
    });
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const d = a.pos.distanceTo(b.pos);
        if (d > MAX_LINK) continue;
        if (!this.corridorClear(a.pos, b.pos)) continue;
        a.links.push({ to: j, cost: d });
        b.links.push({ to: i, cost: d });
      }
    }
  }

  /** clear at knee and chest height, and at both shoulders */
  corridorClear(p: THREE.Vector3, q: THREE.Vector3): boolean {
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * 0.32;
    const nz = (dx / len) * 0.32;
    const tests: [number, number, number][] = [[0, 0.3, 0], [0, 1.1, 0], [nx, 0.5, nz], [-nx, 0.5, -nz]];
    for (const [ox, oy, oz] of tests) {
      _a.set(p.x + ox, p.y + oy, p.z + oz);
      _b.set(q.x + ox, q.y + oy, q.z + oz);
      if (!this.world.segmentClear(_a, _b)) return false;
    }
    return true;
  }

  byTag(tag: string): NavNode[] {
    return this.nodes.filter((n) => n.tags.has(tag));
  }

  /** nearest node reachable in a straight line from `pos` (falls back to plain nearest) */
  nearest(pos: THREE.Vector3): NavNode {
    let best: NavNode | null = null;
    let bestD = Infinity;
    let fallback = this.nodes[0];
    let fallbackD = Infinity;
    for (const n of this.nodes) {
      const d = (n.pos.x - pos.x) ** 2 + (n.pos.z - pos.z) ** 2;
      if (d < fallbackD) {
        fallbackD = d;
        fallback = n;
      }
      if (d < bestD && d < 30 * 30) {
        _a.set(pos.x, pos.y + 0.5, pos.z);
        _b.set(n.pos.x, n.pos.y + 0.5, n.pos.z);
        if (this.world.segmentClear(_a, _b)) {
          bestD = d;
          best = n;
        }
      }
    }
    return best ?? fallback;
  }

  /**
   * A* over the graph. `jitter` (0..1) randomises edge costs per call so
   * bots spread across different routes.
   */
  findPath(from: number, to: number, jitter = 0, rand: () => number = Math.random): number[] | null {
    if (from === to) return [to];
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const f = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open: number[] = [from];
    const goal = this.nodes[to].pos;
    const mul = new Map<number, number>();
    g[from] = 0;
    f[from] = this.nodes[from].pos.distanceTo(goal);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === to) {
        const path: number[] = [];
        for (let c = to; c !== -1; c = came[c]) path.push(c);
        return path.reverse();
      }
      closed[cur] = 1;
      for (const l of this.nodes[cur].links) {
        if (closed[l.to]) continue;
        let m = 1;
        if (jitter > 0) {
          const key = Math.min(cur, l.to) * 4096 + Math.max(cur, l.to);
          let v = mul.get(key);
          if (v === undefined) {
            v = 1 + rand() * jitter;
            mul.set(key, v);
          }
          m = v;
        }
        const ng = g[cur] + l.cost * m;
        if (ng < g[l.to]) {
          if (g[l.to] === Infinity) open.push(l.to);
          g[l.to] = ng;
          f[l.to] = ng + this.nodes[l.to].pos.distanceTo(goal);
          came[l.to] = cur;
        }
      }
    }
    return null;
  }

  /** number of connected components (should be 1) — dev diagnostics */
  components(): number[][] {
    const seen = new Uint8Array(this.nodes.length);
    const comps: number[][] = [];
    for (let s = 0; s < this.nodes.length; s++) {
      if (seen[s]) continue;
      const comp: number[] = [];
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const c = stack.pop() as number;
        comp.push(c);
        for (const l of this.nodes[c].links) {
          if (!seen[l.to]) {
            seen[l.to] = 1;
            stack.push(l.to);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }
}
