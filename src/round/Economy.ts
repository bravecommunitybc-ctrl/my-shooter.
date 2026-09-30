import { CONFIG, WEAPONS, type Team, type WeaponId } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';
import type { WeaponSystem } from '../weapons/WeaponSystem';

const E = CONFIG.economy;

export type ShopItem = 'kestrel' | 'longbow' | 'vest' | 'vestHelmet' | 'kit';

export interface ShopEntry {
  item: ShopItem;
  label: string;
  price: number;
  team: Team | null;
}

export const SHOP: ShopEntry[] = [
  { item: 'kestrel', label: WEAPONS.kestrel.name, price: WEAPONS.kestrel.price, team: null },
  { item: 'longbow', label: WEAPONS.longbow.name, price: WEAPONS.longbow.price, team: null },
  { item: 'vest', label: 'Бронежилет', price: E.prices.vest, team: null },
  { item: 'vestHelmet', label: 'Бронежилет + шлем', price: E.prices.vestHelmet, team: null },
  { item: 'kit', label: 'Набор сапёра', price: E.prices.kit, team: 'defend' },
];

/**
 * Money: kill rewards per weapon, round win/loss payouts with a
 * loss-streak bonus, plant/defuse bonuses, and the shop.
 */
export class Economy {
  readonly lossStreak: Record<Team, number> = { attack: 0, defend: 0 };
  private plantedThisRound = false;

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly actors: () => Actor[],
    private readonly weapons: WeaponSystem,
    private readonly time: () => number,
  ) {
    events.on('kill', (e) => {
      const k = e.killer;
      if (!k || k === e.victim || k.team === e.victim.team) return;
      if (e.source === 'bomb' || e.source === 'fall') return;
      this.add(k, WEAPONS[e.source].killReward, 'убийство');
    });
    events.on('bombPlanted', (e) => {
      this.plantedThisRound = true;
      this.add(e.actor, E.planterBonus, 'закладка');
    });
    events.on('bombDefused', (e) => this.add(e.actor, E.defuserBonus, 'обезвреживание'));
    events.on('roundPhase', (e) => {
      if (e.phase === 'buy') this.plantedThisRound = false;
    });
    events.on('roundEnd', (e) => {
      const loser: Team = e.winner === 'attack' ? 'defend' : 'attack';
      const win =
        e.reason === 'bomb' ? E.winBomb : e.reason === 'defuse' ? E.winDefuse : e.reason === 'time' ? E.winTime : E.winElimination;
      this.lossStreak[e.winner] = Math.max(0, this.lossStreak[e.winner] - 1);
      this.lossStreak[loser] = Math.min(5, this.lossStreak[loser] + 1);
      let loss = Math.min(E.lossBase + E.lossStep * (this.lossStreak[loser] - 1), E.lossMax);
      if (loser === 'attack' && this.plantedThisRound) loss += E.plantedLossBonus;
      for (const a of this.actors()) {
        if (a.team === e.winner) this.add(a, win, 'победа в раунде');
        else this.add(a, loss, 'поражение');
      }
    });
    events.on('halftime', () => {
      this.lossStreak.attack = this.lossStreak.defend = 0;
    });
  }

  /** what the losing team would get next loss */
  nextLossBonus(team: Team): number {
    return Math.min(E.lossBase + E.lossStep * this.lossStreak[team], E.lossMax);
  }

  add(a: Actor, amount: number, reason: string): void {
    const before = a.money;
    a.money = Math.min(E.maxMoney, a.money + amount);
    if (a.money !== before) this.events.emit('reward', { actor: a, amount: a.money - before, reason });
  }

  /** price for this actor right now, or null if the item is not purchasable */
  priceFor(a: Actor, item: ShopItem): number | null {
    switch (item) {
      case 'kestrel':
      case 'longbow':
        return a.loadout.primary?.id === item ? null : WEAPONS[item].price;
      case 'vest':
        return a.armor >= CONFIG.damage.maxArmor ? null : E.prices.vest;
      case 'vestHelmet':
        if (a.helmet && a.armor >= CONFIG.damage.maxArmor) return null;
        return a.armor >= CONFIG.damage.maxArmor ? E.prices.vestHelmet - E.prices.vest : E.prices.vestHelmet;
      case 'kit':
        return a.team !== 'defend' || a.hasKit ? null : E.prices.kit;
    }
  }

  buy(a: Actor, item: ShopItem): boolean {
    const price = this.priceFor(a, item);
    if (price === null || price > a.money) return false;
    a.money -= price;
    switch (item) {
      case 'kestrel':
      case 'longbow':
        this.weapons.give(a, item as WeaponId, this.time());
        break;
      case 'vest':
        a.armor = CONFIG.damage.maxArmor;
        break;
      case 'vestHelmet':
        a.armor = CONFIG.damage.maxArmor;
        a.helmet = true;
        break;
      case 'kit':
        a.hasKit = true;
        break;
    }
    this.events.emit('purchase', { actor: a, item });
    return true;
  }

  /**
   * Bot shopping: full buy when affordable, a team-wide eco when the
   * team is broke, light armour on pistol rounds.
   */
  botBuy(a: Actor, round: number, teamAvgMoney: number, sniperTaken: boolean): boolean {
    const full = WEAPONS.kestrel.price + E.prices.vestHelmet;
    const pistolRound = round === 1 || round === CONFIG.round.halftimeAfter + 1;
    let tookSniper = false;
    if (pistolRound) {
      if (Math.random() < 0.6) this.buy(a, 'vest');
      else if (a.team === 'defend') this.buy(a, 'kit');
      return false;
    }
    const eco = teamAvgMoney < full * 0.85 && a.money < full + 600;
    if (eco && !a.loadout.primary) {
      // save, maybe a vest if flush enough
      if (a.money > 2400 && Math.random() < 0.5) this.buy(a, 'vest');
      return false;
    }
    if (!a.loadout.primary) {
      const wantSniper = !sniperTaken && a.money >= WEAPONS.longbow.price + E.prices.vestHelmet && Math.random() < 0.35;
      if (wantSniper) tookSniper = this.buy(a, 'longbow');
      else this.buy(a, 'kestrel');
    }
    if (a.money >= E.prices.vestHelmet || (a.armor >= CONFIG.damage.maxArmor && !a.helmet)) this.buy(a, 'vestHelmet');
    else this.buy(a, 'vest');
    if (a.team === 'defend' && a.money >= E.prices.kit + 400) this.buy(a, 'kit');
    return tookSniper;
  }
}
