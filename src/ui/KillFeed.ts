import { WEAPONS } from '../config';
import type { DamageSource } from '../core/events';
import type { Actor } from '../entities/Actor';

interface Entry {
  el: HTMLDivElement;
  until: number;
}

const ICON: Record<string, string> = { talon: '🗡', hornet: '▸', kestrel: '▶▶', longbow: '━╋', bomb: '✹', fall: '↓' };

/** Top-right kill feed; entries fade after a few seconds. */
export class KillFeed {
  readonly root: HTMLDivElement;
  private entries: Entry[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'killfeed';
    parent.appendChild(this.root);
  }

  push(killer: Actor | null, victim: Actor, source: DamageSource, headshot: boolean, me: Actor | null, now: number): void {
    const el = document.createElement('div');
    el.className = 'kf' + (killer === me || victim === me ? ' kf-me' : '');
    const weapon = source === 'bomb' ? 'Pulse Charge' : source === 'fall' ? 'падение' : WEAPONS[source].name;
    const k = killer && killer !== victim ? `<b class="${killer.team}">${esc(killer.name)}</b>` : '';
    el.innerHTML = `${k}<span class="kf-w" title="${weapon}">${ICON[source] ?? '•'} ${weapon}${headshot ? ' <i>✦</i>' : ''}</span><b class="${victim.team}">${esc(victim.name)}</b>`;
    this.root.appendChild(el);
    this.entries.push({ el, until: now + 6 });
    while (this.entries.length > 6) this.entries.shift()?.el.remove();
  }

  update(now: number): void {
    while (this.entries.length && this.entries[0].until < now) this.entries.shift()?.el.remove();
  }

  clear(): void {
    for (const e of this.entries) e.el.remove();
    this.entries = [];
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
