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
  readIntent(frozen: boolean, menuOpen = false): void {
    const i = this.input;
    const a = this.actor;
    const it = a.intent;
    const wi = a.weaponIntent;
    const jumpTap = i.consume('jump');
    const fireTap = i.consume('fire');

    if (menuOpen) {
      // number keys belong to the buy menu
      i.consume('slot1');
      i.consume('slot2');
      i.consume('slot3');
    } else if (i.consume('slot1')) wi.switchTo = 'primary';
    else if (i.consume('slot2')) wi.switchTo = 'secondary';
    else if (i.consume('slot3')) wi.switchTo = 'melee';
    else if (i.consume('lastWeapon')) wi.switchTo = a.lastSlot;
    if (i.consume('reload')) wi.reload = true;
    if (i.consume('alt')) wi.alt = true;
    wi.fire = !frozen && !menuOpen && (i.isDown('fire') || fireTap);
    wi.use = i.isDown('use');

    if (frozen || !a.alive) {
      it.forward = it.right = 0;
      it.jump = false;
      it.walk = false;
      it.crouch = a.alive && i.isDown('crouch');
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
