import * as THREE from 'three';
import { CONFIG, type Team, type WeaponId } from '../config';
import type { Actor } from './Actor';

const M = CONFIG.movement;

interface TeamMats {
  uniform: THREE.MeshStandardMaterial;
  vest: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  boots: THREE.MeshStandardMaterial;
  gun: THREE.MeshStandardMaterial;
}

const matCache = new Map<Team, TeamMats>();
const boxCache = new Map<string, THREE.BoxGeometry>();

function mats(team: Team): TeamMats {
  let m = matCache.get(team);
  if (!m) {
    const attack = team === 'attack';
    m = {
      uniform: new THREE.MeshStandardMaterial({ color: attack ? 0xa4592a : 0x2f5f8a, roughness: 0.9 }),
      vest: new THREE.MeshStandardMaterial({ color: attack ? 0x3f3a31 : 0x28313b, roughness: 0.85 }),
      head: new THREE.MeshStandardMaterial({ color: attack ? 0x2a2420 : 0x3a434c, roughness: 0.8 }),
      visor: new THREE.MeshStandardMaterial({ color: attack ? 0xf2a541 : 0x4ec3f2, emissive: attack ? 0x4a2a00 : 0x00334a, roughness: 0.3 }),
      boots: new THREE.MeshStandardMaterial({ color: 0x1e1d1b, roughness: 0.9 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x25272b, roughness: 0.5, metalness: 0.5 }),
    };
    matCache.set(team, m);
  }
  return m;
}

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  const k = `${w}|${h}|${d}`;
  let g = boxCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(k, g);
  }
  return g;
}

function mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = false;
  parent.add(me);
  return me;
}

const _p = new THREE.Vector3();

/** Blocky third-person soldier with walk cycle, crouch, aim pitch and death fall. */
export class ActorModel {
  readonly group = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly aim = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly gun: THREE.Mesh;
  private readonly head: THREE.Group;
  private walkPhase = 0;
  private deathT = 0;
  private team: Team;
  private weaponId: WeaponId | null = null;

  constructor(team: Team) {
    this.team = team;
    const m = mats(team);
    const hips = M.standHeight * 0.47;

    for (const [leg, x] of [[this.legL, -0.11], [this.legR, 0.11]] as const) {
      leg.position.set(x, hips, 0);
      mesh(leg, box(0.18, hips - 0.1, 0.2), m.uniform, 0, -(hips - 0.1) / 2, 0);
      mesh(leg, box(0.2, 0.12, 0.28), m.boots, 0, -hips + 0.06, -0.03);
      this.group.add(leg);
    }

    this.group.add(this.upper);
    mesh(this.upper, box(0.48, 0.64, 0.28), m.uniform, 0, hips + 0.32, 0);
    mesh(this.upper, box(0.52, 0.44, 0.34), m.vest, 0, hips + 0.38, 0);

    this.head = new THREE.Group();
    this.head.position.set(0, M.standHeight - 0.27, 0);
    mesh(this.head, box(0.26, 0.26, 0.26), m.head, 0, 0.13, 0);
    mesh(this.head, box(0.22, 0.06, 0.03), m.visor, 0, 0.15, -0.135);
    this.upper.add(this.head);

    this.aim.position.set(0, 1.42, 0);
    this.upper.add(this.aim);
    const armR = mesh(this.aim, box(0.13, 0.13, 0.46), m.uniform, 0.24, -0.1, -0.2);
    armR.rotation.y = 0.15;
    const armL = mesh(this.aim, box(0.13, 0.13, 0.5), m.uniform, -0.1, -0.12, -0.3);
    armL.rotation.y = -0.55;
    this.gun = mesh(this.aim, box(0.07, 0.1, 0.62), m.gun, 0.12, -0.08, -0.45);

    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
  }

  get currentTeam(): Team {
    return this.team;
  }

  setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    const len = id === 'longbow' ? 0.95 : id === 'kestrel' ? 0.7 : id === 'hornet' ? 0.2 : 0.22;
    this.gun.scale.set(id === 'talon' ? 0.3 : 1, id === 'talon' ? 0.3 : 1, len / 0.62);
    this.gun.position.z = -0.25 - len / 2;
  }

  resetPose(): void {
    this.deathT = 0;
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
  }

  update(a: Actor, alpha: number, dt: number): void {
    _p.lerpVectors(a.prevPos, a.pos, alpha);
    this.group.position.copy(_p);
    this.setWeapon(a.weapon.id);

    if (!a.alive) {
      // fall over backwards
      this.deathT = Math.min(1, this.deathT + dt * 3);
      const t = this.deathT;
      this.group.rotation.set(t * t * (Math.PI / 2 - 0.1), a.yaw, 0, 'YXZ');
      this.legL.rotation.x = this.legR.rotation.x = 0;
      return;
    }
    this.group.rotation.set(0, a.yaw, 0, 'YXZ');

    // crouch: squash legs and drop the upper body
    const crouchT = (M.standEye - a.eyeHeight) / (M.standEye - M.crouchEye);
    const c = Math.max(0, Math.min(1, crouchT));
    const drop = c * (M.standHeight - M.crouchHeight);
    this.upper.position.y = -drop;
    const legScale = 1 - drop / (M.standHeight * 0.47);
    this.legL.scale.y = this.legR.scale.y = legScale;
    this.legL.position.y = this.legR.position.y = M.standHeight * 0.47 * legScale;

    const speed = a.onGround ? a.horizontalSpeed() : 0;
    this.walkPhase += dt * speed * 2.1;
    const amp = Math.min(1, speed / 4) * 0.55;
    this.legL.rotation.x = Math.sin(this.walkPhase) * amp;
    this.legR.rotation.x = -Math.sin(this.walkPhase) * amp;
    if (!a.onGround) {
      this.legL.rotation.x = 0.4;
      this.legR.rotation.x = -0.2;
    }
    this.aim.rotation.x = a.pitch * 0.85;
    this.head.rotation.x = a.pitch * 0.5;
  }
}
