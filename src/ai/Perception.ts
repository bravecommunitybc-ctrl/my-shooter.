import * as THREE from 'three';
import type { Actor } from '../entities/Actor';
import type { CollisionWorld } from '../physics/CollisionWorld';

const _eye = new THREE.Vector3();
const _p = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** head/chest aim points in world space */
export function headPoint(a: Actor, out: THREE.Vector3): THREE.Vector3 {
  return out.set(a.pos.x, a.pos.y + a.height - 0.13, a.pos.z);
}

export function chestPoint(a: Actor, out: THREE.Vector3): THREE.Vector3 {
  return out.set(a.pos.x, a.pos.y + a.height * 0.66, a.pos.z);
}

/** true when `target` is inside the observer's field of view (cos of half angle) */
export function inFov(observer: Actor, target: Actor, cosHalfFov: number): boolean {
  observer.eyePosition(_eye);
  observer.viewDir(_dir);
  chestPoint(target, _p).sub(_eye);
  const len = _p.length();
  if (len < 1e-4) return true;
  return _dir.dot(_p) / len >= cosHalfFov;
}

/** line of sight from the observer's eye to target head or chest */
export function hasLineOfSight(observer: Actor, target: Actor, world: CollisionWorld): boolean {
  observer.eyePosition(_eye);
  if (world.segmentClear(_eye, headPoint(target, _p))) return true;
  if (world.segmentClear(_eye, chestPoint(target, _p))) return true;
  return false;
}
