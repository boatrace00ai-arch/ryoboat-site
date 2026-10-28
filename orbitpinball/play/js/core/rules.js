// Port of SpacePinball/Game/Core/Rules.swift.
import { TableLayout, E, kindOf, indexOf } from './geometry.js';
import { accepts, selectMission } from './missions.js';

const fmt = (n) => n.toLocaleString('en-US');
export const ContactSounds = new Set(['bumper', 'metal', 'flipper', 'target', 'dropTarget', 'sling']);

export class Feedback {
  constructor({ event, points = 0, sound = 'metal', impactSpeed = 0, position = null, pitch = 1 }) {
    Object.assign(this, { event, points, sound, impactSpeed, position, pitch });
  }
  get intensity() { return Math.min(1, Math.max(0, this.impactSpeed / 480)); }
  get volume() { return ContactSounds.has(this.sound) ? (0.12 + 0.58 * Math.sqrt(this.intensity)) * (this.sound === 'metal' ? 0.55 : 1) : 0.68; }
  get rate() { return ContactSounds.has(this.sound) ? 0.94 + 0.12 * this.intensity : this.pitch; }
  get pan() { return this.position ? Math.min(0.65, Math.max(-0.65, (this.position.x - 200) / 200 * 0.65)) : 0; }
}

export const Ranks = ['CADET', 'ENSIGN', 'LIEUTENANT', 'CAPTAIN', 'LT. COMMANDER', 'COMMANDER', 'COMMODORE', 'ADMIRAL', 'FLEET ADMIRAL'];
export const RankNames = ['士官候補生', '少尉', '中尉', '大尉', '少佐', '中佐', '准将', '大将', '艦隊司令官'];

export class PinballRules {
  static startingBalls = 3;
  static ballSaveDuration = 10;
  static bonusCountDuration = 1.25;
  static rankProgressLights = 18;

  constructor() {
    /** Windows rule: a drain ends the selected / running mission. Settings can turn it off. */
    this.resetMissionOnDrain = true;
    this.phase = 'ready';
    this.awaitingRelaunch = false;
    this.skillShotAvailable = true; this.skillShotArmed = false; this.skillShotGates = new Set(); this.lastSkillShot = 0;
    this.score = 0;
    this.ballsRemaining = PinballRules.startingBalls; this.ballNumber = 1; this.extraBalls = 0; this.currentBallIsExtra = false;
    this.replayReady = false; this.centerBlockerTime = 0; this.spinnerBonusTime = 0;
    this.ballBonusAward = 0; this.ballBonusCounted = 0;
    this.bonusElapsed = 0; this.launchGateSeen = false; this.freshBall = true; this.gameStarted = false;
    this.bonusTimer = 0; this.jackpotTimer = 0; this.medalTimer = 30; this.reflexRamp = 0; this.reflexHyperspace = 0;
    this.rank = 0; this.rankProgress = 0; this.completedMissions = 0;
    this.selectedMission = null; this.activeMission = null; this.missionStep = 0; this.missionHits = 0;
    this.fuel = 100; this.multiplierIndex = 0; this.attackLevel = 0; this.launchLevel = 0;
    this.reentryLights = new Set(); this.launchLights = new Set(); this.missionLights = new Set();
    this.leftHazards = new Set(); this.rightHazards = new Set(); this.boosterLights = new Set();
    this.multiplierLights = new Set(); this.medalLights = new Set(); this.fuelLights = new Set(); this.returnLaneLights = new Set();
    this.bonusLaneLit = false; this.leftKickback = false; this.rightKickback = false;
    this.hyperspaceLevel = 0; this.wormholeDestination = null; this.shootAgain = 0; this.extraBallLit = 0; this.tilted = false;
    /** Game start value is 10,000; each drained ball resets it to 25,000 unless held. */
    this.bonus = 10_000; this.bonusEnabled = false; this.jackpotEnabled = false; this.jackpot = 20_000; this.bonusHeld = false;
    this.medalLevel = 0; this.gravityEnabled = false; this.maelstromFinale = false;
    this.message = '射出ボタンを長押しして、宇宙へ。'; this.messageTime = 5;
    this.attackTimer = 60; this.launchTimer = 60; this.multiplierTimer = 30; this.hyperspaceTimer = 60; this.tiltHeat = 0;
    this.feedback = [];
  }

