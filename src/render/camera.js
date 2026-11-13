import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Camera behaviour:
 *  - 'overview': static shot of the start area (pre-race)
 *  - 'chase':    sits behind the followed marble, looking down the track
 *  - 'orbit':    user drags / pinches to look around the followed marble
 */
export class CameraRig {
  constructor(camera, dom, course) {
    this.camera = camera;
    this.course = course;
    this.mode = 'overview';
    this.target = new THREE.Vector3();
    this.dir = new THREE.Vector3(1, 0, 0);
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 80;
    this.controls.maxPolarAngle = Math.PI * 0.9;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.controls.target.copy(this.target);
      this.controls.update();
    }
  }

  overview(course) {
    this.mode = 'overview';
    this.controls.enabled = false;
    const j = Math.round((course.spawn.j0 + course.spawn.j1) / 2);
    const p = new THREE.Vector3(course.P[j * 3], course.P[j * 3 + 1], course.P[j * 3 + 2]);
    const t = new THREE.Vector3(course.T[j * 3], 0, course.T[j * 3 + 2]).normalize();
    const r = new THREE.Vector3(course.RV[j * 3], 0, course.RV[j * 3 + 2]).normalize();
    this.target.copy(p).addScaledVector(UP, 3);
    this.dir.copy(t);
    const portrait = this.camera.aspect < 1;
    this.camera.position
      .copy(p)
      .addScaledVector(t, portrait ? 24 : 18)
      .addScaledVector(r, portrait ? 10 : 12)
      .addScaledVector(UP, portrait ? 14 : 10);
    this.camera.lookAt(this.target);
  }

  update(dt, pos, sampleIdx) {
    if (this.mode === 'overview') return;
    const c = this.course;
    const kTarget = 1 - Math.exp(-dt * 10);
    this.target.lerp(pos, kTarget);

    if (this.mode === 'chase') {
      const j = sampleIdx * 3;
      this._t.set(c.T[j], 0, c.T[j + 2]).normalize();
      this.dir.lerp(this._t, 1 - Math.exp(-dt * 2.5)).normalize();
      const portrait = this.camera.aspect < 1;
      const dist = portrait ? 9 : 8.5;
      const height = portrait ? 7.5 : 5;
      this._desired.copy(this.target).addScaledVector(this.dir, -dist).addScaledVector(UP, height);
      this.camera.position.lerp(this._desired, 1 - Math.exp(-dt * 4));
      this._look.copy(this.target).addScaledVector(this.dir, 3.5);
      this.camera.lookAt(this._look);
    } else if (this.mode === 'orbit') {
      const ctl = this.controls;
      this._t.copy(this.target).sub(ctl.target);
      this.camera.position.add(this._t);
      ctl.target.copy(this.target);
      ctl.update();
    }
  }
}
