import * as THREE from 'three';
import { AABB } from '../physics/AABB';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { BlockDef, MapDef, MatId } from './MapDef';
import { makeLabelTexture, makeMaterialTexture } from './Textures';

/** metres per texture repeat; 0 = one repeat per box face (crates) */
const TILE: Record<MatId, number> = { sand: 5, concrete: 3, wall: 3.2, crate: 0, metal: 2.2, trim: 2, pad: 3 };

const MAT_PARAMS: Record<MatId, { roughness: number; metalness: number }> = {
  sand: { roughness: 1, metalness: 0 },
  concrete: { roughness: 0.95, metalness: 0 },
  wall: { roughness: 0.95, metalness: 0 },
  crate: { roughness: 0.85, metalness: 0 },
  metal: { roughness: 0.6, metalness: 0.35 },
  trim: { roughness: 0.9, metalness: 0 },
  pad: { roughness: 0.95, metalness: 0 },
};

interface GeoAccum {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

/**
 * Appends one box (24 verts) into the accumulator with world-space UVs so
 * textures stay the same scale on every wall regardless of its size.
 */
function pushBox(g: GeoAccum, b: BlockDef, tile: number): void {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [1, 0, 0], v: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { n: [-1, 0, 0], v: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0], v: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
    { n: [0, -1, 0], v: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { n: [0, 0, 1], v: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], v: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
  ];
  for (const f of faces) {
    // skip the bottom face of things standing on the ground
    if (f.n[1] === -1 && y0 <= 0.001) continue;
    const base = g.pos.length / 3;
    const ax = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
    for (let i = 0; i < 4; i++) {
      const [x, y, z] = f.v[i];
      g.pos.push(x, y, z);
      g.nrm.push(f.n[0], f.n[1], f.n[2]);
      let u: number;
      let v: number;
      if (tile > 0) {
        if (ax === 0) { u = z * f.n[0] * -1; v = y; }
        else if (ax === 1) { u = x; v = z; }
        else { u = x * f.n[2]; v = y; }
        u /= tile;
        v /= tile;
      } else {
        u = i === 1 || i === 2 ? 1 : 0;
        v = i >= 2 ? 1 : 0;
      }
      g.uv.push(u, v);
    }
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export interface BuiltMap {
  group: THREE.Group;
  materials: THREE.Material[];
}

/** Builds merged meshes (one draw call per material) and fills the collision world. */
export function buildMap(def: MapDef, world: CollisionWorld, maxAnisotropy: number): BuiltMap {
  const group = new THREE.Group();
  group.name = `map:${def.name}`;
  const accum = new Map<MatId, GeoAccum>();
  world.clear();

  for (const b of def.blocks) {
    let g = accum.get(b.mat);
    if (!g) {
      g = { pos: [], nrm: [], uv: [], idx: [] };
      accum.set(b.mat, g);
    }
    pushBox(g, b, TILE[b.mat]);
    if (!b.noCollide) {
      const box = new AABB(b.min, b.max);
      box.tag = b.mat;
      world.add(box);
    }
  }

  const materials: THREE.Material[] = [];
  let seed = 1;
  for (const [mat, g] of accum) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    const tex = makeMaterialTexture(mat, seed++);
    tex.anisotropy = Math.min(8, maxAnisotropy);
    const m = new THREE.MeshStandardMaterial({ map: tex, ...MAT_PARAMS[mat] });
    materials.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = `mat:${mat}`;
    mesh.castShadow = mat !== 'sand' && mat !== 'pad';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  for (const l of def.labels) {
    const { tex, aspect } = makeLabelTexture(l.text, l.color);
    const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    materials.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.size * aspect, l.size), m);
    mesh.position.set(l.pos[0], l.pos[1], l.pos[2]);
    mesh.rotation.y = l.rotY;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.updateMatrixWorld(true);
  return { group, materials };
}

/** Sky dome + lights. Shadows are rendered once (static level) for performance. */
export function buildEnvironment(scene: THREE.Scene, def: MapDef): THREE.DirectionalLight {
  const skyColor = new THREE.Color(0x9fbad3);
  scene.background = skyColor;
  scene.fog = new THREE.Fog(0xb9c7d2, 70, 190);

  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const colors: number[] = [];
  const top = new THREE.Color(0x4f7fb5);
  const horizon = new THREE.Color(0xd9d2c0);
  const p = skyGeo.getAttribute('position');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 400;
    c.copy(horizon).lerp(top, Math.pow(Math.max(0, y), 0.6));
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x8a6a48, 1.1));

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.4);
  const cx = (def.bounds.min[0] + def.bounds.max[0]) / 2;
  const cz = (def.bounds.min[1] + def.bounds.max[1]) / 2;
  sun.position.set(cx + 40, 80, cz + 30);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  const half = Math.max(def.bounds.max[0] - def.bounds.min[0], def.bounds.max[1] - def.bounds.min[1]) / 2 + 8;
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 10;
  cam.far = 220;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}
