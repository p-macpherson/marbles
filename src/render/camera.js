import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.5;

/**
 * Camera behaviour:
 *  - 'overview': static shot of the start area (pre-race)
 *  - 'follow':   orbits the followed marble at a fixed elevation angle. The
 *                heading follows the track direction; the user can add a yaw
 *                offset (drag / swipe) and zoom (wheel / pinch).
 */
export class CameraRig {
  constructor(camera, dom, course) {
    this.camera = camera;
    this.course = course;
    this.mode = 'overview';
    this.target = new THREE.Vector3();
    this.dir = new THREE.Vector3(1, 0, 0);
    this.yawOffset = 0;
    this.zoom = 1;
    this.blend = 1; // 0..1 transition from overview into follow
    this.bucketLook = 0; // 0..1, raises the angle to look down into the finish bucket
    this.onUserChange = null;
    this._from = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._bindInput(dom);
  }

  get adjusted() {
    return Math.abs(this.yawOffset) > 0.01 || Math.abs(this.zoom - 1) > 0.01;
  }

  resetView() {
    this.yawOffset = 0;
    this.zoom = 1;
    this.onUserChange?.();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'overview' && mode === 'follow') {
      this._from.copy(this.camera.position);
      this.blend = 0;
    }
    this.mode = mode;
  }

  _bindInput(dom) {
    const pointers = new Map();
    let pinchDist = 0;
    const pinchSpan = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const changed = () => this.onUserChange?.();

    dom.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'follow') return;
      try {
        dom.setPointerCapture(e.pointerId);
      } catch {}
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinchDist = pinchSpan();
    });
    dom.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) {
        // drag right → scene turns right (camera swings around the marble)
        this.yawOffset -= (dx / Math.max(300, dom.clientWidth)) * Math.PI * 1.6;
        changed();
      } else if (pointers.size === 2) {
        const d = pinchSpan();
        if (pinchDist > 0 && d > 0) {
          this.zoom = THREE.MathUtils.clamp((this.zoom * pinchDist) / d, MIN_ZOOM, MAX_ZOOM);
          changed();
        }
        pinchDist = d;
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      pinchDist = pointers.size === 2 ? pinchSpan() : 0;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'follow') return;
        e.preventDefault();
        const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(dy * 0.0015), MIN_ZOOM, MAX_ZOOM);
        changed();
      },
      { passive: false }
    );
    dom.addEventListener('dblclick', () => this.resetView());
  }

  overview(course) {
    this.mode = 'overview';
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

  update(dt, pos, sampleIdx, inBucket = false) {
    if (this.mode === 'overview') return;
    const c = this.course;
    this.target.lerp(pos, 1 - Math.exp(-dt * 10));

    const j = sampleIdx * 3;
    this._t.set(c.T[j], 0, c.T[j + 2]).normalize();
    this.dir.lerp(this._t, 1 - Math.exp(-dt * 2.5)).normalize();

    const portrait = this.camera.aspect < 1;
    // fixed elevation while racing; steeper once the marble is in the bucket so the rim doesn't hide it
    this.bucketLook += ((inBucket ? 1 : 0) - this.bucketLook) * (1 - Math.exp(-dt * 2));
    const elev = ((portrait ? 46 : 40) + this.bucketLook * 30) * DEG;
    const dist = (portrait ? 12.5 : 11) * this.zoom;
    const yaw = Math.atan2(this.dir.z, this.dir.x) + this.yawOffset;
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const horiz = dist * Math.cos(elev);
    this._desired.set(this.target.x - fx * horiz, this.target.y + dist * Math.sin(elev), this.target.z - fz * horiz);

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 1.4);
      const e = this.blend * this.blend * (3 - 2 * this.blend);
      this.camera.position.lerpVectors(this._from, this._desired, e);
    } else {
      this.camera.position.copy(this._desired);
    }
    // look slightly past the marble so more of the track ahead is visible
    this._look.set(this.target.x + fx * 1.5, this.target.y, this.target.z + fz * 1.5);
    this.camera.lookAt(this._look);
  }
}
