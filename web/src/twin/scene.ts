// Viewer 3D digital twin koridor jalan (PRD 7, 9.6) memakai Three.js.
// Sumbu: X = STA − STA tengah (m), Z = offset (m, kanan +), Y = elevasi relatif muka tanah asli × eksagerasi.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type Mode = 'penurunan' | 'U' | 'pori' | 'lateral' | 'alarm' | 'kesehatan';

export interface TwinZone {
  id: number; code: string; sta_start: number; sta_end: number; crest_width: number; slope_h: number;
  design_fill_height: number; surcharge_height: number; decision: string; fill: number[];
  layers: { name: string; top: number; bottom: number; cu: number | null }[];
}
export interface TwinInst {
  id: number; code: string; type: string; zone_id: number | null; sta: number; offset: number; tip_depth: number | null;
  unit: string; mode: string; centre: boolean; alarm: string | null; stale: boolean; u_hydro: number | null;
  health: { battery: number | null; rssi: number | null; last_seen: number | null } | null;
  values: (number | null)[]; projection: string | null;
}
export interface TwinData { now: number; days: number[]; nowIndex: number; zones: TwinZone[]; instruments: TwinInst[] }

export const RAMPS: Record<string, string[]> = {
  penurunan: ['#2a3640', '#24596b', '#3a93a8', '#8fcfc0', '#e6dd9c', '#e8772e'],
  U: ['#d04a3f', '#e07b2e', '#d9b23a', '#a3b24a', '#3fa66b'],
  pori: ['#2a3640', '#5b5a3c', '#b8962e', '#e07b2e', '#d04a3f'],
  lateral: ['#2a3640', '#5b5a3c', '#b8962e', '#e07b2e', '#d04a3f'],
};

