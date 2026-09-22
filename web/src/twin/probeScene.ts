// Penampil 3D probe inclinometer live (port dari penampil bawaan alat).
// Satuan mm. Sumbu three.js: X = sumbu A, Y = ke atas, Z = sumbu B.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface ProbeSegment {
  X: number; Y: number; T: number; azim: number;
  /** pergeseran segmen per bidang dan resultannya, mm */
  dA: number; dB: number; defl: number;
  /** pergeseran kumulatif dari pangkal probe, mm */
  cumA: number; cumB: number; cum: number; arah: number;
  /** pergeseran terhadap acuan nol, mm */
  defA: number; defB: number; def: number;
}

export const SEG_COLORS = ['#e8772e', '#4fb3c8', '#c792d9'];
export const SEG_NAMES = ['bawah', 'tengah', 'atas'];
export type ProbeView = 'depan' | 'samping' | 'atas';

const RAD = Math.PI / 180;
const AXIS_A = 0xd04a3f;
const AXIS_B = 0x6f9fe0;

export class ProbeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private tubes: THREE.Mesh[] = [];
  private joints: THREE.Mesh[] = [];
  private refLine!: THREE.Line;
  private trace!: THREE.Line;
  private observer: ResizeObserver;
  private disposed = false;
  private seg: ProbeSegment[] = [];

  /** Pembesaran simpangan mendatar. Tanpa ini layar hanya menampilkan garis lurus. */
  exag = 100;
  showRef = true;
  /** Ujung mana yang dianggap diam: lubang bor = bawah, probe digantung = atas. */
  anchor: 'bawah' | 'atas' = 'bawah';
  flipA = false;
  flipB = false;

  constructor(private container: HTMLElement, private gauge = 500, private count = 3) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(38, 1, 10, 20000);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(1, 1.4, 0.8);
    this.scene.add(key);

    // Ke mana probe akan menunjuk kalau lubangnya lurus.
    const refGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, gauge * count, 0)]);
    this.refLine = new THREE.Line(refGeom, new THREE.LineDashedMaterial({ color: 0x5f6b77, dashSize: 40, gapSize: 26 }));
    this.refLine.computeLineDistances();
    this.scene.add(this.refLine);

    for (let i = 0; i < count; i++) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(22, 22, gauge, 20),
        new THREE.MeshLambertMaterial({ color: SEG_COLORS[i % SEG_COLORS.length] }),
      );
      this.scene.add(tube);
      this.tubes.push(tube);
    }
    for (let i = 0; i <= count; i++) {
      const j = new THREE.Mesh(new THREE.SphereGeometry(30, 20, 14), new THREE.MeshLambertMaterial({ color: 0x6e7b79 }));
      this.scene.add(j);
      this.joints.push(j);
    }

    this.trace = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xe8772e }));
    this.scene.add(this.trace);

    // Penanda sumbu ukur di dasar: tanpa ini mustahil tahu apakah gambarnya
    // benar-benar terbalik atau kameranya saja yang sedang memutar.
    const p = gauge * 0.9;
    for (const [dir, color] of [[[1, 0, 0], AXIS_A], [[0, 0, 1], AXIS_B]] as [number[], number][]) {
      const v = new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(p);
      this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), v]), new THREE.LineBasicMaterial({ color })));
      const head = new THREE.Mesh(new THREE.ConeGeometry(26, 70, 16), new THREE.MeshLambertMaterial({ color }));
      head.position.copy(v);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      this.scene.add(head);
    }
    this.scene.add(new THREE.GridHelper(gauge * 2, 8, 0x3a4644, 0x2a3432));

    this.setView('depan');
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.loop();
  }

  setSegments(seg: ProbeSegment[]) {
    this.seg = seg;
    this.build();
  }

  setView(v: ProbeView) {
    const d = this.gauge * this.count * 1.75;
    const cy = (this.gauge * this.count) / 2;
    const pos: Record<ProbeView, [number, number, number]> = {
      depan: [0, cy, d],            // melihat sepanjang sumbu B
      samping: [d, cy, 0],          // melihat sepanjang sumbu A
      atas: [0, cy + d, 1],
    };
    this.camera.position.set(...pos[v]);
    this.controls.target.set(0, cy, 0);
    this.controls.update();
  }

  build() {
    if (!this.seg.length) return;
    const sA = this.flipA ? -1 : 1;
    const sB = this.flipB ? -1 : 1;

    // Geometri dibangun dari sudut relatif terhadap acuan pemasangan, bukan dari
    // percepatan mentah: yang dicari inclinometer adalah perubahan sejak dipasang.
    const pts = [new THREE.Vector3(0, 0, 0)];
    for (let i = 0; i < this.tubes.length; i++) {
      const s = this.seg[i];
      if (!s) break;
      const th = s.T * RAD, az = s.azim * RAD;
      const ux = Math.sin(th) * Math.cos(az) * sA;
      const uy = Math.sin(th) * Math.sin(az) * sB;
      const uz = Math.cos(th);
      pts.push(pts[i].clone().add(new THREE.Vector3(-ux, uz, -uy).multiplyScalar(this.gauge)));
    }

    // Simpangan mendatar dikalikan, ketinggian dibiarkan apa adanya — persis cara
    // profil defleksi digambar di perangkat lunak inclinometer.
    let show = pts.map((p) => new THREE.Vector3(p.x * this.exag, p.y, p.z * this.exag));
    if (this.anchor === 'atas') {
      const top = show[show.length - 1].clone();
      const topY = pts[pts.length - 1].y;
      show = show.map((p) => new THREE.Vector3(p.x - top.x, p.y - top.y + topY, p.z - top.z));
    }

    for (let i = 0; i < this.tubes.length; i++) {
      const a = show[i], b = show[i + 1];
      const tube = this.tubes[i];
      tube.visible = !!b;
      if (!b) continue;
      const dir = b.clone().sub(a);
      tube.position.copy(a.clone().add(b).multiplyScalar(0.5));
      tube.scale.set(1, dir.length() / this.gauge, 1);
      tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    }
    this.joints.forEach((j, i) => {
      j.visible = !!show[i];
      if (show[i]) j.position.copy(show[i]);
    });

    this.trace.geometry.dispose();
    this.trace.geometry = new THREE.BufferGeometry().setFromPoints(show);
    this.refLine.visible = this.showRef;
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
