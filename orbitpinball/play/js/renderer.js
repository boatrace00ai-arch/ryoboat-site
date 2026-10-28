// Port of PinballTableRenderer.swift + TableLightingEffects.swift using three.js (WebGL).
import * as THREE from '../vendor/three.module.min.js';
import * as C from './craft.js';
import { TableLayout, V, kindOf, indexOf, E } from './core/geometry.js';

const PITCH = Math.PI * 35 / 180;
const loader = new THREE.TextureLoader();
function texture(url) {
  const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

class Bulb {
  constructor(mesh, mat, color) { this.mesh = mesh; this.mat = mat; this.color = new THREE.Color(color); this.dim = this.color.clone().multiplyScalar(0.17); this.state = null; }
  set(on, strength = 1) {
    const key = on ? strength : -1;
    if (this.state === key) return; this.state = key;
    this.mat.color.copy(on ? this.color : this.dim);
    this.mat.emissive.copy(this.color);
    this.mat.emissiveIntensity = on ? 1.65 * strength : 0.015;
  }
}

/** Lightweight tween runner for flashes and pop-ups. */
class Tweens {
  constructor() { this.list = []; }
  add(duration, update, done) { this.list.push({ t: 0, duration, update, done }); }
  step(dt) {
    this.list = this.list.filter((tw) => {
      tw.t += dt; const k = Math.min(1, tw.t / tw.duration);
      tw.update(k);
      if (k >= 1) { tw.done?.(); return false; }
      return true;
    });
  }
}

export class TableRenderer {
  constructor(canvas, { lowPower = false } = {}) {
    this.canvas = canvas;
    this.lowPower = lowPower;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060912);
    this.table = new THREE.Group();
    this.table.scale.y = 1 / Math.cos(PITCH);
    this.scene.add(this.table);
    this.effects = new THREE.Group(); this.table.add(this.effects);
    this.tweens = new Tweens();
    this.lamps = new Map(); this.ranks = []; this.progress = []; this.hyperspaceLamps = []; this.kickbackLamps = {};
    this.bumperNodes = new Map(); this.bumperLenses = new Map(); this.spinners = {};
    this.contacts = new Map(); this.flows = new Map(); this.guidance = new Map();
    this.seenRank = -1;
    this.art = {
      playfield: texture('assets/art/playfield.jpg'), cabinetTrim: texture('assets/art/cabinet-trim.jpg'),
      hyperspace: texture('assets/art/hyperspace-panel.jpg'), ramp: texture('assets/art/launch-ramp.jpg'),
      bumperCap: texture('assets/art/bumper-cap.png'), flipperInlay: texture('assets/art/flipper-inlay.png'),
    };
    this.mat = {
      chrome: C.material(0xB6C2CB, { metal: 0.94, rough: 0.19 }), brushed: C.material(0x667483, { metal: 0.8, rough: 0.35 }),
      brass: C.material(0xAD8150, { metal: 0.78, rough: 0.28 }), rubber: C.material(0x9E242C, { rough: 0.7 }),
      darkRubber: C.material(0x161620, { rough: 0.85 }), porcelain: C.material(0xECE1C4, { rough: 0.22 }),
      black: C.material(0x060813, { rough: 0.43 }),
    };
    this.build();
  }

  build() {
    const s = this.scene;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2400);
    const target = new THREE.Vector3(200, 250 / Math.cos(PITCH), 0);
    camera.position.set(200, target.y - 1000 * Math.sin(PITCH), 1000 * Math.cos(PITCH));
    camera.up.set(0, 1, 0); camera.lookAt(target);
    this.camera = camera;
    s.add(new THREE.AmbientLight(0x8B9BBD, 0.9));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
    key.position.set(-180, 550, 650); key.target.position.set(200, 350, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(this.lowPower ? 1024 : 2048, this.lowPower ? 1024 : 2048);
    Object.assign(key.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 1, far: 1800 });
    key.shadow.bias = -0.0008; key.shadow.radius = 3;
    s.add(key); s.add(key.target);
    for (const [p, color, intensity] of [[[370, 520, 150], 0x98B5FF, 260], [[90, 420, 100], 0xB79BFF, 180]]) {
      const l = new THREE.PointLight(color, intensity * 60, 450, 1.2); l.position.set(...p); s.add(l);
    }
    this.impactLight = new THREE.PointLight(0x8CDFFF, 0, 48, 1.5); this.table.add(this.impactLight);
    // Studio-style environment for chrome reflections.
    const env = document.createElement('canvas'); env.width = 512; env.height = 256;
    const g = env.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#BAC8D2'); grad.addColorStop(0.42, '#4C5670'); grad.addColorStop(1, '#080B15');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(75, 25, 42, 92); g.fillRect(355, 37, 85, 15);
    g.fillStyle = '#ADBDE0'; g.fillRect(250, 20, 15, 75);
    const envTex = new THREE.CanvasTexture(env); envTex.mapping = THREE.EquirectangularReflectionMapping; envTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromEquirectangular(envTex).texture; s.environmentIntensity = 0.6;

    this.makeCabinet(); this.makeRails(); this.makeCentralReactor(); this.makeRamp(); this.makeSlings(); this.makeTargets();
    this.makeHolesAndLanes(); this.makeHyperspaceTunnel(); this.makePlunger(); this.makePassageLighting();
    this.centerPost = new THREE.Group(); this.centerPost.position.set(TableLayout.centerPost.x, TableLayout.centerPost.y, 0);
    this.centerPost.visible = false; this.table.add(this.centerPost);
    C.cylinder(TableLayout.centerPostRadius, 8, this.mat.rubber, [0, 0, 4], this.centerPost);
    C.ring(TableLayout.centerPostRadius, 0.7, this.mat.chrome, [0, 0, 8], this.centerPost);
    C.cylinder(3.5, 1, C.material(0x8BF3CE, { glow: 1 }), [0, 0, 8.5], this.centerPost);
    for (const b of TableLayout.bumpers) this.makeBumper(b);
    for (const b of TableLayout.bumpers) this.guide(b.event, b.center, b.radius + 4);
    for (const r of [...TableLayout.targetRails, ...TableLayout.rails]) if (r.event && r.event !== 'wall') this.guide(r.event, r.a.add(r.b).div(2), 5);
    for (const sn of TableLayout.sensors) this.guide(sn.event, sn.center, sn.radius + 3);
    this.leftFlipper = this.makeFlipper(false); this.rightFlipper = this.makeFlipper(true);
    for (const [f, pivot] of [[this.leftFlipper, TableLayout.leftPivot], [this.rightFlipper, TableLayout.rightPivot]]) {
      f.scale.x = TableLayout.flipperLength / 54.5; f.position.set(pivot.x, pivot.y, 3); this.table.add(f);
    }
    const ballMat = C.material(0xF2F8FF, { metal: 0.95, rough: 0.08 });
    ballMat.emissive = new THREE.Color(0x769DBB); ballMat.emissiveIntensity = 0.17;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(TableLayout.ballRadius, 36, 24), ballMat);
    this.ball.scale.y = Math.cos(PITCH); this.ball.castShadow = true; this.table.add(this.ball);
    this.table.traverse((o) => { if (o.isMesh && o !== this.ball && !o.material.transparent) { o.castShadow = o.position.z > 2 || o.geometry.type !== 'PlaneGeometry'; o.receiveShadow = true; } });
    this.floor.castShadow = false; this.floor.receiveShadow = true;
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    const aspect = width / height, cam = this.camera;
    cam.updateMatrixWorld(); this.table.updateMatrixWorld();
    let extent = 0;
    const p = new THREE.Vector3();
    for (const x of [12, 388]) for (const y of [10, 483]) for (const z of [-12, 22]) {
      p.set(x, y, z); this.table.localToWorld(p); p.applyMatrix4(cam.matrixWorldInverse);
      extent = Math.max(extent, Math.abs(p.y), Math.abs(p.x) / aspect);
    }
    extent *= 1.04;
    cam.left = -extent * aspect; cam.right = extent * aspect; cam.top = extent; cam.bottom = -extent;
    cam.updateProjectionMatrix();
  }

  // --- Construction (mirrors the Swift renderer) -----------------------------------------
  makeCabinet() {
    const outline = TableLayout.outline, t = this.table, m = this.mat;
    const wood = C.material(0x48272B, { rough: 0.43 });
    C.extrude(outline, 12, 2, wood, -13, t);
    const shape = C.shapeFrom(outline);
    const g = new THREE.ShapeGeometry(shape);
    const pos = g.attributes.position, uv = [];
    for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i) / TableLayout.width, pos.getY(i) / TableLayout.height);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.floor = C.node(g, new THREE.MeshLambertMaterial({ map: this.art.playfield }), [0, 0, 0.05], t);
    const steel = C.material(0x646B76, { metal: 0.8, rough: 0.3 });
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length], d = b.sub(a);
      const outward = V(-d.y, d.x).normalized, center = a.add(b).div(2).add(outward.mul(4.5));
      const rail = new THREE.Group(); rail.position.set(center.x, center.y, 0); rail.rotation.z = Math.atan2(d.y, d.x); t.add(rail);
      C.box(d.length + 7, 9, 12, steel, [0, 0, -1], rail);
      C.surface(this.art.cabinetTrim, d.length + 2, 8, [0, 0, 5.1], rail, d.length / 70, 1);
      for (const side of [-1, 1]) C.wire([[-d.length / 2, side * 4.1, 5.4], [d.length / 2, side * 4.1, 5.4]], 0.45, m.chrome, rail);
      const count = Math.max(1, Math.floor(d.length / 65));
      for (let n = 0; n <= count; n++) {
        const x = -d.length / 2 + n * d.length / count;
        C.cylinder(2, 0.5, m.darkRubber, [x, 0, 5.4], rail); this.screw(V(x, 0), 5.9, 1.3, rail);
      }
    }
    C.wire([...outline, outline[0]].map((p) => [p.x, p.y, 3]), 1.1, m.rubber, t);
    C.box(84, 18, 7, m.black, [201, 22, -1], t);
    C.decal(C.labelTexture('BALL RETURN', 180, 30, '#B39B76', 14), 43, 7, [201, 20, 3], t);
    for (const [x, y] of [[207, 817], [797, 817], [320, 118], [687, 118]]) this.screw(TableLayout.reference(x, y), 5, 1.8);
    for (const [x, y] of [[232, 790], [744, 790]]) {
      const p = TableLayout.reference(x, y);
      C.box(14, 28, 8, wood, [p.x, p.y, 4], t); C.box(8, 20, 1.4, m.brushed, [p.x, p.y, 8.5], t); this.screw(p.add(V(0, -9)), 9, 1);
    }
  }
  makeRails() {
    const m = this.mat, t = this.table;
    TableLayout.rails.forEach((rail, index) => {
      if (index < 4) return;
      if (rail.event && kindOf(rail.event) === 'sling') return;
      const a = [rail.a.x, rail.a.y, 6], b = [rail.b.x, rail.b.y, 6];
      C.wire([[a[0], a[1], 2], [b[0], b[1], 2]], 1.7, m.rubber, t);
      C.wire([a, b], 1.1, m.chrome, t);
      const distance = rail.b.sub(rail.a).length, count = Math.max(1, Math.floor(distance / 52));
      for (let i = 0; i <= count; i++) {
        if (i === 0 && index % 2 === 0) continue;
        const p = rail.a.add(rail.b.sub(rail.a).mul(i / count));
        C.cylinder(2.2, 9, m.brushed, [p.x, p.y, 5], t); C.ring(2.2, 0.45, m.chrome, [p.x, p.y, 8.8], t);
      }
    });
    const island = TableLayout.launchIsland;
    C.extrude(island, 1.5, 0.6, C.material(0xB498D6, { rough: 0.65 }), 0.2, t);
    C.wire([...island, island[0]].map((p) => [p.x, p.y, 2.5]), 0.5, m.brass, t);
  }
  makeBumper(bumper) {
    const m = this.mat;
    const n = new THREE.Group(); n.position.set(bumper.center.x, bumper.center.y, 0); this.table.add(n);
    this.bumperNodes.set(bumper.event, n);
    const body = new THREE.Group(); n.add(body);
    const scale = bumper.radius / 18; body.scale.set(scale, scale * Math.cos(PITCH), scale);
    const r = 18;
    C.cylinder(r + 2, 3, m.black, [0, 0, 1.7], body);
    C.cylinder(r + 1, 3.3, m.chrome, [0, 0, 4.6], body);
    C.ring(r, 0.9, m.brass, [0, 0, 6.3], body);
    C.cylinder(r - 3, 7, m.porcelain, [0, 0, 10], body);
    C.ring(r - 2.1, 1, m.chrome, [0, 0, 12.5], body);
    C.cone(r - 2.8, r - 1.4, 3, m.porcelain, [0, 0, 15], body);
    C.ring(r - 3.1, 0.65, m.brass, [0, 0, 16.6], body);
    const lens = C.material(0x284FC3, { metal: 0.22, rough: 0.14, glow: 0.25 });
    this.bumperLenses.set(bumper.event, lens);
    C.cylinder(r * 0.46, 1.8, lens, [0, 0, 17.2], body);
    const dome = C.node(new THREE.SphereGeometry(r * 0.43, 24, 12), lens, [0, 0, 17.5], body); dome.scale.z = 0.3;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      C.cylinder(1.25, 1.7, C.material(i % 2 === 0 ? 0xC94425 : 0xC69B4D, { metal: 0.55, rough: 0.3 }), [Math.cos(a) * (r - 5), Math.sin(a) * (r - 5), 17.2], body, 10);
    }
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; this.screw(V(Math.cos(a) * (r + 0.4), Math.sin(a) * (r + 0.4)), 6.4, 0.8, body); }
    C.decal(this.art.bumperCap, 36, 36, [0, 0, 19], body);
    this.contact(bumper.event, bumper.center, bumper.radius + 0.8, 19.6 * scale, 0x73DFFF, Math.cos(PITCH));
  }
  makeCentralReactor() {
    const p = TableLayout.reactor, t = this.table;
    C.ring(35, 0.45, this.mat.brass, [p.x, p.y, 0.7], t);
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2 + Math.PI / 2; this.progress.push(this.makeLamp(p.add(V(Math.cos(a) * 50, Math.sin(a) * 50)), 2.5, 0x2580EB)); }
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + Math.PI / 2; this.ranks.push(this.makeLamp(p.add(V(Math.cos(a) * 29.5, Math.sin(a) * 29.5)), 2.3, 0xFFB52D)); }
    this.rankText = C.decal(C.labelTexture('01', 80, 40, '#E5C68C', 30), 9, 4.5, [p.x, p.y - 12, 0.4], t);
    this.saveLamp = this.makeLamp(TableLayout.reference(503, 788), 2.5, 0xE9CE47);
  }
  makeRamp() {
    const t = this.table, m = this.mat;
    const controls = TableLayout.rampControls.map((curve, index) => {
      const heights = index === 0 ? [2, 14, 19, 17] : [17, 16, 10, 5];
      return curve.map((p, i) => [p.x, p.y, heights[i]]);
    });
    const points = [];
    for (const [a, b, c, d] of controls) {
      for (let i = 0; i < 30; i++) {
        const k = i / 29, u = 1 - k;
        points.push([0, 1, 2].map((j) => a[j] * u * u * u + b[j] * 3 * u * u * k + c[j] * 3 * u * k * k + d[j] * k * k * k));
      }
    }
    const deck = this.art.ramp.clone(); deck.wrapT = THREE.RepeatWrapping; deck.repeat.set(1, 3); deck.needsUpdate = true;
    C.node(C.ribbon(points.map((p) => [p[0], p[1], p[2] - 1.7]), 21), C.material(0x342D54, { rough: 0.45 }), [0, 0, 0], t);
    C.node(C.ribbon(points, 20), new THREE.MeshLambertMaterial({ map: deck, side: THREE.DoubleSide }), [0, 0, 0], t);
    const left = [], right = [];
    points.forEach((p, i) => {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(i + 1, points.length - 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty); if (l < 0.001) return; tx /= l; ty /= l;
      const side = [-ty * 10, tx * 10];
      const L = [p[0] + side[0], p[1] + side[1], p[2] + 4], R = [p[0] - side[0], p[1] - side[1], p[2] + 4];
      left.push(L); right.push(R);
      if (i % 6 === 0) {
        C.wire([[L[0], L[1], p[2] - 1.4], [R[0], R[1], p[2] - 1.4]], 0.65, m.brushed, t);
        C.wire([[L[0], L[1], p[2]], [L[0], L[1], p[2] + 7]], 1, m.chrome, t);
        C.wire([[R[0], R[1], p[2]], [R[0], R[1], p[2] + 7]], 1, m.chrome, t);
      }
    });
    const acrylic = C.material(0xA17BC8, { metal: 0.08, rough: 0.18 }); acrylic.transparent = true; acrylic.opacity = 0.88;
    C.wire(left, 2.2, acrylic, t); C.wire(right, 2.2, acrylic, t);
    C.wire(left.map((p) => [p[0], p[1], p[2] + 3]), 0.65, m.chrome, t);
    C.wire(right.map((p) => [p[0], p[1], p[2] + 3]), 0.65, m.chrome, t);
    this.flow('ramp', left.map((p) => [p[0], p[1], p[2] + 3.8]), 0xC997FF);
    this.flow('ramp', right.map((p) => [p[0], p[1], p[2] + 3.8]), 0xC997FF);
    for (let i = 5; i < points.length - 5; i += 10) { const p = points[i]; C.cylinder(2.3, p[2], m.brushed, [p[0], p[1], p[2] / 2], t); }
    for (let i = 0; i < 3; i++) {
      const p = points[4 + i * 3];
      C.wire([[p[0] - 8, p[1], p[2] + 1.2], [p[0] + 8, p[1], p[2] + 1.2]], 1.6, C.material(0xE2C047, { metal: 0.3, rough: 0.3 }), t);
    }
  }
  makeSlings() {
    const t = this.table, m = this.mat;
    TableLayout.slings.forEach((points, index) => {
      this.outline(E('sling', index), [...points, points[0]].map((p) => [p.x, p.y, 12.5]), 0x80D9FF);
      C.extrude(points, 5, 1.3, m.black, 0.2, t);
      const top = C.extrude(points, 3, 1, C.material(0x501C36, { metal: 0.15, rough: 0.23 }), 7, t);
      top.material.transparent = true; top.material.opacity = 0.93;
      C.wire([...points, points[0]].map((p) => [p.x, p.y, 11.5]), 1.3, m.chrome, t);
      for (const p of points) { C.cylinder(2.3, 9, m.brass, [p.x, p.y, 5], t); this.screw(p, 12, 1.8); }
      const p = points[0];
      C.wire([[p.x, p.y - 9, 11], [p.x + 4, p.y - 18, 11], [p.x - 2, p.y - 17, 11], [p.x + 6, p.y - 31, 11]], 1.5, C.material(0x79B7F5, { rough: 0.22, glow: 0.9 }), t);
    });
  }
  makeTargets() {
    const t = this.table, m = this.mat;
    for (const rail of TableLayout.targetRails) {
      const p = rail.a.add(rail.b).div(2), d = rail.b.sub(rail.a);
      const n = new THREE.Group(); n.position.set(p.x, p.y, 0); n.rotation.z = Math.atan2(d.y, d.x); t.add(n);
      const isDrop = ['multiplier', 'medal', 'booster'].includes(kindOf(rail.event));
      const color = isDrop ? 0xF4D747 : 0xD64532;
      if (isDrop) {
        C.box(d.length + 2, 6, 2, m.brushed, [0, 0, 1.5], n);
        C.box(d.length, 3, 7, m.darkRubber, [0, 0, 5], n);
        C.box(d.length - 1, 2, 5, C.material(color, { rough: 0.35 }), [0, -1, 7], n);
        this.screw(V(-d.length / 2, 2), 3, 0.7, n);
      } else {
        C.cylinder(3.2, 2, m.chrome, [0, 0, 2], n);
        C.cylinder(2.3, 1.2, C.material(color, { rough: 0.28 }), [0, 0, 3.5], n);
      }
      if (rail.event) {
        this.lamps.set(rail.event, this.makeLamp(p.add(V(-3, -6)), 1.6, isDrop ? 0xE8D244 : 0xD65C35));
        this.contact(rail.event, p, 5, 8.5, 0xFFD681);
      }
    }
  }
  makeHolesAndLanes() {
    const t = this.table, m = this.mat;
    for (const sensor of TableLayout.sensors) {
      const kind = kindOf(sensor.event), i = indexOf(sensor.event), c = sensor.center;
      if (['wormhole', 'blackHole', 'hyperspace', 'spinner', 'reentry', 'launchLane', 'returnLane', 'outlane'].includes(kind)) {
        this.contact(sensor.event, c, sensor.radius + 0.5, 2.5, 0xC8A2FF);
      }
      switch (kind) {
        case 'hyperspace': this.makeHole(c, 8, 0x9C65ED); break;
        case 'blackHole': this.makeHole(c, 7, 0xC79962); break;
        case 'gravityWell': this.lamps.set(sensor.event, this.makeLamp(c, 2.8, 0xD13728)); break;
        case 'wormhole': {
          const color = [0xCA3944, 0x4EA65C, 0xC2A43A][i];
          this.makePort(c, color); this.lamps.set(sensor.event, this.makeLamp(c.add(V(0, 11)), 1.8, color)); break;
        }
        case 'spaceWarp':
          C.cylinder(5.6, 0.4, m.brass, [c.x, c.y, 0.8], t); C.cylinder(4.1, 0.5, C.material(0x548A39, { rough: 0.5 }), [c.x, c.y, 1.2], t); break;
        case 'reentry': this.lamps.set(sensor.event, this.makeLamp(c, 2, 0xD5D243)); break;
        case 'launchLane':
          this.lamps.set(sensor.event, this.makeLamp(c, 2, 0xD5D243));
          for (const dx of [-7.2, 7.2]) { C.cylinder(1.6, 5, m.chrome, [c.x + dx, c.y, 4], t); C.cylinder(1.6, 1.5, m.rubber, [c.x + dx, c.y, 7], t); }
          break;
        case 'fuel': this.lamps.set(sensor.event, this.makeLamp(c, 1.8, 0xD8CE39)); break;
        case 'returnLane': case 'outlane':
          C.box(3, 15, 1, m.chrome, [c.x, c.y, 1], t);
          if (kind === 'outlane') {
            this.lamps.set(sensor.event, this.makeLamp(c.add(V(0, 9)), 2, 0xFFBC70));
            // Kickback-ready lamp below each outlane, armed on every new ball.
            this.kickbackLamps[i] = this.makeLamp(c.add(V(0, -11)), 1.9, 0x5FD3FF);
          } else this.lamps.set(sensor.event, this.makeLamp(c.add(V(0, 9)), 1.8, 0x7CF29A));
          break;
        case 'bonusLane': this.lamps.set(sensor.event, this.makeLamp(c.add(V(0, 8)), 1.9, 0xF06BD0)); break;
        case 'spinner': this.makeSpinner(c, i); break;
        default: break;
      }
    }
    for (let i = 0; i < 5; i++) this.hyperspaceLamps.push(this.makeLamp(TableLayout.reference(581 + i * 15, 184), 1.8, 0xF3C54A));
  }
  makePassageLighting() {
    this.floorArrows('rightPassage', [...TableLayout.rightPassage].reverse(), 0x73E9FF);
    const shooter = TableLayout.shooter, gate = TableLayout.shooterDivider.b, launch = [];
    for (let i = 0; i <= 12; i++) { const k = i / 12, p = shooter.add(gate.add(V(14, 0)).sub(shooter).mul(k)); launch.push([p.x + 8, p.y, 0.8]); }
    this.flow('deployment', launch, 0xFFC778);
    TableLayout.skillGateDistances.forEach((d, i) => {
      const point = TableLayout.deploymentTrack.sample(d).position.add(V(7, 0));
      this.lamps.set(E('deploymentGate', i), this.makeLamp(point, 2, 0xFFCC67));
    });
  }
  makeHyperspaceTunnel() {
    const t = this.table, m = this.mat;
    const points = [[575, 158], [609, 169], [640, 194], [661, 227], [671, 265], [668, 302], [650, 336]].map(([x, y]) => TableLayout.reference(x, y));
    this.flow('hyperspace', points.map((p) => [p.x, p.y, 12.6]), 0xA9ACFF);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], p = a.add(b).div(2), d = b.sub(a);
      const n = new THREE.Group(); n.position.set(p.x, p.y, 0); n.rotation.z = Math.atan2(d.y, d.x); t.add(n);
      C.box(d.length + 2, 18, 8, C.material(0x632E3A, { metal: 0.55, rough: 0.3 }), [0, 0, 5], n);
      C.box(d.length, 15, 2, m.brushed, [0, 0, 9.5], n);
      C.surface(this.art.hyperspace, d.length, 15, [0, 0, 10.6], n);
      for (const side of [-1, 1]) {
        C.wire([[-d.length / 2, side * 8.2, 10.8], [d.length / 2, side * 8.2, 10.8]], 0.65, m.chrome, n);
        C.box(d.length - 2, 1, 1, m.darkRubber, [0, side * 6.9, 10.9], n);
      }
      C.box(2, 18, 2, m.chrome, [d.length / 2, 0, 11.4], n);
      for (const side of [-1, 1]) this.screw(V(d.length / 2, side * 6.5), 12.5, 0.8, n);
    }
  }
  makePort(p, color) {
    const n = new THREE.Group(); n.position.set(p.x, p.y, 0); this.table.add(n); const m = this.mat;
    C.box(14, 15, 7, m.brushed, [0, 0, 3.5], n);
    C.box(10, 12, 0.5, m.black, [0, -1, 7.2], n);
    C.wire([[-6, -6, 7], [-6, 6, 9], [6, 6, 9], [6, -6, 7]], 2.4, m.porcelain, n);
    C.cylinder(2, 1, C.material(color, { glow: 0.4 }), [0, 5, 10], n);
  }
  makeHole(p, radius, color) {
    const t = this.table, m = this.mat, x = p.x, y = p.y;
    C.cylinder(radius + 2.5, 1, m.black, [x, y, 0.8], t);
    C.ring(radius + 1, 1.3, m.chrome, [x, y, 2.8], t);
    C.ring(radius - 1, 1.5, C.material(color, { metal: 0.6, rough: 0.23 }), [x, y, 2.2], t);
    C.cylinder(radius - 2.6, 0.3, C.material(0x000107, { rough: 1 }), [x, y, 1.25], t);
    C.ring(radius - 3.6, 0.55, C.material(color, { metal: 0.2, rough: 0.3, glow: 0.3 }), [x, y, 1.5], t);
    C.wire([[x - radius - 2, y + 3, 2], [x - radius, y + radius, 7], [x + radius, y + radius, 7], [x + radius + 2, y + 3, 2]], 1.2, m.brushed, t);
  }
  makeSpinner(p, index) {
    const t = this.table, m = this.mat, x = p.x, y = p.y;
    for (const dx of [-10, 10]) C.cylinder(1.4, 10, m.brushed, [x + dx, y, 5], t);
    C.wire([[x - 11, y, 10], [x + 11, y, 10]], 0.8, m.chrome, t);
    const spinner = new THREE.Group(); spinner.position.set(x, y, 10); t.add(spinner); this.spinners[index] = spinner;
    C.box(14, 6, 1.6, m.porcelain, [0, 0, 0], spinner);
    C.box(6, 5, 0.4, m.rubber, [0, 0, 1], spinner);
    spinner.rotation.x = 0.25;
  }
  makePlunger() {
    const t = this.table, m = this.mat, p = TableLayout.shooter;
    const n = new THREE.Group(); n.position.set(p.x, p.y - 24, 6); t.add(n); this.spring = n;
    const pts = [];
    for (let i = 0; i <= 192; i++) { const k = i / 192, a = k * Math.PI * 15; pts.push([Math.cos(a) * 3.5, k * 17, Math.sin(a) * 3.5]); }
    C.wire(pts, 0.68, m.chrome, n);
    C.wire([[p.x, p.y - 27, 6], [p.x, p.y - 5, 6]], 1.5, m.brushed, t);
    C.box(14, 4, 9, m.brass, [p.x, p.y - 5, 6], t);
    C.box(14, 9, 10, m.rubber, [p.x, p.y - 25, 6], t);
  }
  makeFlipper(mirrored) {
    const root = new THREE.Group(), m = this.mat, sign = mirrored ? -1 : 1;
    const silhouette = (inset) => {
      const s = new THREE.Shape();
      s.moveTo(0, -8 + inset); s.lineTo(sign * 50, -5 + inset);
      s.quadraticCurveTo(sign * (59 - inset), 0, sign * 50, 5 - inset);
      s.lineTo(0, 8 - inset); s.quadraticCurveTo(-sign * (11 - inset), 0, 0, -8 + inset);
      return s;
    };
    C.cylinder(8, 3, m.brushed, [0, 0, -1], root);
    C.extrude(silhouette(0), 6, 1.3, m.rubber, 0, root);
    C.extrude(silhouette(1.8), 2, 0.9, m.porcelain, 5.8, root);
    C.ring(3.1, 0.65, m.brass, [0, 0, 8.2], root);
    this.screw(V(0, 0), 8.2, 2, root);
    const art = C.decal(this.art.flipperInlay, 64, 19.2, [sign * 22, 0, 8.4], root);
    if (mirrored) art.scale.x = -1;
    return root;
  }
  makeLamp(p, radius, color) {
    const t = this.table;
    C.cylinder(radius + 1, 0.9, this.mat.black, [p.x, p.y, 0.65], t, 16);
    C.ring(radius + 0.15, 0.42, this.mat.brass, [p.x, p.y, 1.2], t);
    const mat = C.material(color, { metal: 0.16, rough: 0.18, glow: 1 });
    const n = C.node(new THREE.SphereGeometry(radius, 16, 10), mat, [p.x, p.y, 1.2], t); n.scale.z = 0.38;
    const bulb = new Bulb(n, mat, color); bulb.set(false); return bulb;
  }
  screw(p, z, radius, parent = this.table) {
    C.cylinder(radius, 0.9, this.mat.chrome, [p.x, p.y, z], parent, 12);
    C.box(radius * 1.3, 0.36, 0.12, this.mat.black, [p.x, p.y, z + 0.5], parent);
  }

  // --- Lighting effects ---------------------------------------------------------------
  guide(event, p, radius) {
    if (this.guidance.has(event)) return;
    const holder = new THREE.Group(); holder.position.set(p.x, p.y, 0.8); holder.visible = false; this.table.add(holder);
    const mat = C.luminous(0xFFBC70);
    C.ring(radius, 0.8, mat, [0, 0, 0], holder);
    C.extrude([V(-2, -radius - 6), V(2, -radius - 6), V(0, -radius - 2)], 0.1, 0, mat, 0, holder);
    this.guidance.set(event, { holder, mat });
  }
  updateGuidance(targets, time) {
    const level = 0.28 + 0.5 * (0.5 + 0.5 * Math.sin(time * 2 * Math.PI / 1.25));
    for (const [event, g] of this.guidance) {
      const on = targets.has(event);
      g.holder.visible = on; if (on) g.mat.opacity = level;
    }
  }
  contact(event, p, radius, z, color = 0x75DCFF, squash = 1) {
    const holder = new THREE.Group(); holder.position.set(p.x, p.y, z); holder.scale.y = squash; this.table.add(holder);
    const mat = C.luminous(color);
    C.ring(radius, 0.65, mat, [0, 0, 0], holder);
    this.pushContact(event, mat);
  }
  outline(event, points, color) { const mat = C.luminous(color); C.wire(points, 0.65, mat, this.table); this.pushContact(event, mat); }
  pushContact(event, mat) { if (!this.contacts.has(event)) this.contacts.set(event, []); this.contacts.get(event).push(mat); }
  flow(route, points, color) {
    if (!this.flows.has(route)) this.flows.set(route, []);
    for (let i = 1; i < points.length; i++) {
      const mat = C.luminous(color); mat.opacity = 0.05; mat.userData.rest = 0.05;
      C.wire([points[i - 1], points[i]], 0.65, mat, this.table); this.flows.get(route).push(mat);
    }
  }
  floorArrows(route, points, color) {
    if (!this.flows.has(route)) this.flows.set(route, []);
    for (let i = 1; i < points.length; i++) {
      const d = points[i].sub(points[i - 1]), count = Math.max(1, Math.floor(d.length / 8));
      for (let j = 0; j < count; j++) {
        const p = points[i - 1].add(d.mul((j + 0.5) / count));
        const holder = new THREE.Group(); holder.position.set(p.x, p.y, 0.3); holder.rotation.z = Math.atan2(d.y, d.x) - Math.PI / 2; this.table.add(holder);
        const mat = C.luminous(color); mat.opacity = 0.12; mat.userData.rest = 0.12;
        C.extrude([V(-2.7, -2), V(0, 0), V(2.7, -2), V(0, 3)], 0.08, 0, mat, 0, holder);
        this.flows.get(route).push(mat);
      }
    }
  }
  pulse(mats, wave = false, strength = 1) {
    mats.forEach((mat, i) => {
      const delay = wave ? (i % 20) * 0.013 : 0, rest = wave ? (mat.userData.rest ?? 0.05) : 0;
      const total = delay + 0.55;
      mat.userData.token = (mat.userData.token ?? 0) + 1; const token = mat.userData.token;
      mat.opacity = strength;
      this.tweens.add(total, (k) => {
        if (mat.userData.token !== token) return;
        const t = k * total - delay;
        if (t < 0) return;
        if (t < 0.07) mat.opacity = strength - (strength - 0.24 * strength) * (t / 0.07);
        else if (t < 0.15) mat.opacity = 0.24 * strength + 0.76 * strength * ((t - 0.07) / 0.08);
        else mat.opacity = strength + (rest - strength) * Math.min(1, (t - 0.15) / 0.4);
      });
    });
  }
  flash(event, p, strength = 1) {
    this.pulse(this.contacts.get(event) ?? [], false, strength);
    const kind = kindOf(event);
    if (kind === 'passage' || kind === 'booster' || event === 'destination' || event === 'spinner:1') this.pulse(this.flows.get('rightPassage') ?? [], true);
    else if (event === 'ramp') this.pulse(this.flows.get('ramp') ?? [], true);
    else if (event === 'hyperspace') this.pulse(this.flows.get('hyperspace') ?? [], true);
    else if (kind === 'wormhole' && indexOf(event) !== 1) this.pulse(this.flows.get('rightPassage') ?? [], true);
    else if (event === 'deployment' || event === 'shooterReturn') this.pulse(this.flows.get('deployment') ?? [], true);
    if (['attack', 'launchBumper', 'missionTarget', 'fuelTarget', 'booster', 'medal', 'multiplier', 'hazardLeft', 'hazardRight', 'sling', 'wall'].includes(kind)) this.spark(p, strength);
  }
  spark(p, strength) {
    if (this.effects.children.length > 48) return;
    const light = this.impactLight; light.position.set(p.x, p.y, 15);
    const peak = 130 * 25 * strength;
    this.tweens.add(0.2, (k) => { light.intensity = peak * (1 - k); });
    const ringMat = C.luminous(0xA6E7FF); ringMat.opacity = 1;
    const ring = C.ring(2, 0.35, ringMat, [p.x, p.y, 1], this.effects);
    this.tweens.add(0.22, (k) => { ring.scale.setScalar(1 + 2.5 * k); ringMat.opacity = 1 - k; }, () => this.effects.remove(ring));
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.35, mat = C.luminous(0xE0F7FF); mat.opacity = 1;
      const dot = C.node(new THREE.SphereGeometry(0.65, 6, 4), mat, [p.x, p.y, 6], this.effects);
      this.tweens.add(0.18, (k) => { dot.position.set(p.x + Math.cos(a) * 8 * k, p.y + Math.sin(a) * 8 * k, 6 + 3 * k); mat.opacity = 1 - k; }, () => this.effects.remove(dot));
    }
  }
  /** Feedback from the rules: flashes, bumper squash, spinner spin and score pop-ups. */
  feedback(item, ballPosition) {
    let p = item.position;
    if (!p) {
      const bumper = TableLayout.bumpers.find((b) => b.event === item.event);
      const rail = TableLayout.targetRails.find((r) => r.event === item.event);
      const sensor = TableLayout.sensors.find((s) => s.event === item.event);
      p = bumper?.center ?? (rail ? rail.a.add(rail.b).div(2) : sensor?.center ?? ballPosition);
    }
    const strength = item.impactSpeed > 0 ? 0.35 + 0.65 * Math.sqrt(item.intensity) : 1;
    this.flash(item.event, p, strength);
    const bumper = this.bumperNodes.get(item.event);
    if (bumper) {
      this.tweens.add(0.145, (k) => { const s = k < 0.24 ? 1 - 0.06 * (k / 0.24) : 0.94 + 0.06 * ((k - 0.24) / 0.76); bumper.scale.setScalar(s); });
      const lens = this.bumperLenses.get(item.event); lens.emissiveIntensity = 1.6;
      this.tweens.add(0.12, () => {}, () => { lens.emissiveIntensity = 0.25; });
    }
    if (kindOf(item.event) === 'spinner') {
      const s = this.spinners[indexOf(item.event)]; const start = s.rotation.x;
      this.tweens.add(0.6, (k) => { s.rotation.x = start + Math.PI * 4 * (1 - (1 - k) * (1 - k)); });
    }
    if (item.points < 5_000 || this.effects.children.length >= 12) return;
    const tex = C.labelTexture(`+${item.points.toLocaleString('en-US')}`, 220, 40, '#E6CE7D', 22);
    const label = C.decal(tex, 52, 10, [ballPosition.x, ballPosition.y + 12, 27], this.effects);
    this.tweens.add(0.6, (k) => { label.position.set(ballPosition.x, ballPosition.y + 12 + 19 * k, 27 + 3 * k); label.material.opacity = 1 - k; },
      () => { this.effects.remove(label); tex.dispose(); });
  }

  // --- Per-frame update ---------------------------------------------------------------
  update(engine, { charge = 0, dt = 0, time = 0, active = true } = {}) {
    const r = engine.rules;
    let elevation = TableLayout.ballRadius + 0.3;
    const path = engine.guided;
    if (path && path.kind === 'ramp') elevation += Math.sin(Math.min(1, path.elapsed / path.duration) * Math.PI) * 15;
    this.ball.position.set(engine.ball.position.x, engine.ball.position.y, elevation);
    const inTransit = path ? path.kind === 'transfer' && path.elapsed / path.duration < 0.8 : false;
    this.ball.visible = !(r.phase === 'gameOver' || r.phase === 'bonus' || inTransit);
    this.centerPost.visible = r.centerBlockerTime > 0 && !r.tilted;
    if (active) {
      const v = engine.ball.velocity;
      this.ball.rotation.x -= v.y * dt / TableLayout.ballRadius; this.ball.rotation.y += v.x * dt / TableLayout.ballRadius;
    }
    this.leftFlipper.rotation.z = engine.left.angle;
    this.rightFlipper.rotation.z = -engine.right.angle;
    this.spring.scale.y = 1 - charge * 0.52;
    if (active) this.updateGuidance(r.missionTargets, time);
    this.tweens.step(dt);
  }
  updateLamps(r, now) {
    for (const [event, lamp] of this.lamps) {
      const kind = kindOf(event), i = indexOf(event);
      let on = false;
      switch (kind) {
        case 'deploymentGate': on = r.skillShotGates.has(i); break;
        case 'reentry': on = r.reentryLights.has(i); break;
        case 'launchLane': on = r.launchLights.has(i); break;
        case 'missionTarget': on = r.missionLights.has(i); break;
        case 'booster': on = r.boosterLights.has(i); break;
        case 'medal': on = r.medalLights.has(i); break;
        case 'multiplier': on = r.multiplierLights.has(i); break;
        case 'hazardLeft': on = r.leftHazards.has(i); break;
        case 'hazardRight': on = r.rightHazards.has(i); break;
        case 'fuelTarget': on = r.fuelLights.has(i); break;
        case 'fuel': on = r.fuel > i / 6 * 100; break;
        case 'gravityWell': on = r.gravityEnabled; break;
        case 'outlane': on = r.extraBallLit > 0; break;
        case 'returnLane': on = r.returnLaneLights.has(i); break;
        case 'bonusLane': on = r.bonusLaneLit; break;
        case 'wormhole': on = r.wormholeDestination === i; break;
        default: on = false;
      }
      lamp.set(on);
    }
    this.ranks.forEach((lamp, i) => lamp.set(i <= r.rank));
    this.progress.forEach((lamp, i) => lamp.set(i < r.rankProgress));
    this.hyperspaceLamps.forEach((lamp, i) => lamp.set(i < r.hyperspaceLevel));
    // Shoot Again: steady for five seconds, then flashes before it expires.
    const saveFlash = r.shootAgain > 0 && r.shootAgain < 5 && Math.floor(now * 6) % 2 === 0;
    this.saveLamp.set((r.shootAgain > 0 && !saveFlash) || r.replayReady);
    this.kickbackLamps[0]?.set(r.leftKickback); this.kickbackLamps[1]?.set(r.rightKickback);
    if (this.seenRank !== r.rank) {
      const old = this.rankText.material.map;
      this.rankText.material.map = C.labelTexture(String(r.rank + 1).padStart(2, '0'), 80, 40, '#E5C68C', 30);
      this.rankText.material.needsUpdate = true; old?.dispose(); this.seenRank = r.rank;
    }
    for (const [event, m] of this.bumperLenses) {
      const level = kindOf(event) === 'attack' ? r.attackLevel : r.launchLevel;
      const color = [0x284FC3, 0x399854, 0xB52931, 0xCFB333][level];
      m.color.setHex(color); m.emissive.setHex(color);
    }
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
