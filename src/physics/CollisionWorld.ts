import * as THREE from 'three';
import { AABB, rayAABB, rayFace } from './AABB';

export interface RayHit {
  t: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  box: AABB | null;
}

export function makeRayHit(): RayHit {
  return { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), box: null };
}

const _dir = new THREE.Vector3();

/**
 * Static level geometry as a flat list of AABBs.
 * The map has ~120 boxes, so brute force with cheap early-outs is faster
 * than maintaining a spatial structure (see CLAUDE.md).
 */
export class CollisionWorld {
  readonly boxes: AABB[] = [];

  add(b: AABB): void {
    this.boxes.push(b);
  }

  clear(): void {
    this.boxes.length = 0;
  }

  /** Nearest hit along a normalised direction. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, out: RayHit): boolean {
    let best = maxDist;
    let hitBox: AABB | null = null;
    let axis = 0;
    let sign = 0;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const t = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, boxes[i], best);
      if (t >= 0 && t < best) {
        best = t;
        hitBox = boxes[i];
        axis = rayFace.axis;
        sign = rayFace.sign;
      }
    }
    if (!hitBox) return false;
    out.t = best;
    out.box = hitBox;
    out.point.copy(dir).multiplyScalar(best).add(origin);
    out.normal.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    return true;
  }

  /** True when the straight segment a→b does not touch any box. */
  segmentClear(a: THREE.Vector3, b: THREE.Vector3): boolean {
    _dir.subVectors(b, a);
    const len = _dir.length();
    if (len < 1e-6) return true;
    _dir.multiplyScalar(1 / len);
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      if (rayAABB(a.x, a.y, a.z, _dir.x, _dir.y, _dir.z, boxes[i], len) >= 0) return false;
    }
    return true;
  }

  overlaps(box: AABB): boolean {
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) if (box.intersects(boxes[i])) return true;
    return false;
  }

  /**
   * Swept move of `box` along one axis. Returns the allowed delta
   * (clamped so the box stops flush against the first obstacle).
   */
  sweepAxis(box: AABB, axis: number, delta: number): number {
    if (delta === 0) return 0;
    const a1 = (axis + 1) % 3;
    const a2 = (axis + 2) % 3;
    const eps = 1e-5;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (box.max[a1] <= c.min[a1] + eps || box.min[a1] >= c.max[a1] - eps) continue;
      if (box.max[a2] <= c.min[a2] + eps || box.min[a2] >= c.max[a2] - eps) continue;
      if (delta > 0) {
        const gap = c.min[axis] - box.max[axis];
        if (gap >= -eps * 10 && gap < delta) delta = Math.max(gap, 0);
      } else {
        const gap = c.max[axis] - box.min[axis];
        if (gap <= eps * 10 && gap > delta) delta = Math.min(gap, 0);
      }
    }
    return delta;
  }
}