const tmpC = new THREE.Color();
export function rampColor(ramp: string[], f: number, out = new THREE.Color()): THREE.Color {
  const x = Math.min(1, Math.max(0, f)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  out.set(ramp[i]);
  return out.lerp(tmpC.set(ramp[i + 1]), x - i);
}

const LAYER_COLORS = ['#7d6a4b', '#4b5a52', '#5c6a5e', '#8f8a6e', '#6d6252'];
const DECISION_HEX: Record<string, string> = { 'Lanjut timbun': '#3fa66b', Tahan: '#d9b23a', 'Siap bongkar surcharge': '#4fb3c8', 'Perlu tinjauan': '#d04a3f' };
const LEVEL_HEX: Record<string, string> = { Waspada: '#d9b23a', Siaga: '#e07b2e', Bahaya: '#d04a3f' };

/** Faktor penurunan melintang (sama dengan model server). */
export function offsetFactor(offset: number, z: Pick<TwinZone, 'crest_width' | 'slope_h' | 'design_fill_height' | 'surcharge_height'>): number {
  const half = z.crest_width / 2;
  const toe = half + z.slope_h * (z.design_fill_height + z.surcharge_height);
  const x = Math.abs(offset);
  if (x <= half) return 1 - 0.15 * (x / half) ** 2;
  if (x <= toe) return 0.85 * (1 - (x - half) / (toe - half)) + 0.08 * ((x - half) / (toe - half));
  return Math.max(-0.03, 0.08 - (x - toe) * 0.02);
}

export interface Field { values: Float32Array; conf: Float32Array; min: number; max: number }

export class TwinScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  data!: TwinData;
  staMid = 24500;
  exag = 3;
  mode: Mode = 'penurunan';
  tIndex = 0;
  /** Kode instrumen yang disuapi probe live: markernya diberi pendar tetap. */
  liveCode: string | null = null;
  private xs: number[] = [];
  private zs: number[] = [];
  private base!: THREE.Mesh;
  private fill!: THREE.Mesh;
  private edges: THREE.Line[] = [];
  private soil = new THREE.Group();
  private markers = new THREE.Group();
  private sectionPlane!: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private disposed = false;
  private flyAnim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number } | null = null;
  onPick?: (inst: TwinInst | null) => void;
  onHover?: (inst: TwinInst | null, x: number, y: number) => void;
  field: Field | null = null;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 1, 6000);
    this.camera.position.set(-260, 430, -760);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -10, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.scene.add(new THREE.HemisphereLight(0xdfe8ee, 0x2a2f33, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(-300, 600, -200);
    this.scene.add(sun);
    this.scene.add(this.soil, this.markers);

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('click', this.onClick);
    new ResizeObserver(() => this.resize()).observe(container);
    this.loop();
  }

  dispose() {
    this.disposed = true;
    this.renderer.domElement.removeEventListener('pointermove', this.onMove);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    if (this.flyAnim) {
      const k = Math.min(1, (performance.now() - this.flyAnim.t0) / 900);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.camera.position.lerpVectors(this.flyAnim.from, this.flyAnim.to, e);
      this.controls.target.lerpVectors(this.flyAnim.tFrom, this.flyAnim.tTo, e);
      if (k >= 1) this.flyAnim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  xOf(sta: number) { return sta - this.staMid; }

  zoneAt(sta: number): TwinZone {
    const zs = this.data.zones;
    return zs.find((z) => sta >= z.sta_start && sta < z.sta_end) ?? zs[zs.length - 1];
  }

  /** Tinggi timbunan pada STA (dihaluskan ±10 m di batas zona). */
  fillAt(sta: number, ti: number): number {
    const z = this.zoneAt(sta);
    const h = z.fill[ti] ?? 0;
    const zs = this.data.zones;
    const idx = zs.indexOf(z);
    const blend = 10;
    if (idx > 0 && sta - z.sta_start < blend) {
      const hp = zs[idx - 1].fill[ti] ?? 0;
      const f = 0.5 + (sta - z.sta_start) / (2 * blend);
      return hp + (h - hp) * f;
    }
    if (idx < zs.length - 1 && z.sta_end - sta < blend) {
      const hn = zs[idx + 1].fill[ti] ?? 0;
      const f = 0.5 + (z.sta_end - sta) / (2 * blend);
      return hn + (h - hn) * f;
    }
    return h;
  }

  setData(d: TwinData) {
    this.data = d;
    const s0 = Math.min(...d.zones.map((z) => z.sta_start));
    const s1 = Math.max(...d.zones.map((z) => z.sta_end));
    this.staMid = (s0 + s1) / 2;
    this.xs = [];
    for (let s = s0; s <= s1 + 0.1; s += 5) this.xs.push(s);
    this.zs = [];
    for (let z = -60; z <= 60.1; z += 2) this.zs.push(z);
    this.buildSoil();
    this.buildBase();
    this.buildFill();
    this.buildMarkers();
    this.tIndex = d.nowIndex;
    this.update();
  }

  private buildSoil() {
    this.soil.clear();
    const z0 = this.data.zones[0];
    const L = this.xs[this.xs.length - 1] - this.xs[0] + 40;
    z0.layers.forEach((l, i) => {
      const depth = Math.min(l.bottom, 24) - l.top;
      if (depth <= 0) return;
      const g = new THREE.BoxGeometry(L, depth * this.exag, 124);
      const m = new THREE.MeshStandardMaterial({ color: LAYER_COLORS[i % LAYER_COLORS.length], transparent: true, opacity: 0.3, roughness: 1, depthWrite: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(0, -(l.top + depth / 2) * this.exag - 0.05, 0);
      mesh.userData.layer = l;
      this.soil.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x0f1419, transparent: true, opacity: 0.5 }));
      edges.position.copy(mesh.position);
      this.soil.add(edges);
    });
    // grid milimeter samar di atas muka tanah asli di luar timbunan
    const grid = new THREE.GridHelper(1200, 60, 0x2b3540, 0x1f272f);
    grid.position.y = -0.2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.soil.add(grid);
  }

  private buildBase() {
    if (this.base) this.scene.remove(this.base);
    const nx = this.xs.length, nz = this.zs.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const idx: number[] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const k = i * nz + j;
      pos[k * 3] = this.xOf(this.xs[i]); pos[k * 3 + 1] = 0; pos[k * 3 + 2] = this.zs[j];
      if (i < nx - 1 && j < nz - 1) idx.push(k, k + 1, k + nz, k + 1, k + nz + 1, k + nz);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.base = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }));
    this.scene.add(this.base);
  }

  private buildFill() {
    if (this.fill) this.scene.remove(this.fill);
    const nx = this.xs.length;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nx * 4 * 3);
    const idx: number[] = [];
    for (let i = 0; i < nx - 1; i++) for (let s = 0; s < 3; s++) {
      const a = i * 4 + s, b = a + 1, c = a + 4, d = b + 4;
      idx.push(a, c, b, b, c, d);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    this.fill = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x9c8a66, transparent: true, opacity: 0.38, side: THREE.DoubleSide, roughness: 1, depthWrite: false, flatShading: true }));
    this.scene.add(this.fill);
    // garis kaki & puncak timbunan agar bentuk terbaca
    for (const l of this.edges) this.scene.remove(l);
    this.edges = [0, 1, 2, 3].map((j) => {
      const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(nx * 3), 3)),
        new THREE.LineBasicMaterial({ color: j === 1 || j === 2 ? 0xd9c9a3 : 0x8a7a5c, transparent: true, opacity: 0.9 }));
      this.scene.add(line);
      return line;
    });
  }

  private buildMarkers() {
    this.markers.clear();
    const geo: Record<string, THREE.BufferGeometry> = {
      settle: new THREE.OctahedronGeometry(2.2), pz: new THREE.SphereGeometry(1.8, 12, 8), gt: new THREE.ConeGeometry(1.8, 4, 8), env: new THREE.BoxGeometry(3, 3, 3),
    };
    for (const i of this.data.instruments) {
      let obj: THREE.Object3D;
      const mat = new THREE.MeshStandardMaterial({ color: 0xd7dde2, emissive: 0x000000, roughness: 0.5 });
      if (i.type === 'INC') {
        obj = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 20 * this.exag, 8), mat);
      } else if (i.type === 'SAA') {
        obj = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 45), mat);
      } else if (i.type === 'PZ') obj = new THREE.Mesh(geo.pz, mat);
      else if (i.type === 'GT') obj = new THREE.Mesh(geo.gt, mat);
      else if (i.type === 'RG' || i.type === 'BR') obj = new THREE.Mesh(geo.env, mat);
      else obj = new THREE.Mesh(geo.settle, mat);
      obj.userData.inst = i;
      this.markers.add(obj);
    }
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(130, 40 * this.exag), new THREE.MeshBasicMaterial({ color: 0xe8772e, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    plane.rotation.y = Math.PI / 2;
    plane.visible = false;
    this.sectionPlane = plane;
    this.scene.add(plane);
  }

  setExaggeration(e: number) {
    this.exag = e;
    this.buildSoil();
    this.buildMarkers();
    this.update();
  }

  setSection(sta: number | null) {
    if (!this.sectionPlane) return;
    this.sectionPlane.visible = sta != null;
    if (sta != null) this.sectionPlane.position.set(this.xOf(sta), 0, 0);
  }

  /** Nilai instrumen pada indeks waktu (null jika belum terpasang). */
  valueAt(i: TwinInst, ti: number): number | null {
    return i.values[ti] ?? null;
  }

  /**
   * Medan penurunan: interpolasi IDW sepanjang STA dari nilai as-ternormalisasi,
   * lalu dikalikan faktor melintang model. Tingkat keyakinan turun dengan jarak ke instrumen (F-DT-11).
   */
  computeField(ti: number, mode: Mode): Field {
    const nx = this.xs.length, nz = this.zs.length;
    const values = new Float32Array(nx * nz);
    const conf = new Float32Array(nx * nz);
    const src: { sta: number; v: number }[] = [];
    if (mode === 'pori') {
      for (const i of this.data.instruments) {
        if (i.type !== 'PZ' || Math.abs(i.offset) > 6) continue;
        const v = this.valueAt(i, ti);
        if (v != null) src.push({ sta: i.sta, v: v - (i.u_hydro ?? 0) });
      }
    } else {
      for (const i of this.data.instruments) {
        if (!['SC', 'GN'].includes(i.type)) continue;
        const v = this.valueAt(i, ti);
        if (v == null) continue;
        const z = this.zoneAt(i.sta);
        const f = offsetFactor(i.offset, z);
        let val = v / Math.max(0.3, f);
        if (mode === 'U') {
          const fin = i.values[i.values.length - 1];
          val = fin && fin > 20 ? Math.min(1, v / fin) : NaN;
        }
        if (Number.isFinite(val)) src.push({ sta: i.sta, v: val });
      }
    }
    let min = Infinity, max = -Infinity;
    for (let a = 0; a < nx; a++) {
      const s = this.xs[a];
      let wsum = 0, vsum = 0, dmin = Infinity;
      for (const p of src) {
        const d = Math.abs(p.sta - s);
        dmin = Math.min(dmin, d);
        const w = 1 / Math.pow(d + 8, 2);
        wsum += w; vsum += w * p.v;
      }
      const vc = wsum ? vsum / wsum : 0;
      const c = src.length ? Math.max(0.15, Math.min(1, 1 - (dmin - 25) / 100)) : 0;
      const z = this.zoneAt(s);
      for (let b = 0; b < nz; b++) {
        const k = a * nz + b;
        const f = mode === 'U' ? 1 : mode === 'pori' ? Math.max(0, offsetFactor(this.zs[b], z)) : offsetFactor(this.zs[b], z);
        const v = vc * f;
        values[k] = v;
        conf[k] = c * (Math.abs(this.zs[b]) > 30 ? 0.6 : 1);
        if (Math.abs(this.zs[b]) < 30) { min = Math.min(min, v); max = Math.max(max, v); }
      }
    }
    return { values, conf, min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1 };
  }

  legendRange(): [number, number] {
    if (this.mode === 'U') return [0, 1];
    if (this.mode === 'pori') return [0, Math.max(20, this.field?.max ?? 60)];
    if (this.mode === 'lateral') return [0, 200];
    return [0, Math.max(200, Math.ceil(((this.field?.max ?? 1000) + 1) / 250) * 250)];
  }

  update() {
    if (!this.data) return;
    const ti = this.tIndex;
    const isProj = ti > this.data.nowIndex;
    const nx = this.xs.length, nz = this.zs.length;
    // penurunan selalu dihitung untuk geometri
    const settle = this.computeField(ti, 'penurunan');
    const colorField = this.mode === 'penurunan' || this.mode === 'U' || this.mode === 'pori' ? (this.mode === 'penurunan' ? settle : this.computeField(ti, this.mode)) : null;
    this.field = colorField ?? settle;
    const [lo, hi] = this.legendRange();
    const pos = this.base.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.base.geometry.getAttribute('color') as THREE.BufferAttribute;
    const neutral = new THREE.Color(0x3a444e);
    const c = new THREE.Color();
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      const k = a * nz + b;
      pos.setY(k, (-settle.values[k] / 1000) * this.exag + 0.05);
      if (colorField) {
        const ramp = RAMPS[this.mode];
        rampColor(ramp, (colorField.values[k] - lo) / (hi - lo), c);
        // keyakinan rendah → dicampur ke abu netral; proyeksi → sedikit lebih pucat
        c.lerp(neutral, (1 - colorField.conf[k]) * 0.75 + (isProj ? 0.15 : 0));
      } else if (this.mode === 'alarm') {
        c.set(DECISION_HEX[this.zoneAt(this.xs[a]).decision] ?? '#666').lerp(neutral, Math.abs(this.zs[b]) > 30 ? 0.7 : 0.35);
      } else c.copy(neutral);
      col.setXYZ(k, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.base.geometry.computeVertexNormals();

    // badan timbunan
    const fp = this.fill.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let a = 0; a < nx; a++) {
      const s = this.xs[a];
      const z = this.zoneAt(s);
      const H = this.fillAt(s, ti);
      const half = z.crest_width / 2;
      const toe = half + z.slope_h * H;
      const sc = settle.values[a * nz + Math.floor(nz / 2)] / 1000;
      const zone = z;
      const pts: [number, number][] = [[-toe, 0], [-half, H], [half, H], [toe, 0]];
      pts.forEach(([off, h], j) => {
        const sOff = sc * offsetFactor(off, zone);
        fp.setXYZ(a * 4 + j, this.xOf(s), (h - sOff) * this.exag + 0.06, off);
      });
    }
    fp.needsUpdate = true;
    this.fill.geometry.computeVertexNormals();
    this.edges.forEach((line, j) => {
      const lp = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let a = 0; a < nx; a++) lp.setXYZ(a, fp.getX(a * 4 + j), fp.getY(a * 4 + j) + 0.05, fp.getZ(a * 4 + j));
      lp.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    });
    (this.fill.material as THREE.MeshStandardMaterial).opacity = this.mode === 'pori' || this.mode === 'lateral' ? 0.18 : 0.38;

    // marker instrumen
    for (const m of this.markers.children as THREE.Mesh[]) {
      const i: TwinInst = m.userData.inst;
      const v = this.valueAt(i, ti);
      const x = this.xOf(i.sta);
      const sLoc = (settle.values[Math.round((i.sta - this.xs[0]) / 5) * nz + Math.round((Math.max(-60, Math.min(60, i.offset)) + 60) / 2)] ?? 0) / 1000;
      const mat = m.material as THREE.MeshStandardMaterial;
      m.visible = i.type === 'RG' || i.type === 'BR' || v != null || ti >= this.data.nowIndex;
      switch (i.type) {
        case 'SC': case 'GN': case 'SP': m.position.set(x, (-(v ?? 0) / 1000) * this.exag + 2.5, i.offset); break;
        case 'PZ': m.position.set(x, -(i.tip_depth ?? 9) * this.exag, i.offset); break;
        case 'INC': m.position.set(x, -10 * this.exag, i.offset); break;
        case 'SAA': m.position.set(x, -sLoc * this.exag + 0.6, 0); break;
        case 'GT': m.position.set(x, 2, i.offset); break;
        default: m.position.set(x, 1.5, i.offset);
      }
      let color = '#d7dde2';
      const [lo2, hi2] = this.legendRange();
      if (this.mode === 'penurunan' && ['SC', 'GN', 'SP', 'SAA'].includes(i.type) && v != null) color = '#' + rampColor(RAMPS.penurunan, (v - lo2) / (hi2 - lo2)).getHexString();
      else if (this.mode === 'U' && ['SC', 'GN'].includes(i.type) && v != null) { const fin = i.values[i.values.length - 1]; if (fin) color = '#' + rampColor(RAMPS.U, v / fin).getHexString(); }
      else if (this.mode === 'pori' && i.type === 'PZ' && v != null) color = '#' + rampColor(RAMPS.pori, (v - (i.u_hydro ?? 0) - lo2) / (hi2 - lo2)).getHexString();
      else if (this.mode === 'lateral' && (i.type === 'INC' || i.type === 'GT') && v != null) color = '#' + rampColor(RAMPS.lateral, v / (i.type === 'GT' ? 80 : 200)).getHexString();
      else if (this.mode === 'alarm') color = i.alarm ? LEVEL_HEX[i.alarm] : '#3fa66b';
      else if (this.mode === 'kesehatan') {
        const b = i.health?.battery;
        color = i.stale ? '#5f6b77' : b != null && b < 20 ? '#d04a3f' : b != null && b < 40 ? '#d9b23a' : i.mode === 'manual' ? '#8a96a3' : '#3fa66b';
      } else color = '#8a96a3';
      mat.color.set(color);
      // proyeksi: marker dibuat lebih transparan (terukur vs prediksi dibedakan, PRD 7.1)
      mat.transparent = isProj;
      mat.opacity = isProj ? 0.45 : 1;
      mat.emissive.set(m.userData.selected ? 0x663311 : i.code === this.liveCode ? 0x1f4a52 : 0x000000);
    }
  }

  select(id: number | null) {
    for (const m of this.markers.children) m.userData.selected = m.userData.inst.id === id;
    this.update();
  }

  flyToSta(sta: number, dist = 160) {
    const x = this.xOf(sta);
    this.flyAnim = {
      from: this.camera.position.clone(), tFrom: this.controls.target.clone(),
      to: new THREE.Vector3(x - dist * 0.55, dist * 0.7, -dist * 1.1), tTo: new THREE.Vector3(x, -5, 0), t0: performance.now(),
    };
  }

  resetView() {
    this.flyAnim = { from: this.camera.position.clone(), tFrom: this.controls.target.clone(), to: new THREE.Vector3(-260, 430, -760), tTo: new THREE.Vector3(0, -10, 0), t0: performance.now() };
  }

  private pick(ev: PointerEvent | MouseEvent): TwinInst | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.markers.children.filter((m) => m.visible), false)[0];
    return hit ? hit.object.userData.inst : null;
  }
  private onMove = (ev: PointerEvent) => {
    const i = this.pick(ev);
    this.renderer.domElement.style.cursor = i ? 'pointer' : '';
    this.onHover?.(i, ev.offsetX, ev.offsetY);
  };
  private onClick = (ev: MouseEvent) => { this.onPick?.(this.pick(ev)); };
}
