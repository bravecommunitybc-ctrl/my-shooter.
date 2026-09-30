import { CONFIG } from '../config';
import { AABB } from '../physics/AABB';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Actor } from './Actor';

const M = CONFIG.movement;

export interface MoveIntent {
  /** -1..1 */
  forward: number;
  /** -1..1 */
  right: number;
  jump: boolean;
  crouch: boolean;
  walk: boolean;
}

const box = new AABB();
const stepBox = new AABB();
const testBox = new AABB();

export function actorBox(a: Actor, out: AABB, y = a.pos.y, height = a.height): AABB {
  const r = M.halfWidth;
  return out.set(a.pos.x - r, y, a.pos.z - r, a.pos.x + r, y + height, a.pos.z + r);
}

export interface MoveResult {
  /** vertical speed at landing (positive number) or 0 */
  landedSpeed: number;
  jumped: boolean;
}

const result: MoveResult = { landedSpeed: 0, jumped: false };

/**
 * Source-like kinematic movement: ground friction + acceleration, weak air
 * control, gravity, axis-separated swept AABB collision with auto-step.
 * Counter-strafing falls out naturally: pressing the opposite key applies
 * friction and acceleration in the same direction, so speed drops fast.
 */
export function stepMovement(a: Actor, intent: MoveIntent, dt: number, world: CollisionWorld, speedMul: number): MoveResult {
  result.landedSpeed = 0;
  result.jumped = false;
  updateCrouch(a, intent.crouch, world);

  const f = intent.forward;
  const s = intent.right;
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  let wx = -sy * f + cy * s;
  let wz = -cy * f - sy * s;
  const wl = Math.hypot(wx, wz);
  let wishSpeed = 0;
  if (wl > 1e-6) {
    wx /= wl;
    wz /= wl;
    wishSpeed = M.runSpeed * speedMul * (a.crouching ? M.crouchMul : intent.walk ? M.walkMul : 1);
  }

  const v = a.vel;
  if (a.onGround) {
    if (intent.jump) {
      v.y = M.jumpVelocity;
      a.onGround = false;
      result.jumped = true;
      accelerate(a, wx, wz, wishSpeed, M.groundAccel, dt);
    } else {
      applyFriction(a, dt);
      accelerate(a, wx, wz, wishSpeed, M.groundAccel, dt);
    }
  } else {
    airAccelerate(a, wx, wz, wishSpeed, dt);
  }

  v.y -= M.gravity * dt;
  if (v.y < -M.maxFallSpeed) v.y = -M.maxFallSpeed;

  const fallSpeed = -v.y;
  const wasGround = a.onGround;
  moveWithCollision(a, v.x * dt, v.y * dt, v.z * dt, world);
  if (a.onGround && !wasGround) {
    result.landedSpeed = fallSpeed;
    a.sinceLanding = 0;
  }
  if (a.onGround) a.airTime = 0;
  else a.airTime += dt;
  a.sinceLanding += dt;

  // smooth eye height toward stance
  a.prevEyeHeight = a.eyeHeight;
  const targetEye = a.crouching ? M.crouchEye : M.standEye;
  a.eyeHeight += (targetEye - a.eyeHeight) * Math.min(1, M.eyeLerp * dt);
  return result;
}

function applyFriction(a: Actor, dt: number): void {
  const v = a.vel;
  const speed = Math.hypot(v.x, v.z);
  if (speed < 0.01) {
    v.x = 0;
    v.z = 0;
    return;
  }
  const control = Math.max(speed, M.stopSpeed);
  const drop = control * M.friction * dt;
  const k = Math.max(speed - drop, 0) / speed;
  v.x *= k;
  v.z *= k;
}

function accelerate(a: Actor, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const v = a.vel;
  const current = v.x * wx + v.z * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, add);
  v.x += accelSpeed * wx;
  v.z += accelSpeed * wz;
}

function airAccelerate(a: Actor, wx: number, wz: number, wishSpeed: number, dt: number): void {
  if (wishSpeed <= 0) return;
  const v = a.vel;
  const capped = Math.min(wishSpeed, M.airWishCap);
  const current = v.x * wx + v.z * wz;
  const add = capped - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(M.airAccel * dt * wishSpeed, add);
  v.x += accelSpeed * wx;
  v.z += accelSpeed * wz;
}

