import * as THREE from 'three';
import { CONFIG } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';
import { makeDecalTexture } from '../world/Textures';

const E = CONFIG.effects;
const HIDDEN_Y = -1000;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _muzzle = new THREE.Vector3();

interface Tracer {
  start: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  travelled: number;
  active: boolean;
}

/**
 * Pooled combat visuals, each a single draw call:
 * tracers (LineSegments), bullet-hole decals (InstancedMesh), particles (Points),
 * plus one reusable muzzle point light.
 */
export class Effects {
  private readonly tracers: Tracer[] = [];
  private readonly tracerGeo: THREE.BufferGeometry;
  private readonly tracerPos: Float32Array;
  private readonly tracerCol: Float32Array;
  private readonly decals: THREE.InstancedMesh;
  private decalNext = 0;
  private decalCount = 0;

  private readonly pPos: Float32Array;
  private readonly pCol: Float32Array;
  private readonly pVel: Float32Array;
  private readonly pLife: Float32Array;
  private readonly pMaxLife: Float32Array;
  private readonly pBase: Float32Array;
  private readonly pGravity: Float32Array;
  private pNext = 0;
  private readonly particleGeo: THREE.BufferGeometry;

  private readonly muzzleLight: THREE.PointLight;
  private muzzleTime = 0;

