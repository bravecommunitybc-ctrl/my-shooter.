import * as THREE from 'three';
import type { MatId } from './MapDef';

/** Deterministic PRNG so textures look the same every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Base colour + per-pixel noise + low-frequency blotches. */
function noiseFill(ctx: CanvasRenderingContext2D, size: number, base: RGB, variance: number, rand: () => number, blotch = 0.15): void {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  // coarse value noise for blotches
  const g = 8;
  const grid: number[] = [];
  for (let i = 0; i < (g + 1) * (g + 1); i++) grid.push(rand() * 2 - 1);
  const cell = size / g;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      const fx = x / cell - gx;
      const fy = y / cell - gy;
      const i00 = grid[(gy % g) * (g + 1) + (gx % g)];
      const i10 = grid[(gy % g) * (g + 1) + ((gx + 1) % g)];
      const i01 = grid[((gy + 1) % g) * (g + 1) + (gx % g)];
      const i11 = grid[((gy + 1) % g) * (g + 1) + ((gx + 1) % g)];
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const low = (i00 * (1 - sx) + i10 * sx) * (1 - sy) + (i01 * (1 - sx) + i11 * sx) * sy;
      const n = (rand() * 2 - 1) * variance + low * blotch * 255 * 0.3;
      const o = (y * size + x) * 4;
      d[o] = base[0] + n;
      d[o + 1] = base[1] + n;
      d[o + 2] = base[2] + n * 0.9;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function finish(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

const painters: Record<MatId, (ctx: CanvasRenderingContext2D, s: number, r: () => number) => void> = {
  sand(ctx, s, r) {
    noiseFill(ctx, s, [190, 166, 128], 16, r, 0.35);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(${90 + r() * 60},${80 + r() * 40},${60 + r() * 30},${0.25 + r() * 0.3})`;
      const w = 1 + r() * 3;
      ctx.fillRect(r() * s, r() * s, w, w);
    }
  },
  concrete(ctx, s, r) {
    noiseFill(ctx, s, [142, 140, 134], 10, r, 0.25);
    ctx.strokeStyle = 'rgba(40,40,40,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(60,55,50,${0.05 + r() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  wall(ctx, s, r) {
    noiseFill(ctx, s, [176, 146, 108], 12, r, 0.3);
    const rows = 4;
    const rh = s / rows;
    ctx.strokeStyle = 'rgba(70,50,35,0.45)';
    ctx.lineWidth = 3;
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * rh);
      ctx.lineTo(s, y * rh);
      ctx.stroke();
      const off = y % 2 ? s / 4 : 0;
      for (let x = off; x < s; x += s / 2) {
        ctx.beginPath();
        ctx.moveTo(x, y * rh);
        ctx.lineTo(x, (y + 1) * rh);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,240,210,${r() * 0.08})`;
      ctx.fillRect(r() * s, r() * s, 4 + r() * 20, 2 + r() * 8);
    }
  },
  crate(ctx, s, r) {
    noiseFill(ctx, s, [150, 108, 64], 14, r, 0.2);
    const planks = 5;
    ctx.strokeStyle = 'rgba(60,35,15,0.6)';
    ctx.lineWidth = 3;
    for (let i = 1; i < planks; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * s) / planks);
      ctx.lineTo(s, (i * s) / planks);
      ctx.stroke();
    }
    const b = s * 0.1;
    ctx.fillStyle = 'rgb(112,76,42)';
    ctx.fillRect(0, 0, s, b);
    ctx.fillRect(0, s - b, s, b);
    ctx.fillRect(0, 0, b, s);
    ctx.fillRect(s - b, 0, b, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-s * 0.7, -b / 2, s * 1.4, b);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,22,8,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b, b, s - 2 * b, s - 2 * b);
  },
  metal(ctx, s, r) {
    noiseFill(ctx, s, [84, 96, 104], 8, r, 0.2);
    const ribs = 8;
    for (let i = 0; i < ribs; i++) {
      const x = (i * s) / ribs;
      const grad = ctx.createLinearGradient(x, 0, x + s / ribs, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0.08)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, s / ribs, s);
    }
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `rgba(120,70,40,${0.08 + r() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 4 + r() * 16, 3 + r() * 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  trim(ctx, s, r) {
    noiseFill(ctx, s, [70, 66, 62], 8, r, 0.2);
  },
  pad(ctx, s, r) {
    noiseFill(ctx, s, [128, 126, 120], 9, r, 0.2);
    ctx.strokeStyle = 'rgba(230,190,60,0.55)';
    ctx.lineWidth = 8;
    ctx.setLineDash([24, 16]);
    ctx.strokeRect(6, 6, s - 12, s - 12);
  },
};

export function makeMaterialTexture(mat: MatId, seed = 1): THREE.CanvasTexture {
  const size = 256;
  const [c, ctx] = canvas(size);
  painters[mat](ctx, size, mulberry32(seed * 7919 + mat.length * 131));
  return finish(c);
}

/** Painted letters on walls. */
export function makeLabelTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const h = 256;
  const w = Math.max(256, text.length * 170);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.font = 'bold 210px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, w / 2, h / 2 + 8);
  // weathering
  const r = mulberry32(text.charCodeAt(0));
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 160; i++) {
    ctx.globalAlpha = r() * 0.5;
    ctx.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / h };
}

/** Round soft decal used for bullet holes. */
export function makeDecalTexture(): THREE.CanvasTexture {
  const s = 64;
  const [c, ctx] = canvas(s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(10,8,6,1)');
  g.addColorStop(0.25, 'rgba(20,16,12,0.95)');
  g.addColorStop(0.5, 'rgba(40,34,28,0.5)');
  g.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
