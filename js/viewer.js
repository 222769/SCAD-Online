// three.js viewer tuned for touch: one finger orbits, two fingers pinch/pan.
// OpenSCAD is Z-up, so the camera uses Z as "up" too.
import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    // Cap pixel ratio: iPhone 16 is 3x, which quadruples fill cost for little gain.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(80, -120, 90);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1, -1.5, 2);
    this.camera.add(key); // light follows the camera so the model never goes dark
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-1.5, 1, -0.5);
    this.camera.add(fill);
    this.scene.add(this.camera);

    this.grid = new THREE.GridHelper(200, 20);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(20);
    this.scene.add(this.axes);

    this.material = new THREE.MeshStandardMaterial({
      color: 0xf2b134, metalness: 0.05, roughness: 0.55, flatShading: true, side: THREE.DoubleSide,
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.35 });
    this.mesh = null;
    this.edges = null;
    this.showEdges = false;

    this.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.loop();
  }

  applyTheme() {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    const c = dark ? [0x3a4252, 0x2a303c] : [0xb8bec8, 0xdde1e7];
    this.grid.material.dispose();
    this.scene.remove(this.grid);
    this.grid = new THREE.GridHelper(this.gridSize || 200, 20, c[0], c[1]);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.requestRender();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() { this.dirty = true; }

  loop() {
    requestAnimationFrame(() => this.loop());
    // controls.update() returns true while damping is still moving the camera.
    if (this.controls.update() || this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Load a binary STL (ArrayBuffer). Returns { triangles, size }. */
  loadSTL(buffer, { keepCamera = false } = {}) {
    const geometry = parseBinarySTL(buffer);
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edges.geometry.dispose();
      this.edges = null;
    }
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.scene.add(this.mesh);
    if (this.showEdges) this.buildEdges();

    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);
    this.gridSize = Math.pow(10, Math.ceil(Math.log10(radius * 2)));
    this.applyTheme();
    this.axes.scale.setScalar(radius / 20);

    if (!keepCamera) this.fit();
    this.requestRender();
    return { triangles: geometry.attributes.position.count / 3, size };
  }

  clear() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.edges) { this.scene.remove(this.edges); this.edges.geometry.dispose(); this.edges = null; }
    this.requestRender();
  }

  buildEdges() {
    if (!this.mesh) return;
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.mesh.geometry, 20), this.edgeMaterial);
    this.scene.add(this.edges);
  }

  setEdges(on) {
    this.showEdges = on;
    if (on && !this.edges) this.buildEdges();
    if (!on && this.edges) { this.scene.remove(this.edges); this.edges.geometry.dispose(); this.edges = null; }
    this.requestRender();
  }

  /** view: 'iso' | 'top' | 'front' | 'right' */
  fit(view = 'iso') {
    const box = this.mesh ? this.mesh.geometry.boundingBox : new THREE.Box3(new THREE.Vector3(-10, -10, 0), new THREE.Vector3(10, 10, 10));
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitFov = this.camera.aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect) : fov;
    const dist = (r / Math.sin(fitFov / 2)) * 1.08;
    const dirs = {
      iso: new THREE.Vector3(1, -1.4, 1),
      top: new THREE.Vector3(0, -0.0001, 1),
      front: new THREE.Vector3(0, -1, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    const dir = (dirs[view] || dirs.iso).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function parseBinarySTL(buffer) {
  const dv = new DataView(buffer);
  const n = dv.getUint32(80, true);
  if (84 + n * 50 > buffer.byteLength) throw new Error('Truncated STL');
  const pos = new Float32Array(n * 9);
  const nrm = new Float32Array(n * 9);
  for (let i = 0, o = 84; i < n; i++, o += 50) {
    const nx = dv.getFloat32(o, true), ny = dv.getFloat32(o + 4, true), nz = dv.getFloat32(o + 8, true);
    for (let v = 0; v < 3; v++) {
      const b = o + 12 + v * 12, k = i * 9 + v * 3;
      pos[k] = dv.getFloat32(b, true);
      pos[k + 1] = dv.getFloat32(b + 4, true);
      pos[k + 2] = dv.getFloat32(b + 8, true);
      nrm[k] = nx; nrm[k + 1] = ny; nrm[k + 2] = nz;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}
