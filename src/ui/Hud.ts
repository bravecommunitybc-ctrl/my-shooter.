import type { Settings } from '../core/Settings';
import { Crosshair } from './Crosshair';

/** In-game overlay. Expanded in later stages (health, ammo, money, killfeed…). */
export class Hud {
  readonly root: HTMLDivElement;
  readonly crosshair: Crosshair;
  private debug: HTMLDivElement;
  private center: HTMLDivElement;
  private centerUntil = 0;

  constructor(parent: HTMLElement, settings: Settings) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);
    const chWrap = document.createElement('div');
    chWrap.className = 'ch-wrap';
    this.root.appendChild(chWrap);
    this.crosshair = new Crosshair(chWrap, settings.crosshair);
    this.debug = document.createElement('div');
    this.debug.className = 'hud-debug';
    this.root.appendChild(this.debug);
    this.center = document.createElement('div');
    this.center.className = 'hud-center';
    this.root.appendChild(this.center);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  applySettings(s: Settings): void {
    this.crosshair.apply(s.crosshair);
  }

  setDebug(text: string): void {
    this.debug.textContent = text;
  }

  message(text: string, seconds: number, now: number): void {
    this.center.textContent = text;
    this.center.style.opacity = '1';
    this.centerUntil = now + seconds;
  }

  update(now: number): void {
    if (this.centerUntil && now > this.centerUntil) {
      this.center.style.opacity = '0';
      this.centerUntil = 0;
    }
  }
}
