// Port of SpacePinball/Game/Core/Physics.swift. Speeds are table units per second.
import { Vector, V, Rail, TableLayout, E, kindOf, indexOf } from './geometry.js';
import { PinballRules } from './rules.js';

export const PinballTuning = {
  speedMultiplier: 1.2,
  get gravity() { return 285 * this.speedMultiplier * this.speedMultiplier; },
  get rollingDrag() { return 0.12 * this.speedMultiplier; },
  // Ball max speed = ball radius * 200 per second.
  maximumSpeed: TableLayout.ballRadius * 200,
  get attackKick() { return 180 * this.speedMultiplier; },
  get launchKick() { return 145 * this.speedMultiplier; },
  get bumperCooldown() { return 0.16 / this.speedMultiplier; },
  bumperThreshold: 30,
  flipperElasticity: 0.55,
  flipperBoost: 1.0,
};
const T = PinballTuning;

export class FlipperState {
  constructor(pivot, mirrored) { this.pivot = pivot; this.mirrored = mirrored; this.held = false; this.angle = TableLayout.restingFlipperAngle; this.angularVelocity = 0; }
  get direction() { return V(Math.cos(this.angle) * (this.mirrored ? -1 : 1), Math.sin(this.angle)); }
  get tip() { return this.pivot.add(this.direction.mul(TableLayout.flipperLength)); }
  step(dt, enabled) {
    const target = this.held && enabled ? TableLayout.raisedFlipperAngle : TableLayout.restingFlipperAngle;
    const difference = target - this.angle;
    const change = Math.min(Math.abs(difference), dt * (this.held && enabled ? 12 : 7.5)) * (difference >= 0 ? 1 : -1);
    this.angle += change; this.angularVelocity = change / dt;
  }
  surfaceVelocity(point) {
    const delta = point.sub(this.pivot);
    const omega = this.angularVelocity * (this.mirrored ? -1 : 1);
    return V(-delta.y * omega, delta.x * omega);
  }
}

class GuidedPath {
  constructor(points, duration, exitVelocity, kind = 'scoop') { this.points = points; this.duration = duration; this.exitVelocity = exitVelocity; this.elapsed = 0; this.kind = kind; }
  position() {
    const pts = this.points, n = pts.length;
    const progress = Math.min(1, Math.max(0, this.elapsed / this.duration));
    if (this.kind === 'transfer') {
      // Transit is beneath the playfield. Only the short mouth exit is visible.
      if (progress < 0.8) return pts[0];
      return pts[n - 2].add(pts[n - 1].sub(pts[n - 2]).mul((progress - 0.8) / 0.2));
    }
    if (this.kind === 'scoop') {
      const mouth = pts[n - 2];
      if (progress < 0.15) return pts[0].add(mouth.sub(pts[0]).mul(progress / 0.15));
      if (progress < 0.7) return mouth;
      return mouth.add(pts[n - 1].sub(mouth).mul((progress - 0.7) / 0.3));
    }
    const lengths = [];
    for (let i = 1; i < n; i++) lengths.push(pts[i].sub(pts[i - 1]).length);
    let remaining = progress * lengths.reduce((a, b) => a + b, 0);
    for (let i = 0; i < lengths.length; i++) {
      const length = lengths[i];
      if (length <= 0.00001) continue;
      if (remaining <= length) return pts[i].add(pts[i + 1].sub(pts[i]).mul(remaining / length));
      remaining -= length;
    }
    return pts[n - 1];
  }
}

const isCapture = (e) => ['ramp', 'hyperspace', 'blackHole', 'gravityWell', 'wormhole'].includes(kindOf(e));

