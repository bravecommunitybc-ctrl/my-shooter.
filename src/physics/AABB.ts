export type V3 = [number, number, number];

/** Axis-aligned box stored as min/max arrays so axes can be indexed (0=x, 1=y, 2=z). */
export class AABB {
  min: V3;
  max: V3;
  /** optional tag for gameplay (material id etc.) */
  tag = '';

  constructor(min: V3 = [0, 0, 0], max: V3 = [0, 0, 0]) {
    this.min = [min[0], min[1], min[2]];
    this.max = [max[0], max[1], max[2]];
  }

  set(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    this.min[0] = x0; this.min[1] = y0; this.min[2] = z0;
    this.max[0] = x1; this.max[1] = y1; this.max[2] = z1;
    return this;
  }

  copy(o: AABB): this {
    return this.set(o.min[0], o.min[1], o.min[2], o.max[0], o.max[1], o.max[2]);
  }

  translate(axis: number, d: number): this {
    this.min[axis] += d;
    this.max[axis] += d;
    return this;
  }

  /** strict overlap test, touching faces do not count */
  intersects(o: AABB, eps = 1e-5): boolean {
    return (
      this.max[0] > o.min[0] + eps && this.min[0] < o.max[0] - eps &&
      this.max[1] > o.min[1] + eps && this.min[1] < o.max[1] - eps &&
      this.max[2] > o.min[2] + eps && this.min[2] < o.max[2] - eps
    );
  }

  containsPoint(x: number, y: number, z: number): boolean {
    return x >= this.min[0] && x <= this.max[0] && y >= this.min[1] && y <= this.max[1] && z >= this.min[2] && z <= this.max[2];
  }
}

/** Filled by `rayAABB` with the entry face of the last successful test. */
export const rayFace = { axis: 0, sign: 0 };

/**
 * Slab test. Returns entry distance along the (normalised) direction or -1 on miss.
 * If the origin is inside the box returns 0.
 */
export function rayAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: AABB, tMax: number,
): number {
  let tmin = 0;
  let tmax = tMax;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? ox : i === 1 ? oy : oz;
    const d = i === 0 ? dx : i === 1 ? dy : dz;
    const bmin = b.min[i];
    const bmax = b.max[i];
    if (Math.abs(d) < 1e-12) {
      if (o < bmin || o > bmax) return -1;
      continue;
    }
    const inv = 1 / d;
    let t1 = (bmin - o) * inv;
    let t2 = (bmax - o) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis === -1) {
    // started inside
    rayFace.axis = Math.abs(dx) > Math.abs(dy) ? (Math.abs(dx) > Math.abs(dz) ? 0 : 2) : (Math.abs(dy) > Math.abs(dz) ? 1 : 2);
    rayFace.sign = -Math.sign(rayFace.axis === 0 ? dx : rayFace.axis === 1 ? dy : dz) || 1;
    return 0;
  }
  rayFace.axis = axis;
  rayFace.sign = sign;
  return tmin;
}
