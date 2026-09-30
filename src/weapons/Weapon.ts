import { WEAPONS, type WeaponId, type WeaponStats } from '../config';

/** Runtime state of one weapon instance (ammo, timers, recoil accumulators). */
export class Weapon {
  readonly stats: WeaponStats;
  mag: number;
  reserve: number;
  nextFireTime = 0;
  /** 0 when not reloading, otherwise sim time the reload finishes */
  reloadEnd = 0;
  reloadStart = 0;
  drawEnd = 0;
  sprayIndex = 0;
  /** accumulated recoil offset added to the aim (radians) */
  recoilPitch = 0;
  recoilYaw = 0;
  /** accumulated spread from consecutive shots (radians) */
  shotSpread = 0;
  lastShotTime = -100;
  scoped = false;
  /** re-enter scope after bolt cycling */
  resumeScopeAt = 0;
  /** semi-auto trigger latch */
  latched = false;

  constructor(id: WeaponId) {
    this.stats = WEAPONS[id];
    this.mag = this.stats.magSize;
    this.reserve = this.stats.reserve;
  }

  get id(): WeaponId {
    return this.stats.id;
  }

  get reloading(): boolean {
    return this.reloadEnd > 0;
  }

  refill(): void {
    this.mag = this.stats.magSize;
    this.reserve = this.stats.reserve;
    this.reloadEnd = 0;
  }

  resetState(): void {
    this.reloadEnd = 0;
    this.sprayIndex = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.shotSpread = 0;
    this.scoped = false;
    this.resumeScopeAt = 0;
    this.nextFireTime = 0;
    this.latched = false;
  }
}
