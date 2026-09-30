import { TEAM_NAMES, type Team } from '../config';
import type { Actor } from '../entities/Actor';

/** Tab scoreboard. Money is shown only for the viewer's team. */
export class Scoreboard {
  readonly root: HTMLDivElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'scoreboard';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
    if (!v) this.lastKey = '';
  }

  update(actors: Actor[], score: Record<Team, number>, round: number, me: Actor | null, lossBonus: Record<Team, number>): void {
    const key =
      `${score.attack}:${score.defend}:${round}|` +
      actors.map((a) => `${a.id},${a.team},${a.kills},${a.deaths},${a.money},${a.alive},${a.hasBomb},${a.hasKit}`).join(';');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const table = (team: Team) => {
      const rows = actors
        .filter((a) => a.team === team)
        .sort((x, y) => y.kills - x.kills || x.deaths - y.deaths)
        .map((a) => {
          const status = !a.alive ? '✝' : a.hasBomb ? '◆' : a.hasKit ? '✚' : '';
          const money = me && me.team === team ? `$${a.money}` : '';
          return `<tr class="${a === me ? 'me' : ''}${a.alive ? '' : ' dead'}"><td>${status}</td><td>${esc(a.name)}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${money}</td></tr>`;
        })
        .join('');
      return `<div class="sb-team ${team}"><div class="sb-title"><b>${TEAM_NAMES[team]}</b><span>${team === 'attack' ? 'атака' : 'защита'} · ${score[team]}</span>${
        me && me.team === team ? `<em>бонус за поражение: $${lossBonus[team]}</em>` : ''
      }</div><table><thead><tr><th></th><th>Игрок</th><th>У</th><th>С</th><th>Деньги</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    };
    this.root.innerHTML = `<div class="sb-head">Quarry · раунд ${round}</div>${table('attack')}${table('defend')}`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
