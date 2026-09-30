import { TEAM_NAMES, type Difficulty, type Team } from '../config';
import { defaultSettings, saveSettings, type Settings } from '../core/Settings';
import { Crosshair } from './Crosshair';

export interface MenuCallbacks {
  onPlay(): void;
  onResume(): void;
  onQuit(): void;
  onSettingsChanged(s: Settings): void;
}

type View = 'main' | 'settings' | 'pause' | 'over' | 'hidden';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Main menu, pause menu, settings and match-over screens (DOM overlay). */
export class Menu {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private view: View = 'main';
  private settingsReturn: View = 'main';
  private overTitle = '';
  private overText = '';

  constructor(parent: HTMLElement, private settings: Settings, private readonly cb: MenuCallbacks) {
    this.root = el('div', 'menu-root');
    this.panel = el('div', 'menu-panel');
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);
    this.render();
  }

  get isOpen(): boolean {
    return this.view !== 'hidden';
  }

  get currentView(): View {
    return this.view;
  }

  showMain(): void { this.view = 'main'; this.render(); }
  showPause(): void { this.view = 'pause'; this.render(); }
  showOver(title: string, text: string): void {
    this.overTitle = title;
    this.overText = text;
    this.view = 'over';
    this.render();
  }
  hide(): void { this.view = 'hidden'; this.render(); }

  private render(): void {
    this.root.style.display = this.view === 'hidden' ? 'none' : 'flex';
    this.root.classList.toggle('menu-dim', this.view === 'pause' || this.view === 'over');
    this.panel.innerHTML = '';
    if (this.view === 'main') this.renderMain();
    else if (this.view === 'pause') this.renderPause();
    else if (this.view === 'settings') this.renderSettings();
    else if (this.view === 'over') this.renderOver();
  }

  private button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
    const b = el('button', cls, label);
    b.addEventListener('click', onClick);
    return b;
  }

  private renderMain(): void {
    const title = el('div', 'logo');
    title.innerHTML = 'VANTAGE<span>тактический 5 на 5</span>';
    this.panel.appendChild(title);
    const info = el('div', 'menu-info');
    const side = this.settings.side === 'attack' ? `${TEAM_NAMES.attack} (атака)` : `${TEAM_NAMES.defend} (защита)`;
    info.textContent = `Карта: Quarry · Стартовая сторона: ${side} · Боты: ${diffName(this.settings.difficulty)}`;
    this.panel.appendChild(info);
    this.panel.appendChild(this.button('Играть', () => this.cb.onPlay(), 'btn btn-primary'));
    this.panel.appendChild(this.button('Настройки', () => this.openSettings('main')));
    this.panel.appendChild(controlsHelp());
  }

  private renderPause(): void {
    this.panel.appendChild(el('h2', undefined, 'Пауза'));
    this.panel.appendChild(this.button('Продолжить', () => this.cb.onResume(), 'btn btn-primary'));
    this.panel.appendChild(this.button('Настройки', () => this.openSettings('pause')));
    this.panel.appendChild(this.button('Выйти в меню', () => this.cb.onQuit()));
  }

  private renderOver(): void {
    this.panel.appendChild(el('h2', undefined, this.overTitle));
    this.panel.appendChild(el('p', 'menu-info', this.overText));
    this.panel.appendChild(this.button('В главное меню', () => this.cb.onQuit(), 'btn btn-primary'));
  }

  private openSettings(from: View): void {
    this.settingsReturn = from;
    this.view = 'settings';
    this.render();
  }

  private commit(): void {
    saveSettings(this.settings);
    this.cb.onSettingsChanged(this.settings);
  }

  private renderSettings(): void {
    const s = this.settings;
    this.panel.appendChild(el('h2', undefined, 'Настройки'));
    const grid = el('div', 'settings-grid');
    this.panel.appendChild(grid);

    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)) => {
      const l = el('label', undefined, label);
      const wrap = el('div', 'row');
      const input = el('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(get());
      const out = el('span', 'val', fmt(get()));
      input.addEventListener('input', () => {
        set(parseFloat(input.value));
        out.textContent = fmt(get());
        this.commit();
        preview.apply(s.crosshair);
      });
      wrap.append(input, out);
      grid.append(l, wrap);
    };
    const select = <T extends string>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const l = el('label', undefined, label);
      const sel = el('select');
      for (const [v, t] of opts) {
        const o = el('option', undefined, t);
        o.value = v;
        sel.appendChild(o);
      }
      sel.value = get();
      sel.addEventListener('change', () => {
        set(sel.value as T);
        this.commit();
      });
      grid.append(l, sel);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const l = el('label', undefined, label);
      const c = el('input');
      c.type = 'checkbox';
      c.checked = get();
      c.addEventListener('change', () => {
        set(c.checked);
        this.commit();
        preview.apply(s.crosshair);
      });
      grid.append(l, c);
    };

    slider('Чувствительность мыши', 0.1, 5, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v));
    slider('Поле зрения (FOV, вертикальное)', 55, 100, 1, () => s.fov, (v) => (s.fov = v), (v) => `${v.toFixed(0)}°`);
    slider('Громкость', 0, 1, 0.01, () => s.volume, (v) => (s.volume = v), (v) => `${Math.round(v * 100)}%`);
    select<Difficulty>('Сложность ботов', [['easy', 'Лёгкая'], ['normal', 'Нормальная'], ['hard', 'Сложная']], () => s.difficulty, (v) => (s.difficulty = v));
    select<Team>('Стартовая сторона', [['attack', `${TEAM_NAMES.attack} — атака`], ['defend', `${TEAM_NAMES.defend} — защита`]], () => s.side, (v) => (s.side = v));
    check('Полный экран при старте (позволяет Ctrl без закрытия вкладки)', () => s.fullscreen, (v) => (s.fullscreen = v));

    grid.appendChild(el('div', 'settings-sep', 'Прицел'));
    slider('Длина линий', 1, 20, 1, () => s.crosshair.size, (v) => (s.crosshair.size = v), (v) => v.toFixed(0));
    slider('Зазор', 0, 20, 1, () => s.crosshair.gap, (v) => (s.crosshair.gap = v), (v) => v.toFixed(0));
    slider('Толщина', 1, 6, 1, () => s.crosshair.thickness, (v) => (s.crosshair.thickness = v), (v) => v.toFixed(0));
    const colorLabel = el('label', undefined, 'Цвет');
    const color = el('input');
    color.type = 'color';
    color.value = s.crosshair.color;
    color.addEventListener('input', () => {
      s.crosshair.color = color.value;
      this.commit();
      preview.apply(s.crosshair);
    });
    grid.append(colorLabel, color);
    check('Точка в центре', () => s.crosshair.dot, (v) => (s.crosshair.dot = v));
    check('Обводка', () => s.crosshair.outline, (v) => (s.crosshair.outline = v));
    check('Динамический (расходится при движении)', () => s.crosshair.dynamic, (v) => (s.crosshair.dynamic = v));

    const previewBox = el('div', 'ch-preview');
    this.panel.appendChild(previewBox);
    const preview = new Crosshair(previewBox, s.crosshair);

    const row = el('div', 'row');
    row.appendChild(this.button('Сбросить', () => {
      const d = defaultSettings();
      Object.assign(s, d);
      this.commit();
      this.render();
    }));
    row.appendChild(this.button('Назад', () => {
      this.view = this.settingsReturn;
      this.render();
    }, 'btn btn-primary'));
    this.panel.appendChild(row);
  }
}

function diffName(d: Difficulty): string {
  return d === 'easy' ? 'лёгкие' : d === 'hard' ? 'сложные' : 'нормальные';
}

function controlsHelp(): HTMLElement {
  const d = el('div', 'controls-help');
  const rows: [string, string][] = [
    ['WASD', 'движение'], ['Мышь', 'обзор / стрельба, ПКМ — прицел'], ['Shift', 'тихий шаг'], ['Ctrl / C', 'присед'],
    ['Space', 'прыжок'], ['R', 'перезарядка'], ['1 / 2 / 3', 'оружие'], ['Q', 'прошлое оружие'],
    ['B', 'меню покупки'], ['E', 'заложить / обезвредить'], ['Tab', 'таблица счёта'], ['Esc', 'пауза'],
  ];
  for (const [k, v] of rows) {
    const r = el('div');
    r.append(el('kbd', undefined, k), el('span', undefined, v));
    d.appendChild(r);
  }
  return d;
}
