import type { CrosshairSettings } from '../core/Settings';

/** DOM crosshair; `spreadPx` widens the gap when `dynamic` is on. */
export class Crosshair {
  readonly el: HTMLDivElement;
  private lines: HTMLDivElement[] = [];
  private dot: HTMLDivElement;
  private s: CrosshairSettings;
  private lastGap = -1;

  constructor(parent: HTMLElement, settings: CrosshairSettings) {
    this.el = document.createElement('div');
    this.el.className = 'crosshair';
    for (let i = 0; i < 4; i++) {
      const l = document.createElement('div');
      l.className = 'ch-line';
      this.el.appendChild(l);
      this.lines.push(l);
    }
    this.dot = document.createElement('div');
    this.dot.className = 'ch-dot';
    this.el.appendChild(this.dot);
    parent.appendChild(this.el);
    this.s = settings;
    this.apply(settings);
  }

  apply(s: CrosshairSettings): void {
    this.s = s;
    const outline = s.outline ? '0 0 0 1px rgba(0,0,0,0.85)' : 'none';
    for (const l of this.lines) {
      l.style.background = s.color;
      l.style.boxShadow = outline;
    }
    this.dot.style.display = s.dot ? 'block' : 'none';
    this.dot.style.background = s.color;
    this.dot.style.boxShadow = outline;
    this.dot.style.width = this.dot.style.height = `${s.thickness}px`;
    this.dot.style.left = this.dot.style.top = `${-s.thickness / 2}px`;
    this.lastGap = -1;
    this.setSpread(0);
  }

  setSpread(spreadPx: number): void {
    const s = this.s;
    const gap = Math.round(s.gap + (s.dynamic ? spreadPx : 0));
    if (gap === this.lastGap) return;
    this.lastGap = gap;
    const t = s.thickness;
    const len = s.size;
    const [top, bottom, left, right] = this.lines;
    place(top, t, len, -t / 2, -gap - len);
    place(bottom, t, len, -t / 2, gap);
    place(left, len, t, -gap - len, -t / 2);
    place(right, len, t, gap, -t / 2);
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? 'block' : 'none';
  }
}

function place(el: HTMLElement, w: number, h: number, left: number, top: number): void {
  const st = el.style;
  st.width = `${w}px`;
  st.height = `${h}px`;
  st.left = `${left}px`;
  st.top = `${top}px`;
}
