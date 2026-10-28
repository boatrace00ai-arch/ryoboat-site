// Port of SpacePinball/Game/Core/Geometry.swift. Keep numbers in sync with the iOS app.
// Table coordinates: 400 x 500 logical units, origin bottom-left, y up.

export class Vector {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  static zero() { return new Vector(0, 0); }
  get length() { return Math.hypot(this.x, this.y); }
  get normalized() { const l = this.length; return l > 0.00001 ? this.div(l) : new Vector(0, 1); }
  dot(o) { return this.x * o.x + this.y * o.y; }
  add(o) { return new Vector(this.x + o.x, this.y + o.y); }
  sub(o) { return new Vector(this.x - o.x, this.y - o.y); }
  mul(s) { return new Vector(this.x * s, this.y * s); }
  div(s) { return new Vector(this.x / s, this.y / s); }
  equals(o) { return this.x === o.x && this.y === o.y; }
}
export const V = (x, y) => new Vector(x, y);

// Events are strings: "ramp", "attack:2", "wormhole:0" ...
export const E = (name, i) => (i === undefined ? name : `${name}:${i}`);
export const kindOf = (e) => { const c = e.indexOf(':'); return c < 0 ? e : e.slice(0, c); };
export const indexOf = (e) => { const c = e.indexOf(':'); return c < 0 ? -1 : parseInt(e.slice(c + 1), 10); };

export class Rail {
  constructor(a, b, { restitution = 0.76, event = null, radius = 2 } = {}) {
    this.a = a; this.b = b; this.restitution = restitution; this.event = event; this.radius = radius;
  }
  nearest(p) {
    const d = this.b.sub(this.a);
    const t = Math.max(0, Math.min(1, p.sub(this.a).dot(d) / Math.max(0.0001, d.dot(d))));
    return this.a.add(d.mul(t));
  }
}

export class PolylineTrack {
  constructor(points) {
    this.points = points;
    this.lengths = [];
    for (let i = 1; i < points.length; i++) this.lengths.push(points[i].sub(points[i - 1]).length);
    this.length = this.lengths.reduce((a, b) => a + b, 0);
  }
  sample(distance) {
    let remaining = Math.max(0, Math.min(this.length, distance));
    for (let i = 0; i < this.lengths.length; i++) {
      const d = this.lengths[i];
      if (d <= 0.0001) continue;
      if (remaining <= d) {
        const delta = this.points[i + 1].sub(this.points[i]);
        return { position: this.points[i].add(delta.mul(remaining / d)), tangent: delta.div(d) };
      }
      remaining -= d;
    }
    const n = this.points.length;
    return { position: this.points[n - 1], tangent: this.points[n - 1].sub(this.points[n - 2]).normalized };
  }
}

const ref = (x, y) => V(20 + (x - 180) * 360 / 644, 25 + (852 - y) * 450 / 757);
const refs = (list) => list.map(([x, y]) => ref(x, y));