  constructor(
    scene: THREE.Scene,
    events: EventBus<GameEvents>,
    /** world-space muzzle position for an actor (viewmodel muzzle for the local player) */
    private readonly muzzleOf: (a: Actor, out: THREE.Vector3) => THREE.Vector3,
  ) {
    // tracers
    this.tracerPos = new Float32Array(E.maxTracers * 6).fill(HIDDEN_Y);
    this.tracerCol = new Float32Array(E.maxTracers * 6);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    const lines = new THREE.LineSegments(
      this.tracerGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    lines.frustumCulled = false;
    scene.add(lines);
    for (let i = 0; i < E.maxTracers; i++) {
      this.tracers.push({ start: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, active: false });
    }

    // decals
    const decalMat = new THREE.MeshBasicMaterial({
      map: makeDecalTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.11), decalMat, E.maxDecals);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.decals);

    // particles
    const n = E.maxParticles;
    this.pPos = new Float32Array(n * 3).fill(HIDDEN_Y);
    this.pCol = new Float32Array(n * 4);
    this.pVel = new Float32Array(n * 3);
    this.pLife = new Float32Array(n);
    this.pMaxLife = new Float32Array(n);
    this.pBase = new Float32Array(n * 3);
    this.pGravity = new Float32Array(n);
    this.particleGeo = new THREE.BufferGeometry();
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(
      this.particleGeo,
      new THREE.PointsMaterial({ size: 0.07, map: makeSoftDot(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }),
    );
    points.frustumCulled = false;
    scene.add(points);

    this.muzzleLight = new THREE.PointLight(0xffc27a, 0, 9, 2);
    scene.add(this.muzzleLight);

    events.on('shot', (e) => {
      this.muzzleOf(e.shooter, _muzzle);
      if (e.weapon.id !== 'talon') {
        this.addTracer(_muzzle, e.end);
        this.muzzleLight.position.copy(_muzzle);
        this.muzzleLight.intensity = e.weapon.id === 'longbow' ? 60 : 30;
        this.muzzleTime = 0.05;
        this.burst(_muzzle, _z.set(0, 1, 0), 3, [1, 0.8, 0.4], 0.6, 0.05, 0);
      }
      if (e.hitActor) this.burst(e.end, _p.set(0, 0.3, 0), 10, [0.55, 0.04, 0.03], 2.2, 0.35, 9);
    });
    events.on('impact', (e) => {
      this.addDecal(e.point, e.normal);
      const metal = e.surface === 'metal';
      this.burst(e.point, e.normal, metal ? 7 : 8, metal ? [1, 0.75, 0.35] : [0.55, 0.5, 0.42], metal ? 4 : 1.8, metal ? 0.25 : 0.55, metal ? 12 : 3);
    });
  }

  addTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    let t = this.tracers.find((x) => !x.active);
    if (!t) t = this.tracers[0];
    t.start.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 0.5) return;
    t.dir.multiplyScalar(1 / t.dist);
    t.travelled = 0;
    t.active = true;
  }

  addDecal(point: THREE.Vector3, normal: THREE.Vector3): void {
    _q.setFromUnitVectors(_z, normal);
    _q2.setFromAxisAngle(_z, Math.random() * Math.PI * 2);
    _q.multiply(_q2);
    const sc = 0.8 + Math.random() * 0.5;
    _s.set(sc, sc, sc);
    _p.copy(point).addScaledVector(normal, 0.004);
    _m.compose(_p, _q, _s);
    this.decals.setMatrixAt(this.decalNext, _m);
    this.decalNext = (this.decalNext + 1) % E.maxDecals;
    this.decalCount = Math.min(this.decalCount + 1, E.maxDecals);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** spawn `count` particles around `pos`, biased along `dir` */
  burst(pos: THREE.Vector3, dir: THREE.Vector3, count: number, color: [number, number, number], speed: number, life: number, gravity: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % E.maxParticles;
      this.pPos[i * 3] = pos.x;
      this.pPos[i * 3 + 1] = pos.y;
      this.pPos[i * 3 + 2] = pos.z;
      this.pVel[i * 3] = (dir.x + (Math.random() - 0.5) * 1.4) * speed * (0.4 + Math.random());
      this.pVel[i * 3 + 1] = (dir.y + (Math.random() - 0.3) * 1.4) * speed * (0.4 + Math.random());
      this.pVel[i * 3 + 2] = (dir.z + (Math.random() - 0.5) * 1.4) * speed * (0.4 + Math.random());
      const l = life * (0.6 + Math.random() * 0.8);
      this.pLife[i] = l;
      this.pMaxLife[i] = l;
      this.pBase[i * 3] = color[0];
      this.pBase[i * 3 + 1] = color[1];
      this.pBase[i * 3 + 2] = color[2];
      this.pGravity[i] = gravity;
    }
  }

  update(dt: number): void {
    // tracers
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      const o = i * 6;
      if (!t.active) {
        if (this.tracerPos[o + 1] !== HIDDEN_Y) {
          this.tracerPos.fill(HIDDEN_Y, o, o + 6);
        }
        continue;
      }
      t.travelled += E.tracerSpeed * dt;
      const head = Math.min(t.travelled, t.dist);
      const tail = Math.max(0, t.travelled - E.tracerLength);
      if (tail >= t.dist) {
        t.active = false;
        this.tracerPos.fill(HIDDEN_Y, o, o + 6);
        continue;
      }
      this.tracerPos[o] = t.start.x + t.dir.x * tail;
      this.tracerPos[o + 1] = t.start.y + t.dir.y * tail;
      this.tracerPos[o + 2] = t.start.z + t.dir.z * tail;
      this.tracerPos[o + 3] = t.start.x + t.dir.x * head;
      this.tracerPos[o + 4] = t.start.y + t.dir.y * head;
      this.tracerPos[o + 5] = t.start.z + t.dir.z * head;
      this.tracerCol[o] = 0.25; this.tracerCol[o + 1] = 0.18; this.tracerCol[o + 2] = 0.08;
      this.tracerCol[o + 3] = 1.0; this.tracerCol[o + 4] = 0.85; this.tracerCol[o + 5] = 0.5;
    }
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;

    // particles
    const n = E.maxParticles;
    for (let i = 0; i < n; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pPos[i * 3 + 1] = HIDDEN_Y;
        this.pCol[i * 4 + 3] = 0;
        continue;
      }
      this.pVel[i * 3 + 1] -= this.pGravity[i] * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      const f = this.pLife[i] / this.pMaxLife[i];
      this.pCol[i * 4] = this.pBase[i * 3];
      this.pCol[i * 4 + 1] = this.pBase[i * 3 + 1];
      this.pCol[i * 4 + 2] = this.pBase[i * 3 + 2];
      this.pCol[i * 4 + 3] = f;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;

    if (this.muzzleTime > 0) {
      this.muzzleTime -= dt;
      if (this.muzzleTime <= 0) this.muzzleLight.intensity = 0;
    }
  }

  clear(): void {
    for (const t of this.tracers) t.active = false;
    this.decalCount = 0;
    this.decals.count = 0;
    this.pLife.fill(0);
    this.pPos.fill(HIDDEN_Y);
    this.muzzleLight.intensity = 0;
  }
}

function makeSoftDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  }
  return new THREE.CanvasTexture(c);
}
