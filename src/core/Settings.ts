import { CONFIG, type Difficulty, type Team } from '../config';

export interface CrosshairSettings {
  size: number;
  gap: number;
  thickness: number;
  color: string;
  dot: boolean;
  outline: boolean;
  dynamic: boolean;
}

export interface Settings {
  sensitivity: number;
  fov: number;
  volume: number;
  side: Team;
  difficulty: Difficulty;
  fullscreen: boolean;
  crosshair: CrosshairSettings;
}

const KEY = 'vantage.settings.v1';

export function defaultSettings(): Settings {
  const d = CONFIG.defaults;
  return { ...d, crosshair: { ...d.crosshair } };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...parsed, crosshair: { ...d.crosshair, ...(parsed.crosshair ?? {}) } };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable (private mode) — settings stay for this session only */
  }
}