  get multiplier() { return [1, 2, 3, 5, 10][this.multiplierIndex]; }
  get missionInstruction() {
    if (this.tilted) return 'TILT — フリッパー停止';
    if (this.activeMission) {
      const step = this.activeMission.steps[this.missionStep];
      return step.count > 1 ? `${step.instruction}  残り${step.count - this.missionHits}` : step.instruction;
    }
    if (this.selectedMission) return this.fuel > 0 ? `発射ランプで「${this.selectedMission.name}」を受諾` : '燃料切れ — 燃料レーンで補給してから受諾';
    return 'ミッションターゲットに当てて任務を選択';
  }
  get missionTitle() { return this.activeMission?.name ?? this.selectedMission?.name ?? 'ミッション待機中'; }

  get missionTargets() {
    if (this.tilted || this.phase === 'bonus' || this.phase === 'gameOver') return new Set();
    const mission = this.activeMission;
    if (!mission) return this.selectedMission ? new Set(['ramp']) : new Set([0, 1, 2].map((i) => E('missionTarget', i)));
    const unlit = (set, name) => new Set([0, 1, 2].filter((i) => !set.has(i)).map((i) => E(name, i)));
    const objective = mission.steps[this.missionStep].objective;
    switch (objective.type) {
      case 'attackUpgrade': return unlit(this.reentryLights, 'reentry');
      case 'launchUpgrade': return unlit(this.launchLights, 'launchLane');
      case 'leftHazards': return unlit(this.leftHazards, 'hazardLeft');
      case 'rightHazards': return unlit(this.rightHazards, 'hazardRight');
      case 'boosterBank': return unlit(this.boosterLights, 'booster');
      default:
        return new Set([...TableLayout.allEvents].filter((event) => {
          if (!accepts(objective, event)) return false;
          const k = kindOf(event), i = indexOf(event);
          if (k === 'booster') return !this.boosterLights.has(i);
          if (k === 'multiplier') return !this.multiplierLights.has(i);
          if (k === 'medal') return !this.medalLights.has(i);
          return true;
        }));
    }
  }

