import * as THREE from 'three';
import { BotManager } from '../ai/BotManager';
import { NavGraph } from '../ai/NavGraph';
import { CONFIG, TEAM_NAMES_RU, type Team } from '../config';
import { Actor } from '../entities/Actor';
import { ActorModel } from '../entities/ActorModel';
import { separateActors, stepMovement } from '../entities/Movement';
import { Player } from '../entities/Player';
import { Input } from '../input/Input';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Economy, type ShopItem } from '../round/Economy';
import { RoundManager } from '../round/RoundManager';
import { BuyMenu } from '../ui/BuyMenu';
import { Hud } from '../ui/Hud';
import { KillFeed } from '../ui/KillFeed';
import { Menu } from '../ui/Menu';
import { Scoreboard } from '../ui/Scoreboard';
import { Effects } from '../weapons/Effects';
import { ViewModel } from '../weapons/ViewModel';
import { Weapon } from '../weapons/Weapon';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { buildEnvironment, buildMap } from '../world/MapBuilder';
import type { MapDef, SpawnDef } from '../world/MapDef';
import { QUARRY } from '../world/maps/quarry';
import { EventBus } from './EventBus';
import type { GameEvents } from './events';
import { loadSettings, type Settings } from './Settings';

type Mode = 'menu' | 'playing' | 'paused' | 'over';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function fmtClock(sec: number): string {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Owns the renderer, the world and every system; runs a fixed-step
 * simulation (CONFIG.sim.tickRate) with interpolated rendering.
 *
 * Tick order: input/bots → movement → hitboxes → weapons → round/bomb.
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
  readonly round: RoundManager;
  readonly economy: Economy;

  actors: Actor[] = [];
  player: Player | null = null;
  private readonly models = new Map<Actor, ActorModel>();
  nav!: NavGraph;
  bots!: BotManager;
  /** actor whose eyes the camera uses while the player is dead */
  private spectating: Actor | null = null;
  private specFireHeld = false;

  private readonly menu: Menu;
  private readonly hud: Hud;
  private readonly killFeed: KillFeed;
  private readonly scoreboard: Scoreboard;
  private readonly buyMenu: BuyMenu;
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

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 16 / 9, 0.05, 500);
    this.scene.add(this.camera);
    this.input = new Input(canvas);

    this.weapons = new WeaponSystem(this.world, () => this.actors, this.events);
    this.effects = new Effects(this.scene, this.events, (a, out) => this.muzzleOf(a, out));
    this.round = new RoundManager(this.map, this.events, {
      actors: () => this.actors,
      respawn: (a, sp) => this.respawn(a, sp),
      resetLoadout: (a) => this.resetLoadout(a),
    });
    this.scene.add(this.round.bomb.mesh);
    this.economy = new Economy(this.events, () => this.actors, this.weapons, () => this.time);

    this.hud = new Hud(overlay, this.settings);
    this.hud.setVisible(false);
    this.killFeed = new KillFeed(this.hud.root);
    this.scoreboard = new Scoreboard(this.hud.root);
    this.buyMenu = new BuyMenu(overlay, this.economy, (item) => this.playerBuy(item));
    this.menu = new Menu(overlay, this.settings, {
      onPlay: () => this.startMatch(),
      onResume: () => this.resume(),
      onQuit: () => this.quitToMenu(),
      onSettingsChanged: (s) => this.applySettings(s),
    });

    this.input.onLockChange = (locked) => this.handleLockChange(locked);
    this.input.onKey = (code) => this.handleKey(code);
    canvas.addEventListener('click', () => {
      if (this.buyMenu.open) this.closeBuyMenu();
      else if (this.mode === 'playing' && !this.input.locked) this.input.requestLock();
    });
    window.addEventListener('resize', () => this.resize());
    this.wireEvents();
  }

  boot(): void {
    buildEnvironment(this.scene, this.map);
    const built = buildMap(this.map, this.world, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(built.group);
    this.renderer.shadowMap.needsUpdate = true;
    this.nav = new NavGraph(this.map, this.world);
    this.bots = new BotManager(this.map, this.nav, this.world, this.weapons, () => this.actors, this.events);
    if (import.meta.env.DEV) {
      const comps = this.nav.components();
      if (comps.length > 1) console.warn('[nav] disconnected waypoint groups:', comps.map((c) => c.map((i) => this.map.waypoints[i].pos.join(','))));
    }
    this.resize();
    requestAnimationFrame(this.frame);
  }

  private get me(): Actor | null {
    return this.player?.actor ?? null;
  }

  private wireEvents(): void {
    const ev = this.events;
    ev.on('shot', (e) => {
      if (e.shooter === this.me) this.viewModel.onShot();
    });
    ev.on('melee', (e) => {
      if (e.actor === this.me) this.viewModel.onMelee(e.actor.weapon.nextFireTime - this.time > 0.6);
    });
    ev.on('damage', (e) => {
      const me = this.me;
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
    ev.on('land', (e) => {
      if (e.actor === this.me) this.viewModel.onLand(e.speed);
    });
    ev.on('kill', (e) => {
      this.killFeed.push(e.killer, e.victim, e.source, e.headshot, this.me, this.realTime);
      if (e.victim === this.me) this.closeBuyMenu();
    });
    ev.on('reward', (e) => {
      if (e.actor === this.me) this.hud.reward(`+$${e.amount} · ${e.reason}`, this.realTime);
    });
    ev.on('roundPhase', (e) => {
      if (e.phase === 'buy') {
        this.bots.newRound();
        this.botsBuy(e.round);
        this.effects.clear();
        this.spectating = null;
        const me = this.me;
        if (me) {
          const side = me.team === 'attack' ? 'Атака: заложите Pulse Charge на A или B' : 'Защита: не дайте заложить заряд';
          this.hud.message(`Раунд ${e.round}`, 3, this.realTime, side);
        }
      } else if (e.phase === 'live') {
        this.hud.message('В бой!', 1.2, this.realTime);
      }
    });
    ev.on('roundEnd', (e) => {
      const me = this.me;
      const won = me ? e.winner === me.team : false;
      this.hud.message(won ? 'Раунд выигран' : 'Раунд проигран', 4.5, this.realTime, this.round.describeEnd());
    });
    ev.on('bombPlanted', (e) => {
      this.hud.message(`Заряд заложен на ${e.site}`, 2.5, this.realTime);
    });
    ev.on('bombExploded', (e) => this.effects.explosion(e.pos));
    ev.on('halftime', () => {
      for (const a of this.actors) this.rebuildModel(a);
      const me = this.me;
      if (me) this.viewModel.setTeam(me.team);
      this.hud.message('Смена сторон', 3, this.realTime, me ? `Теперь вы — ${TEAM_NAMES_RU[me.team]}` : '');
    });
    ev.on('matchEnd', (e) => {
      const me = this.me;
      const won = me ? e.winner === me.team : false;
      const s = this.round.score;
      const mine = me ? s[me.team] : 0;
      const theirs = me ? s[me.team === 'attack' ? 'defend' : 'attack'] : 0;
      this.mode = 'over';
      this.input.capture = false;
      this.input.exitLock();
      this.menu.showOver(won ? 'Победа' : 'Поражение', `Счёт ${mine} : ${theirs} · ваш счёт убийств ${me?.kills ?? 0} / смертей ${me?.deaths ?? 0}`);
    });
  }

  // ─── match lifecycle ──────────────────────────────────────────────

  private spawnActor(name: string, team: Team, isBot: boolean): Actor {
    const a = new Actor(name, team, isBot);
    this.actors.push(a);
    this.rebuildModel(a);
    return a;
  }

  private rebuildModel(a: Actor): void {
    const old = this.models.get(a);
    if (old && old.currentTeam === a.team) return;
    if (old) this.scene.remove(old.group);
    const model = new ActorModel(a.team);
    this.models.set(a, model);
    this.scene.add(model.group);
  }

  private respawn(a: Actor, sp: SpawnDef): void {
    a.resetForRound();
    a.pos.set(sp.pos[0], sp.pos[1], sp.pos[2]);
    a.prevPos.copy(a.pos);
    a.yaw = sp.yaw;
    a.updateHitboxes();
    for (const w of [a.loadout.primary, a.loadout.secondary]) {
      if (!w) continue;
      w.refill();
      w.resetState();
    }
    a.loadout.melee.resetState();
    const slot = a.loadout.primary ? 'primary' : 'secondary';
    this.weapons.switchTo(a, slot, this.time, true);
    this.models.get(a)?.resetPose();
  }

  private resetLoadout(a: Actor): void {
    a.loadout.primary = null;
    a.loadout.secondary = new Weapon('hornet');
    a.armor = 0;
    a.helmet = false;
    a.hasKit = false;
    a.currentSlot = 'secondary';
    a.lastSlot = 'melee';
  }

  private botsBuy(round: number): void {
    for (const team of ['attack', 'defend'] as Team[]) {
      const members = this.actors.filter((a) => a.team === team);
      const avg = members.reduce((s, a) => s + a.money, 0) / Math.max(1, members.length);
      let sniper = members.some((a) => a.loadout.primary?.id === 'longbow');
      for (const a of members) {
        if (!a.isBot) continue;
        if (this.economy.botBuy(a, round, avg, sniper)) sniper = true;
      }
    }
  }

  // ─── buy menu ─────────────────────────────────────────────────────

  private handleKey(code: string): void {
    if (this.mode !== 'playing') return;
    if (code === 'KeyB') {
      if (this.buyMenu.open) this.closeBuyMenu();
      else this.openBuyMenu();
    } else if (this.buyMenu.open) {
      if (code === 'Escape') this.closeBuyMenu();
      else this.buyMenu.keyBuy(code);
    }
  }

  private openBuyMenu(): void {
    const me = this.me;
    if (!me || !this.round.canBuy(me, this.time)) {
      if (me?.alive) this.hud.message('Покупка недоступна', 1.2, this.realTime, 'Только в фазе покупки или первые 20 с раунда на своей базе');
      return;
    }
    this.buyMenu.show();
    // free the cursor so items can be clicked; unlocking must not pause
    this.input.exitLock();
  }

  private closeBuyMenu(): void {
    if (!this.buyMenu.open) return;
    this.buyMenu.hide();
    this.input.clearPresses();
    if (this.mode === 'playing') this.input.requestLock();
  }

  private playerBuy(item: ShopItem): void {
    const me = this.me;
    if (!me || !this.round.canBuy(me, this.time)) return;
    this.economy.buy(me, item);
  }

  private startMatch(): void {
    this.clearMatch();
    const skill = CONFIG.bots.difficulty[this.settings.difficulty];
    const me = this.spawnActor('Вы', this.settings.side, false);
    this.player = new Player(me, this.input);
    this.viewModel.setTeam(me.team);
    const names = [...CONFIG.bots.names].sort(() => Math.random() - 0.5);
    const enemy: Team = me.team === 'attack' ? 'defend' : 'attack';
    for (let i = 0; i < 4; i++) this.bots.add(this.spawnActor(names.pop() ?? `Bot ${i}`, me.team, true), skill);
    for (let i = 0; i < 5; i++) this.bots.add(this.spawnActor(names.pop() ?? `Bot ${i + 4}`, enemy, true), skill);
    this.round.startMatch(this.time);

    this.mode = 'playing';
    this.menu.hide();
    this.hud.setVisible(true);
    this.input.capture = true;
    this.input.clearPresses();
    this.enterFullscreenIfWanted();
    this.input.requestLock();
  }

  private clearMatch(): void {
    for (const m of this.models.values()) this.scene.remove(m.group);
    this.models.clear();
    this.bots?.clear();
    this.round.bomb.reset();
    this.actors = [];
    this.player = null;
    this.spectating = null;
    this.time = 0;
    this.acc = 0;
    this.effects.clear();
    this.killFeed.clear();
    this.buyMenu.hide();
    this.scoreboard.setVisible(false);
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
    if (!locked && this.mode === 'playing' && !this.buyMenu.open) this.pause();
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
    this.bots?.setSkill(CONFIG.bots.difficulty[s.difficulty]);
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

  /** dev/testing: advance the simulation without rendering */
  simulate(seconds: number): void {
    const n = Math.round(seconds / this.fixedDt);
    for (let i = 0; i < n && this.mode !== 'over'; i++) this.tick(this.fixedDt);
  }

  private tick(dt: number): void {
    this.time += dt;
    const t = this.time;
    const frozen = this.round.frozen;
    this.player?.readIntent(frozen, this.buyMenu.open);
    this.input.consume('buy');
    this.bots.update(dt, t, this.round.objective, frozen);

    const bomb = this.round.bomb;
    for (const a of this.actors) {
      a.prevPos.copy(a.pos);
      if (!a.alive) continue;
      if (bomb.isBusy(a)) {
        // planting / defusing roots you in place
        a.intent.forward = a.intent.right = 0;
        a.intent.jump = false;
        a.weaponIntent.fire = false;
      }
      const r = stepMovement(a, a.intent, dt, this.world, this.weapons.mobility(a));
      if (r.landedSpeed > 2) this.events.emit('land', { actor: a, speed: r.landedSpeed });
      this.trackFootsteps(a, dt);
    }
    separateActors(this.actors, this.world);
    for (const a of this.actors) a.updateHitboxes();
    for (const a of this.actors) this.weapons.update(a, dt, t);
    this.round.update(dt, t);
    this.updateSpectator();
  }

  /** footstep events for audio + bot hearing (walking/crouching is silent) */
  private trackFootsteps(a: Actor, dt: number): void {
    if (!a.onGround) return;
    const speed = a.horizontalSpeed();
    const loud = speed > CONFIG.movement.runSpeed * CONFIG.movement.walkMul * 1.12;
    if (!loud) {
      a.stepDist = 0;
      return;
    }
    a.stepDist += speed * dt;
    if (a.stepDist > 2.1) {
      a.stepDist = 0;
      this.events.emit('footstep', { actor: a, loud });
    }
  }

  private updateSpectator(): void {
    const me = this.me;
    if (!me || me.alive) {
      this.spectating = null;
      return;
    }
    const firing = me.weaponIntent.fire;
    const cycle = firing && !this.specFireHeld;
    this.specFireHeld = firing;
    if (!this.spectating || !this.spectating.alive || cycle) {
      const alive = this.actors.filter((a) => a.alive && a.team === me.team && a !== me);
      const pool = alive.length ? alive : this.actors.filter((a) => a.alive);
      if (!pool.length) {
        this.spectating = null;
        return;
      }
      const cur = this.spectating ? pool.indexOf(this.spectating) : -1;
      this.spectating = pool[(cur + 1) % pool.length];
    }
  }

  private muzzleOf(a: Actor, out: THREE.Vector3): THREE.Vector3 {
    if (a === this.me) return this.viewModel.muzzleWorld(this.camera, out);
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
      const spec = !a.alive ? this.spectating : null;
      if (spec) {
        _v.lerpVectors(spec.prevPos, spec.pos, alpha);
        this.camera.position.set(_v.x, _v.y + spec.eyeHeight, _v.z);
        this.camera.rotation.set(spec.pitch, spec.yaw, 0, 'YXZ');
        this.hud.setSpectate(`Наблюдение: ${spec.name} (${spec.hp} HP) · ЛКМ — следующий`);
      } else {
        p.updateCamera(this.camera, alpha);
        this.hud.setSpectate(a.alive ? '' : 'Вы погибли');
      }
      const fov = a.alive && w.scoped && w.stats.scope ? w.stats.scope.fov : this.settings.fov;
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
      const hidden = p !== null && (a === p.actor || (a === this.spectating && !p.actor.alive));
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
    const round = this.round;
    const bomb = round.bomb;
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
    hud.setBombCarried(a.hasBomb);
    hud.setScope(a.alive && w.scoped);
    const inacc = this.weapons.inaccuracy(a, w);
    const px = (Math.tan(inacc) / Math.tan((this.camera.fov * Math.PI) / 360)) * (window.innerHeight / 2);
    hud.setCrosshairSpread(Math.min(px, 120), a.alive && !w.scoped && !st.scope);

    const alive = (t: Team) => this.actors.filter((x) => x.alive && x.team === t).length;
    const planted = bomb.status === 'planted';
    hud.setTop({
      attackScore: round.score.attack,
      defendScore: round.score.defend,
      attackAlive: alive('attack'),
      defendAlive: alive('defend'),
      timer: round.phase === 'buy' ? `${fmtClock(round.clock(this.time))}` : fmtClock(round.clock(this.time)),
      bomb: planted && round.phase === 'live',
      round: round.round,
      playerTeam: a.team,
    });

    // plant / defuse progress + hints
    if (bomb.planter === a && bomb.plantProgress > 0) {
      hud.setProgress('Закладка заряда…', bomb.plantProgress / CONFIG.bomb.plantTime);
    } else if (bomb.defuser === a && bomb.defuseProgress > 0) {
      hud.setProgress(a.hasKit ? 'Обезвреживание (набор сапёра)…' : 'Обезвреживание…', bomb.defuseProgress / bomb.defuseTime(a));
    } else {
      hud.setProgress(null, 0);
    }
    let hint = '';
    if (round.phase === 'buy') hint = `Фаза покупки · ${Math.ceil(round.clock(this.time))} с · B — меню покупки`;
    else if (round.phase === 'live' && a.alive) {
      if (a.hasBomb && bomb.canPlant(a) && bomb.plantProgress === 0) hint = 'Удерживайте E — заложить заряд';
      else if (a.team === 'defend' && bomb.canDefuse(a) && bomb.defuseProgress === 0) hint = 'Удерживайте E — обезвредить заряд';
    }
    hud.setHint(hint);
    hud.setMoney(a.money);
    // buy menu lifetime
    const me = a;
    if (this.buyMenu.open) {
      if (!this.round.canBuy(me, this.time)) this.closeBuyMenu();
      else {
        const left = round.phase === 'buy' ? round.clock(this.time) : CONFIG.round.buyWindowAfterStart - (this.time - round.liveStart);
        this.buyMenu.update(me, left);
      }
    }
    const tab = this.input.isDown('scoreboard') || this.mode === 'paused';
    this.scoreboard.setVisible(tab);
    if (tab) {
      this.scoreboard.update(this.actors, round.score, round.round, me, {
        attack: this.economy.nextLossBonus('attack'),
        defend: this.economy.nextLossBonus('defend'),
      });
    }
    this.killFeed.update(this.realTime);
    hud.setDebug(`${this.fps} FPS`);
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
