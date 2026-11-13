// three.js presentation of a race. Nothing in here feeds back into the
// simulation, so it is free to use non-deterministic maths.

import * as THREE from 'three';
import { createPartBuffer, evaluateObstacles, MARBLE_R } from '../sim/track.js';
import { DT } from '../sim/race.js';
import { CameraRig } from './camera.js';

const ZONE_COLORS = {
  start: '#5aa9e6',
  track: '#e8eef5',
  spinners: '#ffb84d',
  pendulums: '#c792ea',
  pegs: '#7bd389',
  helix: '#ff8fa3',
  pushers: '#66d9e8',
  final: '#f6f7f9',
  runout: '#f6f7f9',
};

export function marbleColor(i) {
  const c = new THREE.Color();
  c.setHSL(((i * 137.508) % 360) / 360, 0.72, 0.52);
  return c;
}
export const marbleCss = (i) => '#' + marbleColor(i).getHexString();

const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const isSmallScreen = () => Math.min(window.innerWidth, window.innerHeight) < 600;

export class RaceView {
  constructor(container, labelLayer, course) {
    this.course = course;
    this.container = container;
    this.labelLayer = labelLayer;
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);
    this.rig = new CameraRig(this.camera, renderer.domElement, course);

    this.groundY = course.minY - 14;
    this._buildEnvironment();
    this._buildTrack();
    this._buildObstacles();
    this._buildLandmarks();