export class PinballEngine {
  static step = 1 / 240;
  constructor() {
    this.rules = new PinballRules();
    this.reset();
  }
  reset() {
    this.ball = { position: TableLayout.shooter, velocity: Vector.zero(), radius: TableLayout.ballRadius };
    this.left = new FlipperState(TableLayout.leftPivot, false);
    this.right = new FlipperState(TableLayout.rightPivot, true);
    this.time = 0; this.guided = null; this.deployment = null; this.lastFlipperHit = null;
    this.accumulator = 0; this.cooldowns = new Map(); this.occupiedSensors = new Set();
    this.stuckFor = 0; this.unstickAttempts = 0; this.lastNudge = -10;
  }
  newGame() { this.rules.newGame(); this.reset(); }
  launch(charge) {
    if (this.rules.phase !== 'ready') return;
    const power = Math.max(0.05, Math.min(0.999, charge));
    this.rules.launch(power);
    this.deployment = { distance: 0, speed: Math.min(T.maximumSpeed, (370 + 150 * power) * T.speedMultiplier) };
    this.ball.position = TableLayout.shooter; this.ball.velocity = V(0, this.deployment.speed);
  }
  advanceDeployment(dt) {
    const path = this.deployment;
    if (!path) return;
    const track = TableLayout.deploymentTrack, previous = path.distance;
    const tangent = track.sample(path.distance).tangent;
    path.speed -= (T.gravity * tangent.y + T.rollingDrag * 0.45 * path.speed) * dt;
    path.distance += path.speed * dt;
    if (path.speed > 0) {
      TableLayout.skillGateDistances.forEach((d, i) => { if (previous < d && path.distance >= d) this.rules.hit(E('deploymentGate', i)); });
    }
    const sample = track.sample(path.distance);
    this.ball.position = sample.position; this.ball.velocity = sample.tangent.mul(path.speed);
    if (path.distance >= track.length) {
      this.deployment = null; this.rules.hit('deploymentExit');
      this.ball.velocity = sample.tangent.mul(path.speed);
    } else if (path.speed < 0 && previous >= TableLayout.deploymentExitDistance && path.distance <= TableLayout.deploymentExitDistance) {
      this.deployment = null; this.ball.position = sample.position.add(V(-13, 0));
      this.ball.velocity = V(-0.85, -0.53).normalized.mul(Math.max(90, Math.abs(path.speed))); this.rules.hit('deploymentExit');
    } else if (path.distance <= 0) {
      this.deployment = null; this.ball.position = TableLayout.shooter; this.ball.velocity = Vector.zero();
      this.rules.returnToShooter(); this.releaseControls();
    }
  }
  makeGuide(points, duration, exitVelocity, kind = 'scoop') {
    return new GuidedPath(points, duration / T.speedMultiplier, exitVelocity.mul(T.speedMultiplier), kind);
  }
  setFlipper(isLeft, pressed) {
    if (this.rules.phase === 'gameOver') { if (pressed) this.newGame(); return; }
    if (this.rules.phase === 'bonus') { this.releaseControls(); return; }
    if (isLeft) { if (pressed && !this.left.held) this.rules.shiftLanes(false); this.left.held = pressed; }
    else { if (pressed && !this.right.held) this.rules.shiftLanes(true); this.right.held = pressed; }
    if (pressed && !this.rules.tilted) this.rules.hit('flipper');
  }
  releaseControls() { this.left.held = false; this.right.held = false; }
  nudge() {
    if (this.time - this.lastNudge < 0.35) return;
    this.lastNudge = this.time;
    if (this.rules.nudge()) this.ball.velocity = this.ball.velocity.add(V(this.ball.position.x < 200 ? 55 : -55, 90).mul(T.speedMultiplier));
  }
  advance(delta) {
    // Clamp suspend/resume gaps; integrate at the same rate on any display refresh rate.
    this.accumulator += Math.max(0, Math.min(0.05, delta));
    while (this.accumulator >= PinballEngine.step) { this.stepOnce(PinballEngine.step); this.accumulator -= PinballEngine.step; }
  }
  stepOnce(dt) {
    // Two motion/collision samples per input tick keep a fast bat from skipping the ball.
    for (let i = 0; i < 2; i++) this.integrate(dt / 2);
  }
  integrate(dt) {
    const rules = this.rules, ball = this.ball;
    this.time += dt;
    this.left.step(dt, !rules.tilted); this.right.step(dt, !rules.tilted);
    if (rules.phase === 'bonus') {
      rules.tick(dt);
      if (rules.phase === 'ready') this.prepareBall();
      return;
    }
    if (rules.phase !== 'playing') return;
    rules.tick(dt);
    if (this.deployment) { this.advanceDeployment(dt); return; }
    if (this.guided) {
      const path = this.guided, previous = ball.position;
      path.elapsed += dt; ball.position = path.position();
      ball.velocity = path.kind === 'transfer' ? Vector.zero() : ball.position.sub(previous).div(dt);
      if (path.elapsed >= path.duration) {
        ball.position = path.points[path.points.length - 1]; ball.velocity = path.exitVelocity;
        this.guided = null; this.occupiedSensors.clear(); rules.pathReleased(path.kind);
      }
      return;
    }
    ball.velocity = V(ball.velocity.x, ball.velocity.y - T.gravity * dt);
    ball.velocity = ball.velocity.mul(Math.exp(-T.rollingDrag * dt));
    this.limitSpeed();
    ball.position = ball.position.add(ball.velocity.mul(dt));
    for (const rail of TableLayout.rails) this.resolve(rail);
    for (const rail of TableLayout.targetRails) this.resolve(rail);
    for (const bumper of TableLayout.bumpers) {
      const delta = ball.position.sub(bumper.center);
      const radius = bumper.radius + ball.radius;
      if (delta.length < radius) {
        const normal = delta.normalized;
        ball.position = bumper.center.add(normal.mul(radius + 0.1));
        const approach = ball.velocity.dot(normal);
        if (approach < 0) {
          ball.velocity = ball.velocity.sub(normal.mul(1.78 * approach));
          // A pop fires once on incoming contact, not on every overlapping tick.
          if (!rules.tilted && -approach >= T.bumperThreshold && this.register(bumper.event, T.bumperCooldown, -approach)) {
            const kick = kindOf(bumper.event) === 'launchBumper' ? T.launchKick : T.attackKick;
            const outgoing = ball.velocity.dot(normal);
            ball.velocity = ball.velocity.add(normal.mul(Math.max(0, kick - outgoing)));
          }
        }
      }
    }
    this.collide(this.left); this.collide(this.right);
    if (rules.centerBlockerTime > 0 && !rules.tilted) {
      const offset = ball.position.sub(TableLayout.centerPost), radius = ball.radius + TableLayout.centerPostRadius;
      if (offset.length < radius) {
        const normal = offset.normalized; ball.position = TableLayout.centerPost.add(normal.mul(radius + 0.1));
        const approach = ball.velocity.dot(normal);
        if (approach < 0) { ball.velocity = ball.velocity.sub(normal.mul(1.8 * approach)); this.register('centerPost', 0.16, -approach); }
      }
    }
    const inside = new Set();
    for (const sensor of TableLayout.sensors) {
      if (!(ball.position.sub(sensor.center).length < sensor.radius + ball.radius * 0.3)) continue;
      inside.add(sensor.event);
      if (this.occupiedSensors.has(sensor.event) || (sensor.upwardOnly && !(ball.velocity.y > 80 * T.speedMultiplier))) continue;
      const event = sensor.event;
      if (!(this.time >= (this.cooldowns.get(event) ?? -1))) continue;
      if (event === 'gravityWell' && !rules.gravityEnabled) continue;
      // Record a destination before scoring consumes / changes any selection.
      const wormDestination = rules.wormholeDestination;
      this.register(event, isCapture(event) ? 1.8 : 0.3);
      const kind = kindOf(event), i = indexOf(event);
      if (event === 'ramp') {
        this.guided = this.makeGuide([ball.position, ...TableLayout.rampRoute.slice(1)], 1.15, V(45, -110), 'ramp');
      } else if (event === 'hyperspace') {
        this.guided = this.makeGuide([ball.position, sensor.center, sensor.center.add(V(15, -25))], 0.65, V(-35, -170));
      } else if (event === 'blackHole') {
        this.guided = this.makeGuide([ball.position, sensor.center, sensor.center.add(V(15, -13))], 0.6, V(145, -130));
      } else if (event === 'gravityWell') {
        this.guided = this.makeGuide([ball.position, sensor.center, sensor.center.add(V(0, -17))], 0.7, V(35, -175));
      } else if (kind === 'wormhole') {
        const exitIndex = wormDestination ?? i;
        const exit = TableLayout.sensor(E('wormhole', exitIndex)).center;
        // All three mouths eject inward, away from the outside wall and into play.
        const direction = V(200, 170).sub(exit).normalized;
        this.guided = this.makeGuide([sensor.center, exit, exit.add(direction.mul(19))], 0.7, direction.mul(185), 'transfer');
        this.cooldowns.set(E('wormhole', exitIndex), this.time + 1.8);
      } else if (kind === 'outlane') {
        if (rules.consumeKickback(i === 0)) ball.velocity = V(i === 0 ? 65 : -65, 420).mul(T.speedMultiplier);
      } else if (kind === 'spinner') {
        // One traversal represents multiple rotations, proportional to speed.
        const spins = Math.min(12, Math.max(1, Math.trunc(ball.velocity.length / (65 * T.speedMultiplier))));
        for (let s = 1; s < spins; s++) rules.hit(event, ball.velocity.length, ball.position);
      }
      if (this.guided) break;
    }
    this.limitSpeed();
    this.occupiedSensors = inside;
    // The plunger lane is a recoverable return, separate from either outlane and the drain.
    if (ball.position.y <= TableLayout.shooter.y + ball.radius && ball.velocity.y <= 0 && TableLayout.insideShooterLane(ball.position)) {
      rules.returnToShooter(); ball.position = TableLayout.shooter; ball.velocity = Vector.zero();
      this.releaseControls(); this.guided = null; this.occupiedSensors.clear(); this.stuckFor = 0;
      return;
    }
    if (ball.position.y < TableLayout.drainY) {
      rules.drain(); this.releaseControls(); this.guided = null; this.deployment = null; this.occupiedSensors.clear(); this.stuckFor = 0;
      if (rules.phase === 'ready') this.prepareBall();
    }
    if (ball.velocity.length < 18) this.stuckFor += dt; else this.stuckFor = 0;
    if (this.stuckFor > 3) {
      // Free a resting ball without granting points. Alternate a sideways lift
      // (clears flat ledges) with a push toward the open middle (clears corners).
      this.unstickAttempts += 1;
      ball.velocity = this.unstickAttempts % 2 === 1
        ? V(ball.position.x < 195 ? 90 : -90, 135).mul(T.speedMultiplier)
        : V(200, 250).sub(ball.position).normalized.mul(190 * T.speedMultiplier);
      this.stuckFor = 0;
    }
  }
  prepareBall() {
    this.ball = { position: TableLayout.shooter, velocity: Vector.zero(), radius: TableLayout.ballRadius };
    this.left = new FlipperState(TableLayout.leftPivot, false);
    this.right = new FlipperState(TableLayout.rightPivot, true);
    this.cooldowns.clear(); this.lastNudge = -10; this.lastFlipperHit = null; this.stuckFor = 0;
  }
  limitSpeed() {
    const b = this.ball;
    if (b.velocity.length > T.maximumSpeed) b.velocity = b.velocity.normalized.mul(T.maximumSpeed);
  }
  resolve(rail) {
    const ball = this.ball;
    const nearest = rail.nearest(ball.position), offset = ball.position.sub(nearest);
    const minimum = ball.radius + rail.radius;
    if (!(offset.length < minimum)) return;
    const normal = offset.normalized;
    ball.position = nearest.add(normal.mul(minimum + 0.02));
    const speed = ball.velocity.dot(normal);
    if (!(speed < 0)) return;
    ball.velocity = ball.velocity.sub(normal.mul((1 + rail.restitution) * speed));
    // Cushion tangential sliding without adding energy at every wall contact.
    const tangent = ball.velocity.sub(normal.mul(ball.velocity.dot(normal)));
    ball.velocity = ball.velocity.sub(tangent.mul(0.015));
    if (rail.event && kindOf(rail.event) === 'sling') {
      if (this.register(rail.event, 0.16, -speed) && !this.rules.tilted) {
        const outgoing = ball.velocity.dot(normal);
        ball.velocity = ball.velocity.add(normal.mul(Math.max(0, 155 * T.speedMultiplier - outgoing)));
      }
    } else if (Math.abs(speed) > 22) this.register(rail.event ?? 'wall', 0.16, -speed);
  }
  collide(flipper) {
    const ball = this.ball;
    const rail = new Rail(flipper.pivot, flipper.tip, { radius: 0 });
    const nearest = rail.nearest(ball.position);
    const offset = ball.position.sub(nearest);
    // Taper the contact shape toward its tip.
    const fraction = Math.min(1, nearest.sub(flipper.pivot).length / TableLayout.flipperLength);
    const radius = 8 - 4 * fraction;
    if (!(offset.length < ball.radius + radius)) return;
    const normal = offset.normalized;
    ball.position = nearest.add(normal.mul(ball.radius + radius + 0.1));
    const incoming = ball.velocity;
    const moving = Math.abs(flipper.angularVelocity) > 0.01 && !this.rules.tilted;
    const pushing = moving ? flipper.surfaceVelocity(nearest).dot(normal) : 0;
    const normalSpeed = incoming.dot(normal);
    if (!(normalSpeed - Math.max(0, pushing) < -0.1)) return;
    const tangent = incoming.sub(normal.mul(normalSpeed));
    // Contact angle and incoming velocity determine direction; no preset aim.
    const outgoing = pushing > 0
      ? Math.max(normalSpeed, Math.max(0, -normalSpeed) * T.flipperElasticity + pushing * T.flipperBoost)
      : Math.max(0, -normalSpeed) * T.flipperElasticity * Math.max(0.06, 1 - fraction);
    ball.velocity = tangent.mul(1 - 0.018).add(normal.mul(outgoing));
    this.limitSpeed();
    this.lastFlipperHit = { left: !flipper.mirrored, point: nearest, fraction, angle: flipper.angle, incoming, outgoing: ball.velocity };
  }
  register(event, interval, impactSpeed = null) {
    if (!(this.time >= (this.cooldowns.get(event) ?? -1))) return false;
    this.cooldowns.set(event, this.time + interval);
    this.rules.hit(event, impactSpeed ?? this.ball.velocity.length, this.ball.position);
    return true;
  }
}
