import * as THREE from 'three';
import { CONFIG, type Team } from '../config';
import { Actor } from '../entities/Actor';
import { ActorModel } from '../entities/ActorModel';
import { separateActors, stepMovement } from '../entities/Movement';
import { Player } from '../entities/Player';
import { Input } from '../input/Input';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { Effects } from '../weapons/Effects';
import { ViewModel } from '../weapons/ViewModel';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { buildEnvironment, buildMap } from '../world/MapBuilder';
import type { MapDef } from '../world/MapDef';
import { QUARRY } from '../world/maps/quarry';
import { EventBus } from './EventBus';
import type { GameEvents } from './events';
import { loadSettings, type Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused' | 'over';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Training dummies until bots land (stage 3). */
const DUMMY_SPOTS: [number, number, number][] = [
  [0, 0, 20], [3, 0, 28], [-3, 0, 12.5], [-42.5, 0, 26], [42.5, 0, 24.5],
];

/**
 * Owns the renderer, the world and every system; runs a fixed-step
 * simulation (CONFIG.sim.tickRate) with interpolated rendering.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  readonly world = new CollisionWorld();
  readonly map: MapDef = QUARRY;
  readonly settings: Settings;
  readonly events = new EventBus<GameEvents>();
  readonly weapons: WeaponSystem;
  readonly effects: Effects;
  readonly viewModel = new ViewModel();

  actors: Actor[] = [];
  player: Player | null = null;
  private readonly models = new Map<Actor, ActorModel>();
  private readonly respawnAt = new Map<Actor, number>();

  private readonly menu: Menu;
  private readonly hud: Hud;
  private mode: Mode = 'menu';
  private readonly fixedDt = 1 / CONFIG.sim.tickRate;
  private acc = 0;
  private lastFrame = 0;
  /** simulation time (s) */
  time = 0;
  private realTime = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;
  private mouseDX = 0;
  private mouseDY = 0;

  constructor(private readonly canvas: HTMLCanvasElement, overlay: HTMLDivElement) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 16 / 9, 0.05, 500);
    this.scene.add(this.camera);
    this.input = new Input(canvas);

    this.weapons = new WeaponSystem(this.world, () => this.actors, this.events);
    this.effects = new Effects(this.scene, this.events, (a, out) => this.muzzleOf(a, out));

    this.hud = new Hud(overlay, this.settings);
    this.hud.setVisible(false);
    this.menu = new Menu(overlay, this.settings, {
      onPlay: () => this.startMatch(),
      onResume: () => this.resume(),
      onQuit: () => this.quitToMenu(),
      onSettingsChanged: (s) => this.applySettings(s),
    });

    this.input.onLockChange = (locked) => this.handleLockChange(locked);
    canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.input.locked) this.input.requestLock();
    });
    window.addEventListener('resize', () => this.resize());
    this.wireEvents();
  }

  boot(): void {
    buildEnvironment(this.scene, this.map);
    const built = buildMap(this.map, this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(built.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
    requestAnimationFrame(this.frame);
  }

  private wireEvents(): void {
    const ev = this.events;
    ev.on('shot', (e) => {
      if (this.player && e.shooter === this.player.actor) this.viewModel.onShot();
    });
    ev.on('melee', (e) => {
      if (this.player && e.actor === this.player.actor) this.viewModel.onMelee(e.actor.weapon.nextFireTime - this.time > 0.6);
    });
    ev.on('damage', (e) => {
      const me = this.player?.actor;
      if (!me) return;
      if (e.attacker === me && e.victim !== me) this.hud.hit(e.zone === 'head', !e.victim.alive, this.realTime);
      if (e.victim === me && e.attacker) {
        const dx = e.attacker.pos.x - me.pos.x;
        const dz = e.attacker.pos.z - me.pos.z;
        const toAttacker = Math.atan2(-dx, -dz);
        let rel = me.yaw - toAttacker;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        this.hud.hurt(rel, this.realTime);
      }
    });
    ev.on('kill', (e) => {
      if (e.victim.isBot) this.respawnAt.set(e.victim, this.time + 3);
    });
    ev.on('land', (e) => {
      if (this.player && e.actor === this.player.actor) this.viewModel.onLand(e.speed);
    });
  }

  // ─── match lifecycle ──────────────────────────────────────────────

  private spawnActor(name: string, team: Team, isBot: boolean): Actor {
    const a = new Actor(name, team, isBot);
    this.actors.push(a);
    const model = new ActorModel(team);
    this.models.set(a, model);
    this.scene.add(model.group);
    return a;
  }

  private placeActor(a: Actor, x: number, y: number, z: number, yaw: number): void {
    a.resetForRound();
    a.pos.set(x, y, z);
    a.prevPos.copy(a.pos);
    a.yaw = yaw;
    a.updateHitboxes();
    this.models.get(a)?.resetPose();
  }

  private startMatch(): void {
    this.clearMatch();
    const me = this.spawnActor('Вы', this.settings.side, false);
    this.player = new Player(me, this.input);
    const sp = this.map.spawns[me.team][0];
    this.placeActor(me, sp.pos[0], sp.pos[1], sp.pos[2], sp.yaw);
    this.weapons.give(me, 'kestrel', this.time, false);
    this.weapons.switchTo(me, 'primary', this.time, true);
    this.viewModel.setTeam(me.team);

    const enemy: Team = me.team === 'attack' ? 'defend' : 'attack';
    DUMMY_SPOTS.forEach((p, i) => {
      const d = this.spawnActor(`Манекен ${i + 1}`, enemy, true);
      d.armor = i % 2 ? 100 : 0;
      d.helmet = i % 2 === 1;
      this.placeActor(d, p[0], p[1], p[2], 0);
    });

    this.mode = 'playing';
    this.menu.hide();
    this.hud.setVisible(true);
    this.hud.message('Тренировка', 2.5, this.realTime, 'Манекены с чётным номером — в броне и шлеме');
    this.input.capture = true;
    this.input.clearPresses();
    this.enterFullscreenIfWanted();
    this.input.requestLock();
  }

  private clearMatch(): void {
    for (const m of this.models.values()) this.scene.remove(m.group);
    this.models.clear();
    this.respawnAt.clear();
    this.actors = [];
    this.player = null;
    this.time = 0;
    this.acc = 0;
    this.effects.clear();
  }

  private resume(): void {
    this.mode = 'playing';
    this.menu.hide();
    this.input.capture = true;
    this.input.clearPresses();
    this.input.requestLock();
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.capture = false;
    this.menu.showPause();
  }

  private quitToMenu(): void {
    this.clearMatch();
    this.mode = 'menu';
    this.input.capture = false;
    this.input.exitLock();
    this.hud.setVisible(false);
    this.menu.showMain();
  }

  private handleLockChange(locked: boolean): void {
    if (!locked && this.mode === 'playing') this.pause();
  }

  private enterFullscreenIfWanted(): void {
    if (!this.settings.fullscreen || document.fullscreenElement) return;
    const root = document.documentElement;
    root
      .requestFullscreen?.()
      .then(() => {
        // Keyboard Lock lets Ctrl+W etc. reach the game while fullscreen (Chromium)
        const kb = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard;
        return kb?.lock?.();
      })
      .catch(() => undefined);
  }

  private applySettings(s: Settings): void {
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.hud.applySettings(s);
  }

  // ─── loop ─────────────────────────────────────────────────────────

  private frame = (nowMs: number): void => {
    requestAnimationFrame(this.frame);
    const now = nowMs / 1000;
    const dt = this.lastFrame ? Math.min(now - this.lastFrame, 0.1) : 0;
    this.lastFrame = now;
    this.realTime += dt;
    this.countFps(dt);

    let alpha = 1;
    this.mouseDX = this.mouseDY = 0;
    if (this.mode === 'playing' && this.player) {
      const m = this.input.takeMouse();
      this.mouseDX = m.dx;
      this.mouseDY = m.dy;
      const w = this.player.actor.weapon;
      this.player.zoomSensMul = w.scoped && w.stats.scope ? w.stats.scope.sensitivityMul : 1;
      if (this.player.actor.alive) this.player.look(m.dx, m.dy, this.settings.sensitivity);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.fixedDt && steps < 8) {
        this.tick(this.fixedDt);
        this.acc -= this.fixedDt;
        steps++;
      }
      if (steps === 8) this.acc = 0;
      alpha = this.acc / this.fixedDt;
    }
    this.render(dt, alpha);
  };

  private tick(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.player?.readIntent(false);

    for (const a of this.actors) {
      a.prevPos.copy(a.pos);
      if (!a.alive) continue;
      const r = stepMovement(a, a.intent, dt, this.world, this.weapons.mobility(a));
      if (r.landedSpeed > 2) this.events.emit('land', { actor: a, speed: r.landedSpeed });
    }
    separateActors(this.actors, this.world);
    for (const a of this.actors) a.updateHitboxes();
    for (const a of this.actors) this.weapons.update(a, dt, t);

    // training dummies come back
    for (const [a, at] of this.respawnAt) {
      if (t >= at) {
        this.respawnAt.delete(a);
        const i = this.actors.indexOf(a) - 1;
        const p = DUMMY_SPOTS[Math.max(0, i) % DUMMY_SPOTS.length];
        const armor = a.armor;
        this.placeActor(a, p[0], p[1], p[2], 0);
        a.armor = i % 2 ? 100 : armor;
        a.helmet = i % 2 === 1;
      }
    }
  }

  private muzzleOf(a: Actor, out: THREE.Vector3): THREE.Vector3 {
    if (this.player && a === this.player.actor) return this.viewModel.muzzleWorld(this.camera, out);
    a.eyePosition(out);
    a.viewDir(_fwd);
    _right.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
    return out.addScaledVector(_fwd, 0.75).addScaledVector(_right, 0.12).add(_v.set(0, -0.28, 0));
  }

  private render(dt: number, alpha: number): void {
    const p = this.player;
    if (p && this.mode !== 'menu') {
      const a = p.actor;
      const w = a.weapon;
      p.kickPitch = w.recoilPitch * w.stats.recoil.viewKick + this.viewModel.cameraPunch;
      p.kickYaw = w.recoilYaw * w.stats.recoil.viewKick;
      p.updateCamera(this.camera, alpha);
      const fov = w.scoped && w.stats.scope ? w.stats.scope.fov : this.settings.fov;
      if (this.camera.fov !== fov) {
        this.camera.fov = fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
      if (this.mode === 'playing') this.viewModel.update(dt, a, w, this.time, this.mouseDX, this.mouseDY);
      this.updateHud(a);
    } else {
      // slow orbit over the map as a menu backdrop
      const t = this.realTime * 0.05;
      this.camera.position.set(Math.sin(t) * 60, 55, Math.cos(t) * 75);
      this.camera.lookAt(0, 0, -5);
      if (this.camera.fov !== this.settings.fov) {
        this.camera.fov = this.settings.fov;
        this.camera.updateProjectionMatrix();
      }
    }

    for (const [a, m] of this.models) {
      const hidden = p !== null && a === p.actor;
      m.group.visible = !hidden;
      if (!hidden) m.update(a, alpha, this.mode === 'playing' ? dt : 0);
    }
    if (this.mode === 'playing') this.effects.update(dt);
    this.hud.update(this.realTime);

    this.renderer.render(this.scene, this.camera);
    if (p && this.mode !== 'menu') this.viewModel.render(this.renderer, this.camera.aspect);
  }

  private updateHud(a: Actor): void {
    const hud = this.hud;
    const w = a.weapon;
    const st = w.stats;
    hud.setVitals(a.hp, a.armor, a.helmet);
    const L = a.loadout;
    const slot = (key: string, label: string, on: boolean, has: boolean) =>
      has ? `<span class="${on ? 'on' : ''}">${key} ${label}</span>` : '';
    hud.setWeapon(
      st.name,
      st.melee ? null : w.mag,
      w.reserve,
      w.reloading,
      slot('1', L.primary?.stats.name ?? '', a.currentSlot === 'primary', !!L.primary) +
        slot('2', L.secondary?.stats.name ?? '', a.currentSlot === 'secondary', !!L.secondary) +
        slot('3', L.melee.stats.name, a.currentSlot === 'melee', true),
    );
    hud.setScope(w.scoped);
    const inacc = this.weapons.inaccuracy(a, w);
    const px = (Math.tan(inacc) / Math.tan((this.camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
    hud.setCrosshairSpread(Math.min(px, 120), a.alive && !w.scoped && !st.scope);
    hud.setDebug(`${this.fps} FPS · ${a.horizontalSpeed().toFixed(1)} м/с`);
  }

  private countFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