    this.marbles = [];
    this.labels = [];
    this.focus = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.onLabelClick = null;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- scene
  _buildEnvironment() {
    const scene = this.scene;
    const skyGeo = new THREE.SphereGeometry(1200, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#5b9be0') }, bottom: { value: new THREE.Color('#dff1ff') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }',
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(this.sky);
    scene.fog = new THREE.Fog('#d4ebfb', 140, 520);

    scene.add(new THREE.HemisphereLight('#eaf6ff', '#6b8f5a', 1.4));
    const sun = (this.sun = new THREE.DirectionalLight('#fff4e0', 2.4));
    sun.castShadow = true;
    const ms = isSmallScreen() ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    // ground with a soft checker so motion/height reads well
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#86b86a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#7aad5f';
    g.fillRect(0, 0, 64, 64);
    g.fillRect(64, 64, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(120, 120);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = this.groundY;
    ground.receiveShadow = true;
    scene.add(ground);

    // a scattering of trees for scale (visual only — Math.random is fine here,
    // but keep it stable between loads anyway)
    const c = this.course;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let j = 0; j < c.sampleCount; j++) {
      minX = Math.min(minX, c.P[j * 3]); maxX = Math.max(maxX, c.P[j * 3]);
      minZ = Math.min(minZ, c.P[j * 3 + 2]); maxZ = Math.max(maxZ, c.P[j * 3 + 2]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    let s = 12345;
    const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    const trunks = [], tops = [];
    for (let i = 0; i < 260; i++) {
      const x = minX - 80 + rand() * (maxX - minX + 160);
      const z = minZ - 80 + rand() * (maxZ - minZ + 160);
      // keep away from the course footprint
      let near = false;
      for (let j = 0; j < c.sampleCount && !near; j += 4) {
        const dx = c.P[j * 3] - x, dz = c.P[j * 3 + 2] - z;
        if (dx * dx + dz * dz < (c.HW[j] + 6) ** 2) near = true;
      }
      if (near) continue;
      const h = 4 + rand() * 6;
      trunks.push([x, z, h]);
      tops.push([x, z, h]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 1, 6);
    const topGeo = new THREE.ConeGeometry(1, 1, 7);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 1 }), trunks.length);
    const topMesh = new THREE.InstancedMesh(topGeo, new THREE.MeshStandardMaterial({ color: '#3f7d4a', roughness: 0.9, flatShading: true }), tops.length);
    const m = new THREE.Matrix4();
    trunks.forEach(([x, z, h], i) => {
      m.compose(new THREE.Vector3(x, this.groundY + h * 0.2, z), new THREE.Quaternion(), new THREE.Vector3(1, h * 0.4, 1));
      trunkMesh.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, this.groundY + h * 0.4 + h * 0.35, z), new THREE.Quaternion(), new THREE.Vector3(h * 0.28, h * 0.7, h * 0.28));
      topMesh.setMatrixAt(i, m);
    });
    topMesh.castShadow = true;
    scene.add(trunkMesh, topMesh);
  }

  _gridGeometry(rows, cols, pointFn, colorFn) {
    const pos = new Float32Array(rows * cols * 3);
    const col = colorFn ? new Float32Array(rows * cols * 3) : null;
    const tmpC = new THREE.Color();
    for (let j = 0; j < rows; j++)
      for (let k = 0; k < cols; k++) {
        const p = pointFn(j, k);
        const o = (j * cols + k) * 3;
        pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
        if (col) {
          colorFn(j, k, tmpC);
          col[o] = tmpC.r; col[o + 1] = tmpC.g; col[o + 2] = tmpC.b;
        }
      }
    const idx = [];
    for (let j = 0; j < rows - 1; j++)
      for (let k = 0; k < cols - 1; k++) {
        const a = j * cols + k, b = a + 1, c = a + cols, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  _buildTrack() {
    const c = this.course, scene = this.scene, nS = c.sampleCount;
    const zoneColor = c.segments.map((s) => new THREE.Color(ZONE_COLORS[s.zone] || ZONE_COLORS.track));

    const floorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
    const floor = new THREE.Mesh(
      this._gridGeometry(nS, 4, (j, k) => c.profiles[j][k + 1], (j, k, out) => {
        out.copy(zoneColor[c.sampleSeg[j]]);
        if (Math.floor(c.S[j] / 2.25) % 2) out.multiplyScalar(0.88);
        if (k === 0 || k === 3) out.multiplyScalar(0.8);
      }),
      floorMat
    );
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({
      color: '#bfe3ff', transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#3d82c9', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
    for (const [top, bottom] of [[0, 1], [5, 4]]) {
      const wall = new THREE.Mesh(this._gridGeometry(nS, 2, (j, k) => c.profiles[j][k === 0 ? top : bottom]), wallMat);
      wall.renderOrder = 2;
      scene.add(wall);
      const rim = new THREE.Mesh(
        this._gridGeometry(nS, 2, (j, k) => {
          const p = c.profiles[j][top];
          const d = k === 0 ? 0 : 0.14;
          return [p[0] - c.U[j * 3] * d, p[1] - c.U[j * 3 + 1] * d, p[2] - c.U[j * 3 + 2] * d];
        }),
        rimMat
      );
      rim.castShadow = true;
      scene.add(rim);
    }
    // floor underside trim for a bit of thickness
    const under = new THREE.Mesh(
      this._gridGeometry(nS, 2, (j, k) => {
        const p = c.profiles[j][k === 0 ? 1 : 4];
        return [p[0] - c.U[j * 3] * 0.6, p[1] - c.U[j * 3 + 1] * 0.6, p[2] - c.U[j * 3 + 2] * 0.6];
      }),
      new THREE.MeshStandardMaterial({ color: '#36577a', roughness: 0.8, side: THREE.DoubleSide })
    );
    under.castShadow = true;
    scene.add(under);

    // end caps
    for (const j of c.caps) {
      const pr = c.profiles[j];
      const pos = [];
      for (let k = 1; k < 5; k++) pos.push(...pr[0], ...pr[k], ...pr[k + 1]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, wallMat);
      m.renderOrder = 2;
      scene.add(m);
    }

    // support pillars wherever there is no track directly underneath
    const pillars = [];
    for (let j = 4; j < nS; j += 12) {
      const px = c.P[j * 3], py = c.P[j * 3 + 1], pz = c.P[j * 3 + 2];
      let blocked = false;
      for (let k = 0; k < nS && !blocked; k++) {
        if (c.P[k * 3 + 1] > py - 1.5) continue;
        const dx = c.P[k * 3] - px, dz = c.P[k * 3 + 2] - pz;
        if (dx * dx + dz * dz < (c.HW[k] + 1.2) ** 2) blocked = true;
      }
      if (!blocked) pillars.push([px, py - 0.6, pz]);
    }
    const pillarMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.3, 0.45, 1, 10),
      new THREE.MeshStandardMaterial({ color: '#9aa7b4', roughness: 0.6, metalness: 0.4 }),
      pillars.length
    );
    const mm = new THREE.Matrix4();
    pillars.forEach(([x, y, z], i) => {
      const h = y - this.groundY;
      mm.compose(new THREE.Vector3(x, this.groundY + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      pillarMesh.setMatrixAt(i, mm);
    });
    pillarMesh.castShadow = true;
    scene.add(pillarMesh);
  }

  _capsuleMesh(a, b, r, mat) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 16), mat);
    this._placeCapsule(mesh, a[0], a[1], a[2], b[0], b[1], b[2]);
    mesh.castShadow = true;
    return mesh;
  }

  _placeCapsule(mesh, x0, y0, z0, x1, y1, z1) {
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const d = _dir;
    d.set(x1 - x0, y1 - y0, z1 - z0).normalize();
    mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, d);
  }

  _buildObstacles() {
    const c = this.course, scene = this.scene;
    const pegMat = new THREE.MeshStandardMaterial({ color: '#f2f5f8', roughness: 0.25, metalness: 0.6 });
    const hubMat = new THREE.MeshStandardMaterial({ color: '#40464f', roughness: 0.4, metalness: 0.7 });
    for (const cap of c.staticCapsules) {
      scene.add(this._capsuleMesh(cap.a, cap.b, cap.r, cap.deco === 'hub' ? hubMat : pegMat));
    }

    this.parts = createPartBuffer(c);
    evaluateObstacles(c, 0, this.parts);
    const mats = {
      spinner: new THREE.MeshStandardMaterial({ color: '#e5484d', roughness: 0.35, metalness: 0.4 }),
      bob: new THREE.MeshStandardMaterial({ color: '#30343a', roughness: 0.25, metalness: 0.85 }),
      rod: new THREE.MeshStandardMaterial({ color: '#b8c0c8', roughness: 0.3, metalness: 0.8 }),
      pusher: new THREE.MeshStandardMaterial({ color: '#f5a524', roughness: 0.35, metalness: 0.3 }),
      frame: new THREE.MeshStandardMaterial({ color: '#7c4dff', roughness: 0.5, metalness: 0.3 }),
    };
    this.partMeshes = [];
    for (const o of c.obstacles) {
      for (let k = 0; k < o.partCount; k++) {
        const q = this.parts[o.partStart + k];
        let mesh;
        if (q.shape === 1) {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(q.rad, 28, 18), mats.bob);
          mesh.castShadow = true;
        } else {
          const mat = o.kind === 'spinner' ? mats.spinner : o.kind === 'pusher' ? mats.pusher : mats.rod;
          mesh = this._capsuleMesh([q.x0, q.y0, q.z0], [q.x1, q.y1, q.z1], q.rad, mat);
        }
        scene.add(mesh);
        this.partMeshes.push(mesh);
      }
      if (o.kind === 'pendulum') {
        // A-frame gantry holding the pendulum
        const f = o.frame, span = f.hw + 0.8;
        const top = (s) => [o.pivot[0] + o.r[0] * s, o.pivot[1] + o.r[1] * s, o.pivot[2] + o.r[2] * s];
        const foot = (s) => [f.p[0] + o.r[0] * s, f.p[1] + o.r[1] * s - 0.5, f.p[2] + o.r[2] * s];
        scene.add(this._capsuleMesh(top(-span), top(span), 0.18, mats.frame));
        scene.add(this._capsuleMesh(top(-span), foot(-span), 0.18, mats.frame));
        scene.add(this._capsuleMesh(top(span), foot(span), 0.18, mats.frame));
      }
    }
  }

  _banner(text, bg, fg, checker) {
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 96;
    const g = cv.getContext('2d');
    if (checker) {
      const s = 24;
      for (let y = 0; y < 96; y += s) for (let x = 0; x < 512; x += s) {
        g.fillStyle = ((x + y) / s) % 2 ? '#111' : '#fff';
        g.fillRect(x, y, s, s);
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(96, 14, 320, 68);
    } else {
      g.fillStyle = bg;
      g.fillRect(0, 0, 512, 96);
    }
    g.fillStyle = fg;
    g.font = 'bold 60px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 50);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  _arch(j, text, tex) {
    const c = this.course, scene = this.scene;
    const p = new THREE.Vector3(c.P[j * 3], c.P[j * 3 + 1], c.P[j * 3 + 2]);
    const r = new THREE.Vector3(c.RV[j * 3], c.RV[j * 3 + 1], c.RV[j * 3 + 2]);
    const t = new THREE.Vector3(c.T[j * 3], c.T[j * 3 + 1], c.T[j * 3 + 2]);
    const hw = c.HW[j] + 0.5, h = 5;
    const postMat = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const a = p.clone().addScaledVector(r, hw * s);
      scene.add(this._capsuleMesh([a.x, a.y - 0.5, a.z], [a.x, a.y + h, a.z], 0.22, postMat));
    }
    // two single-sided planes back to back so the text reads correctly from both sides
    const geo = new THREE.PlaneGeometry(hw * 2, hw * 2 * (96 / 512));
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const flat = new THREE.Vector3(t.x, 0, t.z).normalize();
    for (const side of [-1, 1]) {
      const banner = new THREE.Mesh(geo, mat);
      banner.position.copy(p).addScaledVector(new THREE.Vector3(0, 1, 0), h - 0.3).addScaledVector(flat, side * 0.02);
      banner.lookAt(banner.position.clone().addScaledVector(flat, side));
      banner.castShadow = true;
      scene.add(banner);
    }
  }

  _buildLandmarks() {
    const c = this.course;
    this._arch(c.spawn.j1 + 6, 'START', this._banner('START', '#1e6fd9', '#fff'));
    this._arch(c.finishIndex, 'FINISH', this._banner('FINISH', '#000', '#fff', true));

    // chequered strip on the floor at the finish line
    const j = c.finishIndex;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 32;
    const g = cv.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const hw = c.HW[j] - 0.45;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hw * 2 / 8), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const u = new THREE.Vector3(c.U[j * 3], c.U[j * 3 + 1], c.U[j * 3 + 2]);
    const t = new THREE.Vector3(c.T[j * 3], c.T[j * 3 + 1], c.T[j * 3 + 2]);
    const r = new THREE.Vector3(c.RV[j * 3], c.RV[j * 3 + 1], c.RV[j * 3 + 2]);
    strip.position.set(c.P[j * 3], c.P[j * 3 + 1], c.P[j * 3 + 2]).addScaledVector(u, 0.02);
    strip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, t.clone().negate(), u));
    strip.receiveShadow = true;
    this.scene.add(strip);
  }

  // ---------------------------------------------------------------- marbles
  _marbleTexture(i) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const g = cv.getContext('2d');
    const base = marbleColor(i);
    const light = base.clone().offsetHSL(0.08, 0.05, 0.25);
    const dark = base.clone().offsetHSL(-0.03, 0, -0.18);
    g.fillStyle = '#' + base.getHexString();
    g.fillRect(0, 0, 256, 128);
    // swirl bands so rolling is visible
    const band = (color, phase, amp, width) => {
      g.strokeStyle = '#' + color.getHexString();
      g.lineWidth = width;
      g.beginPath();
      for (let x = 0; x <= 256; x += 4) {
        const y = 64 + Math.sin((x / 256) * Math.PI * 4 + phase) * amp;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    band(light, i, 26, 14);
    band(dark, i + 2, 34, 7);
    band(new THREE.Color('#ffffff'), i + 4, 18, 4);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** (Re)create marble meshes + labels for a race. */
  setRace(race) {
    for (const m of this.marbles) {
      this.scene.remove(m);
      m.material.map.dispose();
      m.material.dispose();
    }
    this.labelLayer.innerHTML = '';
    this.marbles = [];
    this.labels = [];
    this.race = race;
    const geo = (this._marbleGeo ||= new THREE.SphereGeometry(MARBLE_R, 32, 20));
    for (let i = 0; i < race.n; i++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: this._marbleTexture(i), roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.position.set(race.pos[i * 3], race.pos[i * 3 + 1], race.pos[i * 3 + 2]);
      mesh.quaternion.setFromEuler(new THREE.Euler(i * 1.3, i * 0.7, i * 2.1));
      this.scene.add(mesh);
      this.marbles.push(mesh);

      const el = document.createElement('button');
      el.className = 'label';
      el.type = 'button';
      el.innerHTML = `<span class="dot" style="background:${marbleCss(i)}"></span>`;
      el.append(document.createTextNode(race.names[i]));
      el.addEventListener('click', () => this.onLabelClick?.(i));
      this.labelLayer.appendChild(el);
      this.labels.push(el);
    }
    this.lastPos = new Float32Array(race.n * 3);
    for (let i = 0; i < race.n * 3; i++) this.lastPos[i] = race.pos[i];
  }

  /** Point the camera at the start area (used before the race begins). */
  overview() {
    this.rig.overview(this.course);
  }

  render(alpha, dt) {
    const race = this.race;
    const c = this.course;
    const v = this._tmp;
    const axis = this._tmp2;

    // obstacles at the interpolated time
    const t = Math.max(0, (race.stepCount - 1 + alpha) * DT);
    evaluateObstacles(c, race.stepCount === 0 ? 0 : t, this.parts);
    for (let k = 0; k < this.parts.length; k++) {
      const q = this.parts[k], mesh = this.partMeshes[k];
      if (q.shape === 1) mesh.position.set(q.x0, q.y0, q.z0);
      else this._placeCapsule(mesh, q.x0, q.y0, q.z0, q.x1, q.y1, q.z1);
    }

    // marbles: interpolate, roll
    const a = race.stepCount === 0 ? 1 : alpha;
    for (let i = 0; i < race.n; i++) {
      const o = i * 3;
      let x = race.prev[o] + (race.pos[o] - race.prev[o]) * a;
      let y = race.prev[o + 1] + (race.pos[o + 1] - race.prev[o + 1]) * a;
      let z = race.prev[o + 2] + (race.pos[o + 2] - race.prev[o + 2]) * a;
      const mesh = this.marbles[i];
      const dx = x - this.lastPos[o], dy = y - this.lastPos[o + 1], dz = z - this.lastPos[o + 2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 1e-5 && dist < 3) {
        // roll about (up x motion); good enough visually even on slopes
        axis.set(dz, 0, -dx).normalize();
        if (axis.lengthSq() > 0) {
          mesh.quaternion.premultiply(_q.setFromAxisAngle(axis, dist / MARBLE_R));
        }
      }
      mesh.position.set(x, y, z);
      this.lastPos[o] = x; this.lastPos[o + 1] = y; this.lastPos[o + 2] = z;
    }

    // camera
    const fm = this.marbles[this.focus];
    if (fm) this.rig.update(dt, fm.position, race.sampleIdx[this.focus]);

    // keep the shadow camera around what we are looking at
    const tgt = this.rig.target;
    this.sun.position.set(tgt.x + 30, tgt.y + 60, tgt.z + 20);
    this.sun.target.position.copy(tgt);
    this.sky.position.copy(this.camera.position);

    this.renderer.render(this.scene, this.camera);
    this._updateLabels();
  }

  _updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const cam = this.camera;
    const v = this._tmp;
    const small = isSmallScreen();
    const maxD = small ? 45 : 65;
    for (let i = 0; i < this.labels.length; i++) {
      const el = this.labels[i];
      const m = this.marbles[i];
      const d = cam.position.distanceTo(m.position);
      const focused = i === this.focus;
      v.copy(m.position);
      v.y += MARBLE_R + 0.35;
      v.project(cam);
      if (v.z > 1 || v.z < -1 || (!focused && d > maxD) || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      if (el.style.display === 'none') el.style.display = '';
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = focused ? '1' : String(Math.max(0.35, Math.min(1, 1.3 - d / maxD)));
      el.style.zIndex = focused ? '1000' : String(900 - Math.round(d));
      el.classList.toggle('focus', focused);
    }
  }
}
