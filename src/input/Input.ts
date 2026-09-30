export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'crouch' | 'walk'
  | 'fire' | 'alt' | 'reload'
  | 'slot1' | 'slot2' | 'slot3' | 'lastWeapon'
  | 'buy' | 'use' | 'scoreboard';

/** Codes are KeyboardEvent.code values or `Mouse<button>`. */
export const BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'Wheel'],
  // Ctrl+W cannot be intercepted by a page outside fullscreen+keyboard lock, so C is an alternative
  crouch: ['ControlLeft', 'ControlRight', 'KeyC'],
  walk: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0'],
  alt: ['Mouse2'],
  reload: ['KeyR'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  lastWeapon: ['KeyQ'],
  buy: ['KeyB'],
  use: ['KeyE'],
  scoreboard: ['Tab'],
};

/**
 * Keyboard + mouse state. Presses are counted so that a tap between two
 * simulation ticks is never lost (`consume`), while `isDown` gives held state.
 */
export class Input {
  private down = new Set<string>();
  private presses = new Map<string, number>();
  private mdx = 0;
  private mdy = 0;
  locked = false;
  /** when false, game keys are not captured (menus with text inputs) */
  capture = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  onKey: ((code: string) => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('blur', () => this.releaseAll());
    window.addEventListener('contextmenu', (e) => {
      if (this.capture) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) this.releaseAll();
      this.onLockChange?.(this.locked);
    });
  }

  requestLock(): void {
    const el = this.target as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => {
          // unadjustedMovement unsupported (or cooldown) — retry plain
          try {
            const p2 = el.requestPointerLock();
            if (p2 && typeof (p2 as Promise<void>).catch === 'function') (p2 as Promise<void>).catch(() => undefined);
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      /* ignore */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    for (const code of BINDINGS[action]) if (this.down.has(code)) return true;
    return false;
  }

  /** true if the action was pressed at least once since the last consume */
  consume(action: Action): boolean {
    let hit = false;
    for (const code of BINDINGS[action]) {
      if ((this.presses.get(code) ?? 0) > 0) {
        this.presses.set(code, 0);
        hit = true;
      }
    }
    return hit;
  }

  takeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mdx, dy: this.mdy };
    this.mdx = 0;
    this.mdy = 0;
    return r;
  }

  clearPresses(): void {
    this.presses.clear();
    this.mdx = 0;
    this.mdy = 0;
  }

  releaseAll(): void {
    this.down.clear();
    this.presses.clear();
  }

  private press(code: string): void {
    this.down.add(code);
    this.presses.set(code, (this.presses.get(code) ?? 0) + 1);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    this.onKey?.(e.code);
    if (!this.capture) return;
    // keep browser shortcuts (Ctrl+S, Ctrl+D, Tab focus…) from stealing game keys
    if (e.code !== 'F11' && e.code !== 'F12' && e.code !== 'Escape') e.preventDefault();
    if (e.repeat) return;
    this.press(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    if (this.capture && e.code !== 'Escape') e.preventDefault();
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return;
    e.preventDefault();
    this.press('Mouse' + e.button);
  };

  private handleMouseUp = (e: MouseEvent): void => {
    this.down.delete('Mouse' + e.button);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // guard against the occasional huge spike some browsers emit on lock
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
    this.mdx += e.movementX;
    this.mdy += e.movementY;
  };

  private handleWheel = (e: WheelEvent): void => {
    if (!this.locked) return;
    e.preventDefault();
    // scroll-wheel jump: register as a tap
    this.presses.set('Wheel', (this.presses.get('Wheel') ?? 0) + 1);
  };
}