  newGame() { const keep = this.resetMissionOnDrain; Object.assign(this, new PinballRules()); this.resetMissionOnDrain = keep; }
  takeFeedback() { const f = this.feedback; this.feedback = []; return f; }
  announce(text, seconds = 3) { this.message = text; this.messageTime = seconds; }
  launch() {
    if (this.phase !== 'ready') return;
    this.phase = 'playing';
    this.skillShotArmed = this.skillShotAvailable;
    this.skillShotGates.clear(); this.launchGateSeen = false;
    const returning = this.awaitingRelaunch;
    this.awaitingRelaunch = false;
    if (this.freshBall) {
      // A new ball arms both outlane kickbacks and fills the tank.
      this.freshBall = false; this.leftKickback = true; this.rightKickback = true; this.fuel = 100;
    }
    if (!this.gameStarted) { this.gameStarted = true; this.feedback.push(new Feedback({ event: 'deployment', sound: 'gameStart' })); }
    this.announce(returning ? 'RELAUNCH — フライトを再開' : '射出ゲートを狙って SKILL SHOT');
    this.feedback.push(new Feedback({ event: 'deployment', sound: 'launch' }));
  }
  returnToShooter() {
    if (this.phase !== 'playing') return;
    this.phase = 'ready'; this.awaitingRelaunch = true; this.skillShotArmed = false;
    this.announce('球が射出レーンに戻りました。長押しで再射出', 100);
    this.feedback.push(new Feedback({ event: 'shooterReturn', sound: 'lane' }));
  }
  tick(dt) {
    if (this.phase === 'bonus') {
      this.bonusElapsed += dt;
      const counted = Math.trunc(this.ballBonusAward * Math.min(1, this.bonusElapsed / PinballRules.bonusCountDuration));
      this.score += counted - this.ballBonusCounted; this.ballBonusCounted = counted;
      if (this.bonusElapsed >= PinballRules.bonusCountDuration) this.finishDrainedBall();
      return;
    }
    if (this.phase !== 'playing') return;
    this.shootAgain = Math.max(0, this.shootAgain - dt);
    this.extraBallLit = Math.max(0, this.extraBallLit - dt);
    this.centerBlockerTime = Math.max(0, this.centerBlockerTime - dt);
    this.spinnerBonusTime = Math.max(0, this.spinnerBonusTime - dt);
    this.reflexRamp = Math.max(0, this.reflexRamp - dt); this.reflexHyperspace = Math.max(0, this.reflexHyperspace - dt);
    if (this.bonusEnabled) { this.bonusTimer -= dt; if (this.bonusTimer <= 0) this.bonusEnabled = false; }
    if (this.jackpotEnabled) { this.jackpotTimer -= dt; if (this.jackpotTimer <= 0) this.jackpotEnabled = false; }
    if (this.medalLevel > 0) { this.medalTimer -= dt; if (this.medalTimer <= 0) { this.medalLevel -= 1; this.medalTimer = 30; } }
    this.messageTime = Math.max(0, this.messageTime - dt);
    this.tiltHeat = Math.max(0, this.tiltHeat - dt * 0.32);
    if (this.activeMission) {
      // Touch adaptation: a full tank lasts 100 seconds of active play.
      const before = this.fuel;
      this.fuel = Math.max(0, this.fuel - dt);
      if (before > 100 / 12 && this.fuel <= 100 / 12) this.announce('燃料残りわずか — 燃料レーンへ');
      if (this.fuel === 0) {
        this.activeMission = null; this.missionStep = 0; this.missionHits = 0; this.maelstromFinale = false;
        this.announce('燃料切れ — 任務失敗。燃料を補給して再選択');
      }
    }
    this.attackTimer -= dt; this.launchTimer -= dt; this.multiplierTimer -= dt; this.hyperspaceTimer -= dt;
    if (this.attackTimer <= 0) { this.attackLevel = Math.max(0, this.attackLevel - 1); this.attackTimer = 60; }
    if (this.launchTimer <= 0) { this.launchLevel = Math.max(0, this.launchLevel - 1); this.launchTimer = 60; }
    if (this.multiplierTimer <= 0) { this.multiplierIndex = Math.max(0, this.multiplierIndex - 1); this.multiplierTimer = 30; }
    if (this.hyperspaceTimer <= 0) { this.hyperspaceLevel = Math.max(0, this.hyperspaceLevel - 1); this.hyperspaceTimer = 60; }
    this.revertExpiredMissionStep();
  }
  /** A decayed bumper or expired flag lamp sends the player back to rebuild the first condition. */
  revertExpiredMissionStep() {
    const m = this.activeMission;
    if (!m || this.missionStep !== 1) return;
    if ((m.id === 7 && this.launchLevel === 0) || (m.id === 11 && this.spinnerBonusTime <= 0)) {
      this.missionStep = 0; this.missionHits = 0;
      this.announce(`条件が切れました — ${m.steps[0].instruction}`);
    }
  }
  shiftLanes(right) {
    if (this.tilted) return;
    const offset = right ? 1 : 2;
    this.reentryLights = new Set([...this.reentryLights].map((v) => (v + offset) % 3));
    this.launchLights = new Set([...this.launchLights].map((v) => (v + offset) % 3));
  }
  nudge() {
    if (this.phase !== 'playing' || this.tilted) return false;
    this.tiltHeat += 1;
    if (this.tiltHeat >= 2.8) {
      this.tilted = true; this.shootAgain = 0; this.replayReady = false; this.centerBlockerTime = 0; this.activeMission = null;
      this.announce('TILT — 揺らしすぎです', 10);
      this.feedback.push(new Feedback({ event: 'wall', sound: 'tilt' }));
      return false;
    }
    this.announce('NUDGE  —  揺らしすぎに注意', 1);
    return true;
  }
  consumeKickback(left) {
    if (this.tilted) return false;
    if (left && this.leftKickback) { this.leftKickback = false; this.announce('KICKBACK'); this.feedback.push(new Feedback({ event: 'outlane:0', sound: 'kickback' })); return true; }
    if (!left && this.rightKickback) { this.rightKickback = false; this.announce('KICKBACK'); this.feedback.push(new Feedback({ event: 'outlane:1', sound: 'kickback' })); return true; }
    return false;
  }
  hit(event, impactSpeed = 180, position = null) {
    if (this.phase !== 'playing' || this.tilted) return;
    const before = this.score, previousCompleted = this.completedMissions, previousStep = this.missionStep, previousRank = this.rank;
    let sound = 'target', pitch = 1, startedMission = false;
    const kind = kindOf(event), i = indexOf(event);
    switch (kind) {
      case 'deploymentGate': {
        if (!(i >= 0 && i < 6) || !(i === 0 || this.skillShotGates.has(i - 1)) || this.skillShotGates.has(i)) return;
        if (i === 0 && !this.launchGateSeen) {
          // Gate 1 lights Shoot Again, both reflex shots and refuels the ship.
          this.launchGateSeen = true; this.shootAgain = PinballRules.ballSaveDuration; this.reflexRamp = 5; this.reflexHyperspace = 5; this.fuel = 100;
        }
        this.skillShotGates.add(i);
        this.feedback.push(new Feedback({ event, sound: 'lane', impactSpeed, position, pitch: 1 + i * 0.08 }));
        return;
      }
      case 'deploymentExit': {
        if (!this.skillShotArmed) return;
        this.skillShotArmed = false; this.skillShotAvailable = false;
        if (this.skillShotGates.size === 0) return;
        const value = [15_000, 30_000, 75_000, 30_000, 15_000, 7_500][this.skillShotGates.size - 1];
        const b = this.score; this.add(value); this.lastSkillShot = this.score - b;
        this.announce(`SKILL SHOT  +${fmt(this.lastSkillShot)}`);
        this.feedback.push(new Feedback({ event, points: this.lastSkillShot, sound: 'skillShot' }));
        return;
      }
      case 'attack': this.add([500, 1_000, 1_500, 2_000][this.attackLevel]); sound = 'bumper'; break;
      case 'launchBumper': this.add([1_500, 2_500, 3_500, 4_500][this.launchLevel]); sound = 'bumper'; break;
      case 'reentry':
        this.add(2_000); toggle(i, this.reentryLights); sound = 'lane';
        if (this.reentryLights.size === 3) {
          this.reentryLights.clear(); this.attackTimer = 60;
          if (this.attackLevel < 3) { this.attackLevel += 1; sound = 'upgrade'; this.announce('ATTACK BUMPERS  UPGRADED'); }
        }
        break;
      case 'launchLane':
        this.add(500); toggle(i, this.launchLights); sound = 'lane';
        if (this.launchLights.size === 3) {
          this.launchLights.clear(); this.launchTimer = 60;
          if (this.launchLevel < 3) { this.launchLevel += 1; sound = 'upgrade'; this.announce('LAUNCH BUMPERS  UPGRADED'); }
        }
        break;
      case 'missionTarget':
        this.add(1_000); this.missionLights.add(i);
        if (!this.activeMission) {
          const next = selectMission(this.rank, i, this.missionLights.size === 3);
          if (this.selectedMission?.id !== next.id) sound = 'missionSelect';
          this.selectedMission = next;
          this.announce(`${next.name}を選択 — 発射ランプで受諾`);
          if (this.missionLights.size === 3) this.missionLights.clear();
        }
        break;
      case 'ramp':
        if (this.reflexRamp > 0) { this.add(25_000, true); this.reflexRamp = 0; sound = 'reflex'; this.announce('REFLEX SHOT  +25,000'); }
        else { this.add(5_000); sound = 'ramp'; }
        if (!this.activeMission && this.selectedMission && this.fuel > 0) {
          const mission = this.selectedMission;
          this.activeMission = mission; this.selectedMission = null; this.missionStep = 0; this.missionHits = 0;
          this.missionLights.clear();
          this.add(mission.acceptanceScore, true); startedMission = true;
          this.prepare(mission);
          this.announce(`MISSION ACCEPTED  ·  ${mission.name}`); sound = 'missionStart';
        }
        break;
      case 'fuelTarget':
        this.add(750); this.fuelLights.add(i);
        if (this.fuelLights.size === 3) { this.fuel = 100; this.fuelLights.clear(); sound = 'fuel'; this.announce('REFUELED — 燃料補給完了'); }
        break;
      case 'fuel': {
        this.add(500); sound = 'lane';
        const level = (i + 1) / 6 * 100;
        if (this.fuel < level) { this.fuel = level; sound = 'fuel'; this.announce('REFUELING'); }
        break;
      }
      case 'bonusLane':
        // The bonus lane pays the current bonus after a mission lights it.
        if (this.bonusLaneLit) { this.add(this.bonus, true); this.bonusLaneLit = false; sound = 'jackpot'; this.announce(`BONUS  +${fmt(this.bonus)}`); }
        else { this.add(10_000); sound = 'fuel'; this.announce('REFUELED'); }
        this.fuel = 100;
        break;
      case 'booster':
        if (this.boosterLights.has(i)) return;
        this.boosterLights.add(i); sound = 'dropTarget';
        if (this.boosterLights.size === 3) {
          this.boosterLights.clear();
          if (this.spinnerBonusTime <= 0) { this.spinnerBonusTime = 60; this.announce('FLAGS LIT — スピナー強化'); }
          else if (!this.jackpotEnabled) { this.jackpotEnabled = true; this.jackpotTimer = 60; this.announce('JACKPOT ACTIVATED'); }
          else if (!this.bonusEnabled) { this.bonusEnabled = true; this.bonusTimer = 60; this.announce('BONUS ACTIVATED'); }
          else if (!this.bonusHeld) { this.bonusHeld = true; this.announce('BONUS HOLD'); }
          sound = 'upgrade';
          this.add(5_000);
        } else this.add(500);
        break;
      case 'multiplier':
        if (this.multiplierLights.has(i)) return;
        this.multiplierLights.add(i); sound = 'dropTarget';
        if (this.multiplierLights.size === 3) {
          this.add(1_500); this.multiplierLights.clear(); this.multiplierIndex = Math.min(4, this.multiplierIndex + 1); this.multiplierTimer = 30;
          sound = 'upgrade'; this.announce(`FIELD MULTIPLIER  ×${this.multiplier}`);
        } else this.add(500);
        break;
      case 'medal':
        if (this.medalLights.has(i)) return;
        this.medalLights.add(i); sound = 'dropTarget';
        if (this.medalLights.size === 3) {
          this.medalLights.clear(); sound = 'upgrade';
          if (this.medalLevel === 0) { this.add(10_000); this.announce('COMMENDATION  +10,000'); }
          else if (this.medalLevel === 1) { this.add(50_000); this.announce('MEDAL  +50,000'); }
          else this.awardExtraBall();
          this.medalLevel = Math.min(3, this.medalLevel + 1); this.medalTimer = 30;
        } else this.add(1_500);
        break;
      case 'hazardLeft':
        this.add(750); this.leftHazards.add(i);
        if (this.leftHazards.size === 3 && !this.leftKickback) {
          this.leftKickback = true; sound = 'upgrade'; this.announce('LEFT KICKBACK READY');
          // Space Radiation: a full left bank opens a wormhole to aim for.
          if (this.activeMission?.id === 8 && this.wormholeDestination === null) this.wormholeDestination = 0;
        }
        break;
      case 'hazardRight':
        this.add(750); this.rightHazards.add(i);
        if (this.rightHazards.size === 3 && !this.rightKickback) { this.rightKickback = true; sound = 'upgrade'; this.announce('RIGHT KICKBACK READY'); }
        break;
      case 'destination':
        this.add(750); this.wormholeDestination = ((this.wormholeDestination ?? -1) + 1) % 3; this.announce('WORMHOLE OPENED');
        break;
      case 'wormhole':
        this.add(this.wormholeDestination === null ? 2_500 : this.wormholeDestination === i ? 5_000 : 7_500);
        if (this.wormholeDestination === i) { this.replayReady = true; this.announce('REPLAY AWARDED — 次の落球を救済'); }
        this.wormholeDestination = null;
        sound = 'wormhole';
        break;
      case 'hyperspace': {
        const stage = this.hyperspaceLevel + 1;
        this.hyperspaceLevel = stage % 5; this.hyperspaceTimer = 60; sound = 'hyperspace'; pitch = [1, 1.09, 1.19, 1.3, 1.42][stage - 1];
        switch (stage) {
          case 1: this.add(10_000); this.announce('HYPERSPACE BONUS'); break;
          case 2: this.add(this.jackpot, true); this.announce(`JACKPOT  +${fmt(this.jackpot)}`); this.jackpot = 20_000; sound = 'jackpot'; break;
          case 3: this.add(20_000); this.centerBlockerTime = 30; this.announce('CENTER POST — 落球ブロック'); break;
          case 4: this.add(50_000); this.extraBallLit = 60; this.announce('EXTRA BALL LIT — アウトレーンで獲得'); break;
          default: this.add(150_000); this.gravityEnabled = true; this.announce('GRAVITY WELL ACTIVATED');
        }
        if (this.reflexHyperspace > 0) { this.add(25_000, true); this.announce('REFLEX SHOT  +25,000'); }
        this.reflexHyperspace = 5;
        if (this.maelstromFinale) this.awardMaelstromFinale();
        break;
      }
      case 'blackHole': this.add(20_000); sound = 'blackHole'; this.announce(`BLACK HOLE  +${fmt(20_000 * this.multiplier)}`); break;
      case 'gravityWell':
        if (this.gravityEnabled) { this.add(50_000); this.gravityEnabled = false; this.announce(`GRAVITY WELL  +${fmt(50_000 * this.multiplier)}`); }
        sound = 'gravityWell';
        break;
      case 'spinner': this.add(this.spinnerBonusTime > 0 ? 2_500 : 500); sound = 'spinner'; break;
      case 'returnLane':
        // Space Warp lights both return lanes; a lit lane pays the higher value.
        if (this.returnLaneLights.has(i)) { this.add(20_000); this.returnLaneLights.clear(); } else this.add(5_000);
        sound = 'lane';
        break;
      case 'outlane':
        this.add(20_000); sound = 'outlane';
        if (this.extraBallLit > 0) { this.extraBallLit = 0; this.awardExtraBall(); }
        break;
      case 'spaceWarp': this.returnLaneLights = new Set([0, 1]); sound = 'warp'; this.announce('SPACE WARP — リターンレーン点灯'); break;
      case 'sling': this.add(500); sound = 'sling'; break;
      case 'wall': sound = 'metal'; break;
      case 'flipper': sound = 'flipper'; break;
      case 'passage': this.feedback.push(new Feedback({ event, sound: 'lane', impactSpeed, position })); return;
      case 'centerPost': sound = 'metal'; break;
      default: break;
    }
    if (!startedMission) this.advanceMission(event);
    if (this.rank !== previousRank) sound = 'rankUp';
    else if (this.completedMissions > previousCompleted) sound = 'missionComplete';
    else if (this.missionStep !== previousStep && this.activeMission) {
      sound = 'missionStep'; this.announce(`次の目標 — ${this.activeMission.steps[this.missionStep].instruction}`);
    }
    this.feedback.push(new Feedback({ event, points: this.score - before, sound, impactSpeed, position, pitch }));
  }
  /** Mission start resets the hardware each Windows controller uses. */
  prepare(mission) {
    switch (mission.id) {
      case 6: this.rightHazards.clear(); break;
      case 7: this.launchLevel = 0; break;
      case 8: this.leftHazards.clear(); break;
      case 10: this.attackLevel = 0; break;
      case 11: this.boosterLights.clear(); this.spinnerBonusTime = 0; break;
      case 15: this.spinnerBonusTime = Math.max(this.spinnerBonusTime, 60); break;
      default: break;
    }
  }
  advanceMission(event) {
    const mission = this.activeMission;
    if (!mission) return;
    const objective = mission.steps[this.missionStep].objective;
    let matches = accepts(objective, event);
    switch (objective.type) {
      case 'attackUpgrade': matches = this.attackLevel > 0; break;
      case 'launchUpgrade': matches = this.launchLevel > 0; break;
      case 'leftHazards': matches = this.leftHazards.size === 3; break;
      case 'rightHazards': matches = this.rightHazards.size === 3; break;
      case 'boosterBank': matches = kindOf(event) === 'booster' && this.boosterLights.size === 0 && this.spinnerBonusTime > 0; break;
      default: break;
    }
    if (!matches) return;
    this.missionHits += 1;
    if (this.missionHits < mission.steps[this.missionStep].count) return;
    if (this.missionStep + 1 < mission.steps.length) {
      this.missionStep += 1; this.missionHits = 0;
      if (mission.id === 18 && this.missionStep === mission.steps.length - 1) this.maelstromFinale = true;
      return;
    }
    this.maelstromFinale = false;
    this.add(mission.reward, true);
    this.completedMissions += 1;
    if (mission.id === 17) {
      // Time Warp: the ramp sends you forward a rank, Hyperspace sends you back.
      if (event === 'hyperspace') this.rank = Math.max(0, this.rank - 1);
      else { this.rank = Math.min(8, this.rank + 1); this.addRankProgress(mission.rankProgress); }
    } else this.addRankProgress(mission.rankProgress);
    this.activeMission = null; this.selectedMission = null; this.missionStep = 0; this.missionHits = 0;
    if (this.message.startsWith('PROMOTION') && this.messageTime > 0) return;
    this.announce(`MISSION COMPLETED  +${fmt(mission.reward)}`, 5);
  }
  addRankProgress(lights) {
    this.bonusLaneLit = true;
    this.rankProgress += lights;
    if (this.rankProgress >= PinballRules.rankProgressLights) {
      this.rankProgress = 0;
      if (this.rank < 8) { this.rank += 1; this.announce(`PROMOTION — ${Ranks[this.rank]}（${RankNames[this.rank]}）`, 6); }
    }
  }
  /** Maelstrom's last Hyperspace lights every award on the table at once. */
  awardMaelstromFinale() {
    this.multiplierIndex = 4; this.multiplierTimer = 30;
    this.jackpotEnabled = true; this.jackpotTimer = 60; this.bonusEnabled = true; this.bonusTimer = 60;
    this.spinnerBonusTime = 60; this.bonusHeld = true; this.returnLaneLights = new Set([0, 1]);
    this.extraBallLit = 60; this.centerBlockerTime = 30; this.gravityEnabled = true;
    this.medalLights = new Set([0, 1, 2]); this.medalLevel = 3;
    this.jackpot = Math.max(this.jackpot, 100_000); this.bonus = Math.max(this.bonus, 100_000);
  }
  pathReleased(kind) { if (kind === 'ramp') this.reflexRamp = 5; }
  awardExtraBall() {
    this.extraBalls += 1;
    this.announce('EXTRA BALL — 追加球を獲得');
    this.feedback.push(new Feedback({ event: 'extraBall', sound: 'extraBall' }));
  }
  drain() {
    if (this.phase !== 'playing') return;
    if (!this.tilted && (this.shootAgain > 0 || this.replayReady)) {
      if (this.shootAgain > 0) this.shootAgain = 0; else this.replayReady = false;
      this.phase = 'ready'; this.awaitingRelaunch = true; this.skillShotArmed = false;
      this.announce('SHOOT AGAIN — 球を失わずに再射出', 100);
      this.feedback.push(new Feedback({ event: 'ballSaved', sound: 'ballSave' }));
      return;
    }
    this.feedback.push(new Feedback({ event: 'drain', sound: 'drain' }));
    this.phase = 'bonus'; this.bonusElapsed = 0; this.ballBonusAward = this.tilted ? 0 : this.bonus; this.ballBonusCounted = 0;
    this.awaitingRelaunch = false; this.skillShotArmed = false; this.shootAgain = 0;
    this.announce(`BALL BONUS  +${fmt(this.ballBonusAward)}`, 100);
    this.feedback.push(new Feedback({ event: 'ballBonus', points: this.ballBonusAward, sound: 'bonus' }));
  }
  finishDrainedBall() {
    if (this.extraBalls > 0) { this.extraBalls -= 1; this.currentBallIsExtra = true; this.phase = 'ready'; }
    else {
      this.ballsRemaining = Math.max(0, this.ballsRemaining - 1); this.currentBallIsExtra = false;
      if (this.ballsRemaining > 0) { this.ballNumber += 1; this.phase = 'ready'; } else this.phase = 'gameOver';
    }
    if (this.bonusHeld) this.bonusHeld = false; else this.bonus = 25_000;
    this.bonusEnabled = false; this.jackpotEnabled = false; this.spinnerBonusTime = 0; this.bonusTimer = 0; this.jackpotTimer = 0;
    this.centerBlockerTime = 0; this.extraBallLit = 0; this.reflexRamp = 0; this.reflexHyperspace = 0; this.replayReady = false;
    this.tilted = false; this.tiltHeat = 0; this.skillShotAvailable = true; this.skillShotGates.clear(); this.lastSkillShot = 0;
    this.resetTableForNextBall();
    if (this.phase === 'gameOver') {
      this.announce('GAME OVER — フリッパーでリスタート', 100);
      this.feedback.push(new Feedback({ event: 'drain', sound: 'gameOver' }));
    } else this.announce(this.currentBallIsExtra ? 'SHOOT AGAIN — 追加球で続行' : `BALL ${this.ballNumber} — 残り${this.ballsRemaining}球`, 100);
  }
  /** Every lamp group on the table resets; score, rank and the jackpot value persist. */
  resetTableForNextBall() {
    this.freshBall = true;
    this.attackLevel = 0; this.launchLevel = 0; this.attackTimer = 60; this.launchTimer = 60;
    for (const s of [this.reentryLights, this.launchLights, this.missionLights, this.leftHazards, this.rightHazards, this.boosterLights, this.multiplierLights, this.medalLights, this.fuelLights, this.returnLaneLights]) s.clear();
    this.bonusLaneLit = false;
    this.multiplierIndex = 0; this.multiplierTimer = 30; this.medalLevel = 0; this.medalTimer = 30;
    this.hyperspaceLevel = 0; this.hyperspaceTimer = 60; this.wormholeDestination = null; this.gravityEnabled = false;
    this.leftKickback = false; this.rightKickback = false; this.maelstromFinale = false;
    if (this.resetMissionOnDrain) { this.selectedMission = null; this.activeMission = null; this.missionStep = 0; this.missionHits = 0; }
    else if (this.activeMission?.id === 18 && this.missionStep === this.activeMission.steps.length - 1) this.maelstromFinale = true;
  }
  add(points, special = false) {
    this.score += points * (special ? 1 : this.multiplier);
    if (!special) {
      if (this.bonusEnabled) this.bonus = Math.min(5_000_000, this.bonus + points);
      if (this.jackpotEnabled) this.jackpot = Math.min(5_000_000, this.jackpot + points);
    }
  }
}
function toggle(value, set) { if (set.has(value)) set.delete(value); else set.add(value); }