function moveWithCollision(a: Actor, dx: number, dy: number, dz: number, world: CollisionWorld): void {
  const r = M.halfWidth;
  actorBox(a, box);
  const startY = box.min[1];

  const ax = world.sweepAxis(box, 0, dx);
  box.translate(0, ax);
  const az = world.sweepAxis(box, 2, dz);
  box.translate(2, az);
  let rx = ax;
  let rz = az;
  let final = box;

  const blocked = Math.abs(ax - dx) > 1e-6 || Math.abs(az - dz) > 1e-6;
  if (blocked && a.onGround) {
    // auto-step: lift, move, drop back down
    actorBox(a, stepBox);
    const up = world.sweepAxis(stepBox, 1, M.stepHeight);
    stepBox.translate(1, up);
    const sx = world.sweepAxis(stepBox, 0, dx);
    stepBox.translate(0, sx);
    const sz = world.sweepAxis(stepBox, 2, dz);
    stepBox.translate(2, sz);
    const down = world.sweepAxis(stepBox, 1, -up);
    stepBox.translate(1, down);
    if (Math.hypot(sx, sz) > Math.hypot(ax, az) + 1e-4 && stepBox.min[1] >= startY - 1e-4) {
      final = stepBox;
      rx = sx;
      rz = sz;
    }
  }

  if (Math.abs(rx - dx) > 1e-6) a.vel.x = 0;
  if (Math.abs(rz - dz) > 1e-6) a.vel.z = 0;

  const ay = world.sweepAxis(final, 1, dy);
  final.translate(1, ay);
  if (dy < 0) {
    if (ay > dy + 1e-7) {
      a.onGround = true;
      a.vel.y = 0;
    } else {
      a.onGround = false;
    }
  } else if (dy > 0 && ay < dy - 1e-7) {
    a.vel.y = 0;
  }

  a.pos.set(final.min[0] + r, final.min[1], final.min[2] + r);
}

/** Crouch in air pulls the legs up (crouch-jump reaches 1.2 m crates). */
function updateCrouch(a: Actor, want: boolean, world: CollisionWorld): void {
  const dh = M.standHeight - M.crouchHeight;
  if (want && !a.crouching) {
    a.crouching = true;
    a.height = M.crouchHeight;
    if (!a.onGround) {
      a.pos.y += dh;
      a.prevPos.y += dh;
      a.eyeHeight -= dh;
      a.prevEyeHeight -= dh;
    }
  } else if (!want && a.crouching) {
    if (a.onGround) {
      if (!world.overlaps(actorBox(a, testBox, a.pos.y, M.standHeight))) {
        a.crouching = false;
        a.height = M.standHeight;
      }
    } else if (!world.overlaps(actorBox(a, testBox, a.pos.y - dh, M.standHeight))) {
      a.pos.y -= dh;
      a.prevPos.y -= dh;
      a.eyeHeight += dh;
      a.prevEyeHeight += dh;
      a.crouching = false;
      a.height = M.standHeight;
    } else if (!world.overlaps(actorBox(a, testBox, a.pos.y, M.standHeight))) {
      a.crouching = false;
      a.height = M.standHeight;
    }
  }
}

/** Soft push-apart so actors do not stand inside each other. */
export function separateActors(actors: Actor[], world: CollisionWorld): void {
  const minD = M.halfWidth * 2;
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < actors.length; j++) {
      const b = actors[j];
      if (!b.alive) continue;
      if (a.pos.y + a.height < b.pos.y || b.pos.y + b.height < a.pos.y) continue;
      let dx = b.pos.x - a.pos.x;
      let dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= minD) continue;
      if (d < 1e-4) {
        dx = 1;
        dz = 0;
      } else {
        dx /= d;
        dz /= d;
      }
      const push = (minD - d) * 0.5;
      nudge(a, -dx * push, -dz * push, world);
      nudge(b, dx * push, dz * push, world);
    }
  }
}

function nudge(a: Actor, dx: number, dz: number, world: CollisionWorld): void {
  actorBox(a, testBox);
  const mx = world.sweepAxis(testBox, 0, dx);
  testBox.translate(0, mx);
  const mz = world.sweepAxis(testBox, 2, dz);
  a.pos.x += mx;
  a.pos.z += mz;
}
