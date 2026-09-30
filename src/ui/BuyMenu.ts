import type { Actor } from '../entities/Actor';
import { SHOP, type Economy, type ShopItem } from '../round/Economy';

/** B-menu: click or press 1–5 to buy. */
export class BuyMenu {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly money: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  open = false;
  private lastKey = '';

  constructor(parent: HTMLElement, private readonly economy: Economy, private readonly onBuy: (item: ShopItem) => void) {
    this.root = document.createElement('div');
    this.root.className = 'buy-menu';
    this.root.innerHTML = '<div class="buy-head"><b>Покупка</b><span class="buy-money"></span></div><div class="buy-list"></div><div class="buy-foot"><span class="buy-timer"></span><span>B / Esc — закрыть</span></div>';
    this.list = this.root.querySelector('.buy-list') as HTMLDivElement;
    this.money = this.root.querySelector('.buy-money') as HTMLDivElement;
    this.timer = this.root.querySelector('.buy-timer') as HTMLDivElement;
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  show(): void {
    this.open = true;
    this.lastKey = '';
    this.root.style.display = 'block';
  }

  hide(): void {
    this.open = false;
    this.root.style.display = 'none';
  }

  /** number keys while open */
  keyBuy(code: string): boolean {
    const m = /^Digit([1-9])$/.exec(code);
    if (!m) return false;
    const entry = this.visibleEntries[parseInt(m[1], 10) - 1];
    if (entry) this.onBuy(entry.item);
    return true;
  }

  private visibleEntries = SHOP;

  update(a: Actor, secondsLeft: number): void {
    if (!this.open) return;
    this.visibleEntries = SHOP.filter((e) => e.team === null || e.team === a.team);
    const rows = this.visibleEntries.map((e) => {
      const price = this.economy.priceFor(a, e.item);
      const owned = price === null;
      const afford = price !== null && price <= a.money;
      return { e, price, owned, afford };
    });
    const key = `${a.money}|${a.team}|${Math.ceil(secondsLeft)}|` + rows.map((r) => `${r.price}${r.afford}`).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.money.textContent = `$${a.money}`;
    this.timer.textContent = `Осталось ${Math.ceil(secondsLeft)} с`;
    this.list.innerHTML = '';
    rows.forEach((r, i) => {
      const b = document.createElement('button');
      b.className = `buy-item${r.owned ? ' owned' : r.afford ? '' : ' poor'}`;
      b.innerHTML = `<kbd>${i + 1}</kbd><span>${r.e.label}</span><em>${r.owned ? 'есть' : `$${r.price}`}</em>`;
      b.disabled = r.owned || !r.afford;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.onBuy(r.e.item);
      });
      this.list.appendChild(b);
    });
  }
}
