// Port of TableCraft.swift: small mesh helpers in table space (x right, y up the table, z up).
import * as THREE from '../vendor/three.module.min.js';

export const hex = (c) => new THREE.Color(c);

export function material(color, { metal = 0, rough = 0.4, glow = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, side: THREE.DoubleSide });
  if (glow > 0) { m.emissive = hex(color); m.emissiveIntensity = glow; }
  return m;
}
export function luminous(color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
}
export function node(geometry, mat, at, parent) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(at[0], at[1], at[2]);
  parent.add(mesh);
  return mesh;
}
/** Cylinder standing on the table (axis along z), centred at `at`. */
export function cylinder(radius, height, mat, at, parent, segments = 28) {
  const g = new THREE.CylinderGeometry(radius, radius, height, segments);
  const n = node(g, mat, at, parent); n.rotation.x = Math.PI / 2; return n;
}
export function cone(top, bottom, height, mat, at, parent) {
  const g = new THREE.CylinderGeometry(top, bottom, height, 36);
  const n = node(g, mat, at, parent); n.rotation.x = Math.PI / 2; return n;
}
/** Torus lying flat on the table. */
export function ring(radius, pipe, mat, at, parent) {
  return node(new THREE.TorusGeometry(radius, pipe, 8, 40), mat, at, parent);
}
export function box(w, h, d, mat, at, parent) {
  return node(new THREE.BoxGeometry(w, h, d), mat, at, parent);
}
export function shapeFrom(points) {
  const s = new THREE.Shape();
  s.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) s.lineTo(p.x, p.y);
  s.closePath();
  return s;
}
/** Extrusion centred on z like SCNShape. */
export function extrude(points, height, bevel, mat, z, parent) {
  const shape = Array.isArray(points) ? shapeFrom(points) : points;
  const b = Math.min(bevel, height / 2 - 0.01);
  const g = new THREE.ExtrudeGeometry(shape, { depth: height - 2 * Math.max(0, b), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -height / 2 + Math.max(0, b));
  return node(g, mat, [0, 0, z], parent);
}
/** Continuous tube along a polyline of [x,y,z] points. */
export function tube(points, radius, sides = 8) {
  const verts = [], normals = [], index = [];
  const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  for (let i = 0; i < points.length; i++) {
    const tangent = v3(points[Math.min(i + 1, points.length - 1)]).sub(v3(points[Math.max(0, i - 1)])).normalize();
    const reference = Math.abs(tangent.z) < 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(tangent, reference).normalize();
    const v = new THREE.Vector3().crossVectors(tangent, u);
    for (let j = 0; j < sides; j++) {
      const a = j / sides * Math.PI * 2;
      const n = u.clone().multiplyScalar(Math.cos(a)).add(v.clone().multiplyScalar(Math.sin(a)));
      verts.push(points[i][0] + n.x * radius, points[i][1] + n.y * radius, points[i][2] + n.z * radius);
      normals.push(n.x, n.y, n.z);
      if (i < points.length - 1) {
        const A = i * sides + j, B = i * sides + (j + 1) % sides, C = A + sides, D = B + sides;
        index.push(A, B, C, B, D, C);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(index);
  return g;
}
export function wire(points, radius, mat, parent) { return node(tube(points, radius), mat, [0, 0, 0], parent); }
/** Flat ribbon (ramp deck) following a polyline, with UVs along its length. */
export function ribbon(points, width) {
  const verts = [], normals = [], uv = [], index = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(i + 1, points.length - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const sx = -ty * width / 2, sy = tx * width / 2;
    for (const sign of [-1, 1]) {
      verts.push(points[i][0] + sx * sign, points[i][1] + sy * sign, points[i][2]);
      normals.push(0, 0, 1); uv.push(sign < 0 ? 0 : 1, i / (points.length - 1));
    }
    if (i < points.length - 1) { const k = i * 2; index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}
export function labelTexture(text, width, height, color = '#E5D8AF', font = 22) {
  const c = document.createElement('canvas'); c.width = width * 2; c.height = height * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  g.fillText(text, width / 2, height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** Unlit decal plane facing up the z axis. */
export function decal(texture, width, height, at, parent) {
  const m = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  return node(new THREE.PlaneGeometry(width, height), m, at, parent);
}
export function surface(texture, width, height, at, parent, repeatX = 1, repeatY = 1) {
  const t = texture.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeatX, repeatY); t.needsUpdate = true;
  const m = new THREE.MeshLambertMaterial({ map: t });
  return node(new THREE.PlaneGeometry(width, height), m, at, parent);
}
