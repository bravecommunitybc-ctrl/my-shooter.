import type { ObjectiveView } from '../ai/BotManager';
import { CONFIG, TEAM_NAMES_RU, type Team } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, RoundEndReason } from '../core/events';
import type { Actor } from '../entities/Actor';
import type { MapDef, SpawnDef } from '../world/MapDef';
import { Bomb } from './Bomb';

const R = CONFIG.round;

export type Phase = 'buy' | 'live' | 'post' | 'over';

export interface RoundContext {
  actors(): Actor[];
  /** put an actor at a spawn point with full health */
  respawn(a: Actor, spawn: SpawnDef): void;
  /** strip weapons/armour of an actor that died last round */
  resetLoadout(a: Actor): void;
}

export const REASON_TEXT: Record<RoundEndReason, string> = {
  elimination: 'противник уничтожен',
  time: 'время вышло',
  bomb: 'заряд взорван',
  defuse: 'заряд обезврежен',
};

/**
 * Round flow: buy (freeze) → live (1:55, or 40 s after plant) → post → next.
 * First to 13 wins; sides swap after round 12.
 */
export class RoundManager {
  phase: Phase = 'buy';
  round = 0;
  phaseEnd = 0;
  liveStart = 0;
  readonly score: Record<Team, number> = { attack: 0, defend: 0 };
  lastWinner: Team | null = null;
  lastReason: RoundEndReason | null = null;
  matchWinner: Team | null = null;
  readonly bomb: Bomb;
  readonly objective: ObjectiveView;
  /** actors that died in the previous round (lose their gear) */
  private readonly diedLastRound = new Set<Actor>();
  private now = 0;

  constructor(private readonly map: MapDef, private readonly events: EventBus<GameEvents>, private readonly ctx: RoundContext) {
    this.bomb = new Bomb(map, events);
    this.objective = {
      live: false, bomb: 'none', bombPos: this.bomb.pos, carrier: null, plantedSite: null, roundTime: 0,
    };
    events.on('kill', (e) => {
      this.diedLastRound.add(e.victim);
    });
    events.on('bombDefused', () => this.endRound('defend', 'defuse', this.now));
  }

  startMatch(time: number): void {
    this.now = time;
    this.round = 0;
    this.score.attack = this.score.defend = 0;
    this.matchWinner = null;
    this.diedLastRound.clear();
    for (const a of this.ctx.actors()) this.ctx.resetLoadout(a);
    this.startRound(time);
  }

  get frozen(): boolean {
    return this.phase === 'buy' && R.freezeDuringBuy;
  }

  /** buying allowed right now for this actor */
  canBuy(a: Actor, time: number): boolean {
    if (!a.alive) return false;
    if (this.phase === 'buy') return true;
    if (this.phase !== 'live' || time - this.liveStart > R.buyWindowAfterStart) return false;
    const z = this.map.buyZones[a.team];
    return a.pos.x >= z.min[0] && a.pos.x <= z.max[0] && a.pos.z >= z.min[1] && a.pos.z <= z.max[1];
  }

  /** seconds shown on the round clock */
  clock(time: number): number {
    if (this.phase === 'live' && this.bomb.status === 'planted') return Math.max(0, this.bomb.timer);
    return Math.max(0, this.phaseEnd - time);
  }

  private startRound(time: number): void {
    this.round++;
    if (this.round === R.halftimeAfter + 1) this.halftime();
    this.phase = 'buy';
    this.phaseEnd = time + R.buyTime;
    this.lastWinner = null;
    this.lastReason = null;

    const idx: Record<Team, number> = { attack: 0, defend: 0 };
    const actors = this.ctx.actors();
    for (const a of actors) {
      if (this.diedLastRound.has(a)) this.ctx.resetLoadout(a);
      const spawns = this.map.spawns[a.team];
      this.ctx.respawn(a, spawns[idx[a.team]++ % spawns.length]);
    }
    this.diedLastRound.clear();

    this.bomb.reset();
    const attackers = actors.filter((a) => a.team === 'attack');
    if (attackers.length) this.bomb.giveTo(attackers[Math.floor(Math.random() * attackers.length)]);
    this.syncObjective(time);
    this.events.emit('roundPhase', { phase: 'buy', round: this.round });
  }

  private halftime(): void {
    for (const a of this.ctx.actors()) {
      a.team = a.team === 'attack' ? 'defend' : 'attack';
      a.money = CONFIG.economy.startMoney;
      this.ctx.resetLoadout(a);
    }
    const s = this.score.attack;
    this.score.attack = this.score.defend;
    this.score.defend = s;
    this.diedLastRound.clear();
    this.events.emit('halftime', {});
  }

  update(dt: number, time: number): void {
    this.now = time;
    const actors = this.ctx.actors();
    if (this.phase === 'buy') {
      if (time >= this.phaseEnd) {
        this.phase = 'live';
        this.liveStart = time;
        this.phaseEnd = time + R.roundTime;
        this.events.emit('roundPhase', { phase: 'live', round: this.round });
      }
    } else if (this.phase === 'live') {
      this.bomb.update(dt, time, actors);
      const b = this.bomb.status;
      if (b === 'exploded') {
        this.endRound('attack', 'bomb', time);
      } else if (this.phase === 'live') {
        const aliveA = actors.some((a) => a.alive && a.team === 'attack');
        const aliveD = actors.some((a) => a.alive && a.team === 'defend');
        if (!aliveD && b !== 'defused') this.endRound('attack', 'elimination', time);
        else if (!aliveA && b !== 'planted') this.endRound('defend', 'elimination', time);
        else if (b !== 'planted' && time >= this.phaseEnd) this.endRound('defend', 'time', time);
      }
    } else if (this.phase === 'post') {
      // planted bomb keeps ticking into the post phase for show
      if (this.bomb.status === 'planted') this.bomb.update(dt, time, actors);
      if (time >= this.phaseEnd) {
        if (this.matchWinner) {
          this.phase = 'over';
          this.events.emit('roundPhase', { phase: 'over', round: this.round });
          this.events.emit('matchEnd', { winner: this.matchWinner });
        } else {
          this.startRound(time);
        }
      }
    }
    this.syncObjective(time);
  }

  private endRound(winner: Team, reason: RoundEndReason, time: number): void {
    if (this.phase !== 'live') return;
    this.phase = 'post';
    this.phaseEnd = Math.max(time, this.liveStart) + R.postRoundTime;
    this.lastWinner = winner;
    this.lastReason = reason;
    this.score[winner]++;
    if (this.score[winner] >= R.winsToWin) this.matchWinner = winner;
    this.events.emit('roundEnd', { winner, reason, round: this.round });
    this.events.emit('roundPhase', { phase: 'post', round: this.round });
  }

  private syncObjective(time: number): void {
    const o = this.objective;
    const b = this.bomb;
    o.live = this.phase === 'live';
    o.bomb = b.status;
    o.carrier = b.carrier;
    if (b.status === 'carried' && b.carrier) o.bombPos.copy(b.carrier.pos);
    o.plantedSite = b.site;
    o.roundTime = this.phase === 'live' ? time - this.liveStart : 0;
  }

  describeEnd(): string {
    if (!this.lastWinner || !this.lastReason) return '';
    return `${TEAM_NAMES_RU[this.lastWinner]} побеждает — ${REASON_TEXT[this.lastReason]}`;
  }
}
