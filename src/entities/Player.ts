import * as THREE from 'three';
import { DEG } from '../config';
import type { Input } from '../input/Input';
import type { Actor } from './Actor';

const MAX_PITCH = 89 * DEG;
const _pos = new THREE.Vector3();

/** Human controller: mouse → view angles, keys → movement intent, camera placement. */
export class Player {
  /** multiplied into sensitivity while scoped */
  zoomSensMul = 1;
  /** camera-only recoil kick (radians) supplied by the weapon system */
  kickPitch = 0;
  kickYaw = 0;

  constructor(readonly actor: Actor, private readonly input: Input) {}

  look(dx: number, dy: number, sensitivity: number): void {
    const k = sensitivity * 0.022 * DEG * this.zoomSensMul;
    const a = this.actor;
    a.yaw -= dx * k;
    a.pitch -= dy * k;
    if (a.pitch > MAX_PITCH) a.pitch = MAX_PITCH;
    if (a.pitch < -MAX_PITCH) a.pitch = -MAX_PITCH;
    // keep yaw bounded for numeric stability
    if (a.yaw > Math.PI) a.yaw -= Math.PI * 2;
    else if (a.yaw < -Math.PI) a.yaw += Math.PI * 2;
  }

  /** Writes the movement intent for this tick. */
  readIntent(frozen: boolean): void {
    const i = this.input;
    const it = this.actor.intent;
    const jumpTap = i.consume('jump');
    if (frozen || !this.actor.alive) {
      it.forward = it.right = 0;
      it.jump = false;
      it.walk = false;
      it.crouch = this.actor.alive && i.isDown('crouch');
      return;
    }
    it.forward = (i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0);
    it.right = (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0);
    it.jump = i.isDown('jump') || jumpTap;
    it.crouch = i.isDown('crouch');
    it.walk = i.isDown('walk');
  }

  /** Places the camera at the interpolated eye position. */
  updateCamera(camera: THREE.Camera, alpha: number): void {
    const a = this.actor;
    _pos.lerpVectors(a.prevPos, a.pos, alpha);
    const eye = a.prevEyeHeight + (a.eyeHeight - a.prevEyeHeight) * alpha;
    camera.position.set(_pos.x, _pos.y + eye, _pos.z);
    camera.rotation.set(a.pitch + this.kickPitch, a.yaw + this.kickYaw, 0, 'YXZ');
  }
}
