import * as THREE from 'three';
import { CONFIG, type Team, type WeaponId } from '../config';
import type { Actor } from '../entities/Actor';
import type { Weapon } from './Weapon';

interface GunModel {
  group: THREE.Group;
  /** local muzzle position inside `group` */
  muzzle: THREE.Vector3;
  /** resting position of the group in view space */
  rest: THREE.Vector3;
  kick: number;
}

const _v = new THREE.Vector3();

function mat(color: number, metalness = 0.2, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function part(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

/**
 * First-person weapon, rendered in its own scene/camera after the world
 * (depth cleared) so it never clips into walls.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private readonly models: Record<WeaponId, GunModel>;
  private readonly sleeve: THREE.MeshStandardMaterial;
  private readonly flash: THREE.Mesh;
  private readonly flashLight: THREE.PointLight;
  private flashTime = 0;
  private current: WeaponId | null = null;
  private kick = 0;
  private swing = 0;
  private swingHeavy = false;
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private landDip = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CONFIG.render.viewModelFov, 16 / 9, 0.01, 10);
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x6a5440, 1.4));
    const key = new THREE.DirectionalLight(0xfff0d6, 1.8);
    key.position.set(1, 2, 1);
    this.scene.add(key);

    // no env map, so keep metalness low or metals render black
    const metal = mat(0x4a5058, 0.25, 0.45);
    const polymer = mat(0x505546, 0.05, 0.8);
    const wood = mat(0x7a5432, 0.05, 0.7);
    const blade = mat(0xdfe4ea, 0.3, 0.25);
    const glove = mat(0x3a342d, 0.0, 0.9);
    this.sleeve = mat(0x9c5a2c, 0.0, 0.95);
    const accent = mat(0xf2a541, 0.2, 0.5);

    const arm = (g: THREE.Group, x: number, y: number, z: number, ry = 0) => {
      part(g, 0.06, 0.07, 0.1, glove, x, y, z);
      part(g, 0.08, 0.08, 0.3, this.sleeve, x + Math.sin(ry) * 0.17, y - 0.03, z + 0.18, 0, ry, 0);
    };

    // Talon — knife
    const knife = new THREE.Group();
    part(knife, 0.03, 0.032, 0.11, polymer, 0, 0, 0);
    part(knife, 0.07, 0.014, 0.014, metal, 0, 0, -0.06);
    part(knife, 0.007, 0.036, 0.19, blade, 0, 0.006, -0.16);
    part(knife, 0.0075, 0.012, 0.19, metal, 0, 0.026, -0.155);
    arm(knife, 0, -0.01, 0.03);

    // Hornet P9 — pistol
    const pistol = new THREE.Group();
    part(pistol, 0.04, 0.045, 0.19, metal, 0, 0.035, -0.08);
    part(pistol, 0.036, 0.03, 0.15, polymer, 0, 0.0, -0.07);
    part(pistol, 0.035, 0.11, 0.05, polymer, 0, -0.06, 0, -0.25);
    part(pistol, 0.012, 0.012, 0.02, accent, 0, 0.064, -0.16);
    arm(pistol, 0, -0.08, 0.02);

    // Kestrel AR-7 — rifle
    const rifle = new THREE.Group();
    part(rifle, 0.07, 0.09, 0.42, metal, 0, 0.02, -0.12);
    part(rifle, 0.026, 0.026, 0.3, metal, 0, 0.04, -0.47);
    part(rifle, 0.064, 0.064, 0.22, polymer, 0, 0.03, -0.38);
    part(rifle, 0.045, 0.17, 0.07, polymer, 0, -0.09, -0.16, 0.22);
    part(rifle, 0.05, 0.085, 0.22, polymer, 0, 0.0, 0.19);
    part(rifle, 0.04, 0.1, 0.05, polymer, 0, -0.06, 0.02, -0.3);
    part(rifle, 0.02, 0.035, 0.08, metal, 0, 0.085, -0.1);
    part(rifle, 0.072, 0.014, 0.1, accent, 0, 0.035, -0.02);
    arm(rifle, 0, -0.08, 0.04);
    arm(rifle, -0.02, -0.02, -0.36, -0.7);

    // Longbow SR — sniper
    const sniper = new THREE.Group();
    part(sniper, 0.06, 0.085, 0.55, wood, 0, 0, -0.1);
    part(sniper, 0.028, 0.028, 0.5, metal, 0, 0.03, -0.6);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12), metal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.1);
    sniper.add(scope);
    part(sniper, 0.012, 0.012, 0.06, metal, 0.05, 0.04, 0.05, 0, 0, 0.5);
    part(sniper, 0.05, 0.11, 0.26, wood, 0, -0.01, 0.27);
    part(sniper, 0.045, 0.1, 0.05, wood, 0, -0.07, 0.06, -0.3);
    arm(sniper, 0, -0.09, 0.07);
    arm(sniper, -0.02, -0.03, -0.38, -0.7);

    this.models = {
      talon: { group: knife, muzzle: new THREE.Vector3(0, 0, -0.26), rest: new THREE.Vector3(0.14, -0.13, -0.28), kick: 0 },
      hornet: { group: pistol, muzzle: new THREE.Vector3(0, 0.035, -0.19), rest: new THREE.Vector3(0.13, -0.14, -0.4), kick: 1 },
      kestrel: { group: rifle, muzzle: new THREE.Vector3(0, 0.04, -0.63), rest: new THREE.Vector3(0.15, -0.16, -0.4), kick: 0.55 },
      longbow: { group: sniper, muzzle: new THREE.Vector3(0, 0.03, -0.86), rest: new THREE.Vector3(0.15, -0.16, -0.38), kick: 2 },
    };
    for (const m of Object.values(this.models)) {
      m.group.scale.setScalar(0.62);
      m.group.visible = false;
      this.root.add(m.group);
    }

    const flashMat = new THREE.MeshBasicMaterial({ map: makeFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    this.flash.visible = false;
    this.root.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 2, 2);
    this.root.add(this.flashLight);
  }

  setTeam(team: Team): void {
    this.sleeve.color.setHex(team === 'attack' ? 0x9c5a2c : 0x2d557a);
  }

  onShot(): void {
    if (!this.current) return;
    const m = this.models[this.current];
    this.kick = Math.min(this.kick + m.kick, 2.5);
    if (this.current !== 'talon') {
      this.flashTime = 0.045;
      this.flash.visible = true;
      this.flash.position.copy(m.muzzle).applyMatrix4(m.group.matrix);
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flashLight.position.copy(this.flash.position);
      this.flashLight.intensity = 3;
    }
  }

  onMelee(heavy: boolean): void {
    this.swing = 1;
    this.swingHeavy = heavy;
  }

  onLand(speed: number): void {
    this.landDip = Math.min(1, speed / 9);
  }

  /** camera-space pitch punch (radians) to add on top of recoil */
  get cameraPunch(): number {
    return this.kick * 0.004;
  }

  update(dt: number, a: Actor, w: Weapon, time: number, mouseDX: number, mouseDY: number): void {
    const id = w.id;
    if (id !== this.current) {
      if (this.current) this.models[this.current].group.visible = false;
      this.current = id;
      this.models[id].group.visible = true;
      this.kick = 0;
    }
    const m = this.models[id];
    const g = m.group;
    this.root.visible = !w.scoped && a.alive;

    this.kick *= Math.exp(-14 * dt);
    this.swing = Math.max(0, this.swing - dt * (this.swingHeavy ? 1.6 : 3));
    this.landDip *= Math.exp(-8 * dt);

    const speed = a.onGround ? a.horizontalSpeed() : 0;
    const sf = Math.min(1, speed / CONFIG.movement.runSpeed);
    this.bobPhase += dt * (4 + speed * 1.4);
    this.swayX += (-mouseDX * 0.0006 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (mouseDY * 0.0006 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY));

    // draw / reload
    let drawOff = 0;
    const st = w.stats;
    if (time < w.drawEnd) {
      const t = 1 - (w.drawEnd - time) / st.drawTime;
      drawOff = 1 - easeOut(Math.max(0, t));
    }
    let reloadDip = 0;
    if (w.reloading) {
      const p = Math.min(1, Math.max(0, (time - w.reloadStart) / st.reloadTime));
      reloadDip = Math.sin(p * Math.PI);
    }

    const swing = this.swing > 0 ? Math.sin((1 - this.swing) * Math.PI) : 0;
    g.position.set(
      m.rest.x + Math.sin(this.bobPhase) * 0.012 * sf + this.swayX - swing * 0.12,
      m.rest.y - Math.abs(Math.cos(this.bobPhase)) * 0.01 * sf + this.swayY - drawOff * 0.3 - reloadDip * 0.1 - this.landDip * 0.04 - (a.crouching ? 0.01 : 0),
      m.rest.z + this.kick * 0.035 - swing * 0.08,
    );
    const knife = id === 'talon';
    g.rotation.set(
      (knife ? 0.35 : 0) + this.kick * 0.07 - drawOff * 0.7 + reloadDip * 0.45 + swing * (this.swingHeavy ? -0.6 : 0.2),
      (knife ? 0.5 : 0) + swing * 0.9,
      (knife ? 0.35 : 0) + reloadDip * 0.35 + swing * (this.swingHeavy ? 0 : 0.8),
    );
    g.updateMatrix();

    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
  }

  /** world position of the muzzle given the main camera (for tracers) */
  muzzleWorld(mainCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    if (!this.current) return out.setFromMatrixPosition(mainCamera.matrixWorld);
    const m = this.models[this.current];
    _v.copy(m.muzzle).applyMatrix4(m.group.matrix);
    return out.copy(_v).applyMatrix4(mainCamera.matrixWorld);
  }

  render(renderer: THREE.WebGLRenderer, aspect: number): void {
    if (!this.root.visible) return;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function makeFlashTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.translate(s / 2, s / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.3, 'rgba(255,190,90,0.8)');
    g.addColorStop(1, 'rgba(255,120,20,0)');
    ctx.fillStyle = g;
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(0, -s / 2);
      ctx.lineTo(4, 0);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, s / 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
