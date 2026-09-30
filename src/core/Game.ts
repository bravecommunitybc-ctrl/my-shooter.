import * as THREE from 'three';
import { CONFIG } from '../config';
import { Actor } from '../entities/Actor';
import { separateActors, stepMovement } from '../entities/Movement';
import { Player } from '../entities/Player';
import { Input } from '../input/Input';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Hud } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { buildEnvironment, buildMap } from '../world/MapBuilder';
import type { MapDef } from '../world/MapDef';
import { QUARRY } from '../world/maps/quarry';
import { loadSettings, type Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused' | 'over';

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

  actors: Actor[] = [];
  player: Player | null = null;

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

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlay: HTMLDivElement) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.render.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 16 / 9, 0.05, 500);
    this.input = new Input(canvas);

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
  }

  boot(): void {
    buildEnvironment(this.scene, this.map);
    const built = buildMap(this.map, this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(built.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
    requestAnimationFrame(this.frame);
  }

  // ─── match lifecycle ──────────────────────────────────────────────

  private startMatch(): void {
    this.clearMatch();
    const me = new Actor('Вы', this.settings.side, false);
    this.actors.push(me);
    this.player = new Player(me, this.input);
    const sp = this.map.spawns[me.team][0];
    me.pos.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    me.prevPos.copy(me.pos);
    me.yaw = sp.yaw;

    this.mode = 'playing';
    this.menu.hide();
    this.hud.setVisible(true);
    this.input.capture = true;
    this.input.clearPresses();
    this.enterFullscreenIfWanted();
    this.input.requestLock();
  }

  private clearMatch(): void {
    this.actors = [];
    this.player = null;
    this.time = 0;
    this.acc = 0;
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
    if (this.mode === 'playing' && this.player) {
      const m = this.input.takeMouse();
      this.player.look(m.dx, m.dy, this.settings.sensitivity);
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
    const player = this.player;
    if (player) player.readIntent(false);
    for (const a of this.actors) {
      a.prevPos.copy(a.pos);
      if (!a.alive) continue;
      stepMovement(a, a.intent, dt, this.world, 1);
    }
    separateActors(this.actors, this.world);
    for (const a of this.actors) a.updateHitboxes();
  }

  private render(dt: number, alpha: number): void {
    if (this.player && this.mode !== 'menu') {
      this.player.updateCamera(this.camera, alpha);
      const a = this.player.actor;
      this.hud.setDebug(
        `${this.fps} FPS · скорость ${a.horizontalSpeed().toFixed(2)} м/с · ${a.onGround ? 'земля' : 'воздух'}${a.crouching ? ' · присед' : ''}`,
      );
    } else {
      // slow orbit over the map as a menu backdrop
      const t = this.realTime * 0.05;
      this.camera.position.set(Math.sin(t) * 60, 55, Math.cos(t) * 75);
      this.camera.lookAt(0, 0, -5);
    }
    this.hud.update(this.realTime);
    void dt;
    this.renderer.render(this.scene, this.camera);
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
    void this.overlay;
  }
}
