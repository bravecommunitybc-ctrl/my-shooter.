import { TEAM_NAMES, type Team } from '../config';
import type { Settings } from '../core/Settings';
import { Crosshair } from './Crosshair';

function div(parent: HTMLElement, cls: string, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

export interface TopBarState {
  attackScore: number;
  defendScore: number;
  attackAlive: number;
  defendAlive: number;
  timer: string;
  bomb: boolean;
  round: number;
  playerTeam: Team;
}

/**
 * In-game overlay (DOM). Every setter caches its last value so the DOM
 * is only touched when something actually changes.
 */
export class Hud {
  readonly root: HTMLDivElement;
  readonly crosshair: Crosshair;
  private readonly chWrap: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private centerUntil = 0;
  private subUntil = 0;

  private readonly hp: HTMLDivElement;
  private readonly hpBar: HTMLDivElement;
  private readonly armor: HTMLDivElement;
  private readonly money: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly weaponName: HTMLDivElement;
  private readonly slots: HTMLDivElement;
  private readonly top: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly scoreA: HTMLDivElement;
  private readonly scoreD: HTMLDivElement;
  private readonly aliveA: HTMLDivElement;
  private readonly aliveD: HTMLDivElement;
  private readonly roundLbl: HTMLDivElement;
  private readonly hitmarker: HTMLDivElement;
  private readonly scope: HTMLDivElement;
  private readonly damage: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly progressFill: HTMLDivElement;
  private readonly progressLabel: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly bombIcon: HTMLDivElement;
  private readonly spectate: HTMLDivElement;
  private readonly rewardEl: HTMLDivElement;
  private rewardUntil = 0;
  private hitUntil = 0;
  private damageUntil = 0;
  private cache = new Map<string, string>();

  constructor(parent: HTMLElement, settings: Settings) {
    this.root = div(parent, 'hud');
    this.scope = div(this.root, 'hud-scope');
    div(this.scope, 'scope-h');
    div(this.scope, 'scope-v');
    this.damage = div(this.root, 'hud-damage');
    this.chWrap = div(this.root, 'ch-wrap');
    this.crosshair = new Crosshair(this.chWrap, settings.crosshair);
    this.hitmarker = div(this.root, 'hitmarker', '<i></i><i></i><i></i><i></i>');
    this.debug = div(this.root, 'hud-debug');
    this.center = div(this.root, 'hud-center');
    this.sub = div(this.root, 'hud-sub');
    this.hint = div(this.root, 'hud-hint');
    this.spectate = div(this.root, 'hud-spectate');

    const vitals = div(this.root, 'hud-vitals');
    const hpBox = div(vitals, 'vital');
    div(hpBox, 'vital-icon', '✚');
    this.hp = div(hpBox, 'vital-num');
    this.hpBar = div(div(hpBox, 'vital-bar'), 'vital-fill');
    const arBox = div(vitals, 'vital');
    div(arBox, 'vital-icon', '⛨');
    this.armor = div(arBox, 'vital-num');
    this.money = div(this.root, 'hud-money');
    this.rewardEl = div(this.root, 'hud-reward');

    const weapon = div(this.root, 'hud-weapon');
    this.weaponName = div(weapon, 'weapon-name');
    this.ammo = div(weapon, 'ammo');
    this.slots = div(weapon, 'slots');
    this.bombIcon = div(weapon, 'bomb-carried', '◆ Pulse Charge');

    this.top = div(this.root, 'hud-top');
    const left = div(this.top, 'team-box attack');
    this.aliveA = div(left, 'alive');
    this.scoreA = div(left, 'score');
    const mid = div(this.top, 'timer-box');
    this.timer = div(mid, 'timer');
    this.roundLbl = div(mid, 'round-lbl');
    const right = div(this.top, 'team-box defend');
    this.scoreD = div(right, 'score');
    this.aliveD = div(right, 'alive');

    this.progress = div(this.root, 'hud-progress');
    this.progressLabel = div(this.progress, 'progress-label');
    this.progressFill = div(div(this.progress, 'progress-bar'), 'progress-fill');

    this.setTop(null);
    this.setScope(false);
    this.setProgress(null, 0);
    this.setHint('');
    this.setSpectate('');
    this.setBombCarried(false);
  }

  private set(key: string, el: HTMLElement, value: string, html = false): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (html) el.innerHTML = value;
    else el.textContent = value;
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  applySettings(s: Settings): void {
    this.crosshair.apply(s.crosshair);
  }

  setDebug(text: string): void {
    this.set('debug', this.debug, text);
  }

  setVitals(hp: number, armor: number, helmet: boolean): void {
    const v = Math.max(0, Math.ceil(hp));
    if (this.cache.get('hp') !== String(v)) {
      this.hpBar.style.width = `${Math.min(100, v)}%`;
      this.hp.classList.toggle('low', v <= 25);
    }
    this.set('hp', this.hp, String(v));
    this.set('ar', this.armor, `${armor}${helmet ? ' ⛑' : ''}`);
  }

  setMoney(money: number | null): void {
    this.set('money', this.money, money === null ? '' : `$${money}`);
  }

  setWeapon(name: string, mag: number | null, reserve: number, reloading: boolean, slots: string): void {
    this.set('wname', this.weaponName, reloading ? `${name} · перезарядка` : name);
    this.set('ammo', this.ammo, mag === null ? '' : `<b class="${mag === 0 ? 'empty' : ''}">${mag}</b><span>/ ${reserve}</span>`, true);
    this.set('slots', this.slots, slots, true);
  }

  setBombCarried(v: boolean): void {
    if (this.cache.get('bombc') === String(v)) return;
    this.cache.set('bombc', String(v));
    this.bombIcon.style.display = v ? 'block' : 'none';
  }

  setTop(s: TopBarState | null): void {
    const vis = s ? 'flex' : 'none';
    if (this.cache.get('topvis') !== vis) {
      this.cache.set('topvis', vis);
      this.top.style.display = vis;
    }
    if (!s) return;
    this.set('sa', this.scoreA, String(s.attackScore));
    this.set('sd', this.scoreD, String(s.defendScore));
    this.set('aa', this.aliveA, `${TEAM_NAMES.attack} · ${s.attackAlive}`);
    this.set('ad', this.aliveD, `${s.defendAlive} · ${TEAM_NAMES.defend}`);
    this.set('timer', this.timer, s.timer);
    this.timer.classList.toggle('bomb', s.bomb);
    this.set('round', this.roundLbl, `Раунд ${s.round}`);
    this.top.classList.toggle('me-attack', s.playerTeam === 'attack');
    this.top.classList.toggle('me-defend', s.playerTeam === 'defend');
  }

  setCrosshairSpread(px: number, visible: boolean): void {
    this.crosshair.setSpread(px);
    this.crosshair.setVisible(visible);
  }

  setScope(on: boolean): void {
    const v = on ? 'block' : 'none';
    if (this.cache.get('scope') === v) return;
    this.cache.set('scope', v);
    this.scope.style.display = v;
  }

  hit(headshot: boolean, kill: boolean, now: number): void {
    this.hitmarker.classList.toggle('head', headshot);
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.style.opacity = '1';
    this.hitUntil = now + (kill ? 0.35 : 0.18);
  }

  /** red vignette on the side the damage came from (angle relative to view, radians, clockwise) */
  hurt(angle: number, now: number): void {
    const deg = (angle * 180) / Math.PI;
    this.damage.style.background = `conic-gradient(from ${deg - 45}deg at 50% 50%, rgba(255,40,40,0.55) 0deg, rgba(255,40,40,0) 90deg, rgba(255,40,40,0) 360deg)`;
    this.damage.style.opacity = '1';
    this.damageUntil = now + 0.6;
  }

  setProgress(label: string | null, frac: number): void {
    const vis = label ? 'block' : 'none';
    if (this.cache.get('pvis') !== vis) {
      this.cache.set('pvis', vis);
      this.progress.style.display = vis;
    }
    if (!label) return;
    this.set('plabel', this.progressLabel, label);
    this.progressFill.style.width = `${Math.round(frac * 100)}%`;
  }

  setHint(text: string): void {
    this.set('hint', this.hint, text);
    this.hint.style.display = text ? 'block' : 'none';
  }

  setSpectate(text: string): void {
    this.set('spec', this.spectate, text);
    this.spectate.style.display = text ? 'block' : 'none';
  }

  reward(text: string, now: number): void {
    this.rewardEl.textContent = text;
    this.rewardEl.style.opacity = '1';
    this.rewardUntil = now + 2;
  }

  message(text: string, seconds: number, now: number, sub = ''): void {
    this.center.textContent = text;
    this.center.style.opacity = '1';
    this.centerUntil = now + seconds;
    this.sub.textContent = sub;
    this.sub.style.opacity = sub ? '1' : '0';
    this.subUntil = now + seconds;
  }

  update(now: number): void {
    if (this.centerUntil && now > this.centerUntil) {
      this.center.style.opacity = '0';
      this.centerUntil = 0;
    }
    if (this.subUntil && now > this.subUntil) {
      this.sub.style.opacity = '0';
      this.subUntil = 0;
    }
    if (this.rewardUntil && now > this.rewardUntil) {
      this.rewardEl.style.opacity = '0';
      this.rewardUntil = 0;
    }
    if (this.hitUntil && now > this.hitUntil) {
      this.hitmarker.style.opacity = '0';
      this.hitUntil = 0;
    }
    if (this.damageUntil && now > this.damageUntil) {
      this.damage.style.opacity = '0';
      this.damageUntil = 0;
    }
  }
}
