import { CONFIG, type HitZone } from '../config';
import type { EventBus } from '../core/EventBus';
import type { DamageSource, GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';

/**
 * Applies damage with armour: a vest protects body (and head with helmet),
 * legs are never armoured. `zone === null` means area/melee damage (treated as body).
 */
export function applyDamage(
  events: EventBus<GameEvents>,
  victim: Actor,
  attacker: Actor | null,
  raw: number,
  zone: HitZone | null,
  source: DamageSource,
  armorPen: number,
  time: number,
): number {
  if (!victim.alive || raw <= 0) return 0;
  const D = CONFIG.damage;
  let hp = raw;
  let ap = 0;
  const armoredZone = zone === 'body' || zone === null || (zone === 'head' && victim.helmet);
  if (victim.armor > 0 && armoredZone && armorPen < 1) {
    hp = raw * armorPen;
    ap = (raw - hp) * D.armorRatio;
    if (ap > victim.armor) {
      hp += (ap - victim.armor) / D.armorRatio;
      ap = victim.armor;
    }
  }
  const loss = Math.min(victim.hp, Math.max(1, Math.round(hp)));
  victim.hp -= loss;
  victim.armor = Math.max(0, victim.armor - Math.round(ap));
  if (victim.armor === 0) victim.helmet = false;
  victim.lastDamageFrom = attacker;
  victim.lastDamageTime = time;
  events.emit('damage', { attacker, victim, amount: loss, zone, source });
  if (victim.hp <= 0) killActor(events, victim, attacker, source, zone === 'head');
  return loss;
}

export function killActor(events: EventBus<GameEvents>, victim: Actor, killer: Actor | null, source: DamageSource, headshot: boolean): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  victim.deaths++;
  if (killer && killer !== victim && killer.team !== victim.team) {
    killer.kills++;
    killer.roundKills++;
  }
  events.emit('kill', { killer, victim, source, headshot });
}