export const TableLayout = (() => {
  const L = {};
  L.width = 400; L.height = 500; L.ballRadius = 5.1; L.drainY = 12;
  L.flipperLength = 62; L.restingFlipperAngle = -0.38; L.raisedFlipperAngle = 0.40;
  L.reference = ref;
  L.shooter = ref(789, 812);
  L.deploymentTrack = new PolylineTrack([L.shooter, ...refs([[774, 735], [743, 520], [720, 345], [700, 210], [660, 152], [559, 135], [435, 150]])]);
  L.skillGateDistances = [270, 310, 350, 390, 430, 470];
  L.deploymentExitDistance = 252;
  L.shooterDivider = new Rail(ref(769, 850), ref(697, 448), { radius: 1.4 });
  L.insideShooterLane = (p) => {
    const a = L.shooterDivider.a, b = L.shooterDivider.b;
    if (!(p.y <= b.y && p.y >= L.drainY - L.ballRadius)) return false;
    const x = a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y);
    const oa = ref(822, 850), ob = ref(696, 101);
    const outside = oa.x + (ob.x - oa.x) * (p.y - oa.y) / (ob.y - oa.y);
    return p.x > x + L.ballRadius * 0.4 && p.x < outside + L.ballRadius;
  };
  L.rightPassage = refs([[643, 355], [622, 386], [614, 420], [629, 453], [651, 479]]);
  L.leftPivot = ref(384, 794);
  L.rightPivot = ref(625, 794);
  L.centerPost = V((L.leftPivot.x + L.rightPivot.x) / 2, L.leftPivot.y - 20);
  L.centerPostRadius = 5.5;
  L.reactor = ref(503, 580);
  L.outline = refs([[190, 840], [247, 470], [309, 101], [696, 101], [822, 840]]);
  L.launchIsland = refs([[252, 440], [265, 415], [313, 425], [339, 453], [347, 504], [333, 557], [305, 590], [278, 605], [269, 569], [259, 530], [245, 510]]);
  L.slings = [refs([[349, 616], [396, 718], [336, 689]]), refs([[656, 616], [611, 718], [670, 689]])];
  L.bumpers = [
    { center: ref(355, 169), radius: 10.5, event: E('attack', 3) }, // isolated Satellite
    // Upper trio spread apart so balls fall through more often (kept in sync with Swift).
    { center: ref(455, 262), radius: 11.5, event: E('attack', 0) },
    { center: ref(541, 248), radius: 11.5, event: E('attack', 1) },
    { center: ref(503, 322), radius: 12, event: E('attack', 2) },
    { center: ref(269, 484), radius: 11, event: E('launchBumper', 0) },
    { center: ref(331, 498), radius: 11, event: E('launchBumper', 1) },
    { center: ref(289, 551), radius: 11, event: E('launchBumper', 2) },
  ];
  L.rampControls = [refs([[437, 444], [408, 365], [329, 317], [286, 363]]), refs([[286, 363], [255, 405], [291, 429], [328, 448]])];
  L.rampRoute = refs([[437, 444], [414, 397], [372, 354], [323, 345], [286, 363], [276, 395], [291, 429], [328, 448], [300, 470]]);
  L.rails = (() => {
    const r = [];
    const poly = (pts, event = null, restitution = 0.76) => {
      const p = refs(pts);
      for (let i = 1; i < p.length; i++) r.push(new Rail(p[i - 1], p[i], { restitution, event, radius: 1.4 }));
    };
    poly([[190, 850], [247, 470], [309, 101], [696, 101], [822, 850]]);
    r.push(L.shooterDivider);
    poly([[319, 151], [371, 125], [558, 125], [638, 145], [681, 207]]);
    // Inlane guides end level with the top of the flipper base so a ball rolls onto the bat.
    poly([[283, 608], [262, 742], [381, 779]]);
    // Inner guides stop short so the lane mouth stays wider than the ball.
    poly([[322, 612], [303, 694], [374, 752]]);
    poly([[684, 608], [709, 742], [628, 779]]);
    poly([[650, 612], [674, 694], [631, 751]]);
    for (const p of L.slings) for (let i = 0; i < p.length; i++) {
      r.push(new Rail(p[i], p[(i + 1) % p.length], { restitution: 0.8, event: E('sling', p[0].x < 200 ? 0 : 1), radius: 1.6 }));
    }
    for (const x of [466, 497, 526, 555]) poly([[x, 172], [x, 206]]);
    // Fuel chute runs down the LEFT of the attack bumpers, behind the ramp.
    poly([[361, 250], [378, 290], [380, 332]]);
    poly([[337, 252], [352, 292], [353, 333]]);
    poly([[253, 455], [242, 505], [271, 564]]);
    poly([[337, 482], [345, 529], [317, 571]]);
    return r;
  })();
  L.targetRails = (() => {
    const r = [];
    const bank = (centers, delta, event) => centers.forEach(([x, y], i) => {
      const p = ref(x, y);
      r.push(new Rail(p.sub(delta), p.add(delta), { event: event(i), radius: 2 }));
    });
    bank([[419, 212], [437, 207], [455, 202]], V(3.7, 1.2), (i) => E('multiplier', i));
    bank([[480, 357], [500, 362], [520, 367]], V(4, -1), (i) => E('medal', i));
    bank([[585, 432], [587, 453], [589, 474]], V(0.6, -3.7), (i) => E('booster', i));
    bank([[310, 613], [306, 636], [302, 659]], V(-0.8, -3.6), (i) => E('missionTarget', i));
    bank([[326, 155], [366, 131], [393, 166]], V(2, 1), (i) => E('fuelTarget', i));
    bank([[332, 271], [336, 293], [340, 315]], V(0.6, -2.4), (i) => E('hazardLeft', i));
    bank([[585, 244], [594, 269], [595, 292]], V(1, -2.4), (i) => E('hazardRight', i));
    bank([[690, 474]], V(1.5, -2.2), () => 'destination');
    return r;
  })();
  L.sensors = (() => {
    const s = [
      { center: ref(437, 444), radius: 10, event: 'ramp', upwardOnly: true },
      { center: ref(566, 168), radius: 9, event: 'hyperspace' },
      { center: ref(327, 387), radius: 8, event: 'blackHole' },
      { center: L.reactor, radius: 6, event: 'gravityWell' },
      { center: ref(665, 341), radius: 8, event: E('wormhole', 0) },
      { center: ref(303, 286), radius: 8, event: E('wormhole', 1) },
      { center: ref(675, 505), radius: 8, event: E('wormhole', 2) },
      { center: ref(321, 738), radius: 7, event: E('returnLane', 0) },
      { center: ref(687, 738), radius: 7, event: E('returnLane', 1) },
      { center: ref(245, 753), radius: 8, event: E('outlane', 0) },
      { center: ref(733, 753), radius: 8, event: E('outlane', 1) },
      { center: ref(282, 625), radius: 7, event: 'bonusLane' },
      { center: ref(367, 243), radius: 8, event: 'spaceWarp' },
      { center: ref(382, 358), radius: 8, event: E('spinner', 0) },
      { center: ref(622, 392), radius: 8, event: E('spinner', 1) },
    ];
    for (let i = 0; i < 3; i++) {
      s.push({ center: ref(478 + i * 32, 192), radius: 8, event: E('reentry', i) });
      s.push({ center: ref(275 + i * 25, 455 + i * 8), radius: 7, event: E('launchLane', i) });
    }
    for (let i = 0; i < 3; i++) s.push({ center: L.rightPassage[i + 1], radius: 12, event: E('passage', i) });
    s.push({ center: L.rightPassage[L.rightPassage.length - 1], radius: 12, event: E('passage', 3) });
    for (let i = 0; i < 6; i++) s.push({ center: ref(354 - i * 3.4, 329 - i * 15), radius: 5, event: E('fuel', i) });
    return s;
  })();
  L.sensor = (event) => L.sensors.find((s) => s.event === event);
  L.allEvents = new Set([
    ...L.bumpers.map((b) => b.event), ...L.sensors.map((s) => s.event),
    ...L.targetRails.map((r) => r.event).filter(Boolean), ...L.rails.map((r) => r.event).filter(Boolean),
  ]);
  return L;
})();
