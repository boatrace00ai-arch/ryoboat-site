// Port of SpacePinball/Game/Core/Missions.swift.
import { kindOf, indexOf } from './geometry.js';

const pairs = {
  attack: ['attack'], ramp: ['ramp'], reentry: ['reentry'],
  dropTarget: ['booster', 'medal', 'multiplier'],
  anyTarget: ['booster', 'medal', 'multiplier', 'missionTarget', 'fuelTarget', 'hazardLeft', 'hazardRight', 'destination'],
  spotTarget: ['missionTarget', 'fuelTarget', 'hazardLeft', 'hazardRight', 'destination'],
  lane: ['reentry', 'launchLane', 'returnLane', 'outlane', 'bonusLane'],
  outlane: ['outlane'], spinner: ['spinner'], spaceWarp: ['spaceWarp'], blackHole: ['blackHole'],
  hyperspace: ['hyperspace'], wormhole: ['wormhole'], rampOrHyperspace: ['ramp', 'hyperspace'], rebound: ['sling'],
};

// Objective: { type, color? }. Hardware objectives (upgrades, banks) are judged by the rules.
export function accepts(objective, event) {
  const kind = kindOf(event);
  switch (objective.type) {
    case 'satellite': return event === 'attack:3';
    case 'fullFuel': return event === 'fuel:5';
    case 'coloredWormhole': return kind === 'wormhole' && indexOf(event) === objective.color;
    default: return (pairs[objective.type] || []).includes(kind);
  }
}

const O = (type, extra = {}) => ({ type, ...extra });
const S = (objective, count, instruction) => ({ objective, count, instruction });

export const Missions = [
  { id: 2, name: '射撃訓練', english: 'TARGET PRACTICE', reward: 500_000, rankProgress: 6, steps: [S(O('attack'), 8, '上部バンパーに当てる')] },
  { id: 3, name: '発射訓練', english: 'LAUNCH TRAINING', reward: 500_000, rankProgress: 6, steps: [S(O('ramp'), 3, '左の発射ランプを通す')] },
  { id: 4, name: '再突入訓練', english: 'REENTRY TRAINING', reward: 500_000, rankProgress: 6, steps: [S(O('reentry'), 3, '上部の再突入レーンを通す')] },
  { id: 5, name: '科学調査', english: 'SCIENCE MISSION', reward: 750_000, rankProgress: 9, steps: [S(O('dropTarget'), 9, 'ドロップターゲットに当てる')] },
  { id: 6, name: '迷走彗星', english: 'STRAY COMET', reward: 1_000_000, rankProgress: 8, steps: [S(O('rightHazards'), 1, '右ハザード3個を点灯'), S(O('hyperspace'), 1, 'ハイパースペースに入れる')] },
  { id: 7, name: 'ブラックホールの脅威', english: 'BLACK HOLE THREAT', reward: 1_000_000, rankProgress: 8, steps: [S(O('launchUpgrade'), 1, '左バンパーをアップグレード'), S(O('blackHole'), 1, '左ランプ下のブラックホールに入れる')] },
  { id: 8, name: '宇宙放射線', english: 'SPACE RADIATION', reward: 1_000_000, rankProgress: 8, steps: [S(O('leftHazards'), 1, '左ハザード3個を点灯'), S(O('wormhole'), 1, 'ワームホールに入れる')] },
  { id: 9, name: 'バグハント', english: 'BUG HUNT', reward: 750_000, rankProgress: 7, steps: [S(O('anyTarget'), 15, '各種ターゲットに当てる')] },
  { id: 10, name: 'エイリアンの脅威', english: 'ALIEN MENACE', reward: 750_000, rankProgress: 7, steps: [S(O('attackUpgrade'), 1, '上部バンパーをアップグレード'), S(O('attack'), 8, '上部バンパーに当てる')] },
  { id: 11, name: '救助任務', english: 'RESCUE MISSION', reward: 750_000, rankProgress: 7, steps: [S(O('boosterBank'), 1, 'ブースター3個を倒す'), S(O('hyperspace'), 1, 'ハイパースペースに入れる')] },
  { id: 12, name: '人工衛星', english: 'SATELLITE', reward: 1_250_000, rankProgress: 9, steps: [S(O('satellite'), 3, '左上の独立したバンパーに当てる')] },
  { id: 13, name: '偵察任務', english: 'RECONNAISSANCE', reward: 1_250_000, rankProgress: 9, steps: [S(O('lane'), 15, '各レーンを通過する')] },
  { id: 14, name: '終末装置', english: 'DOOMSDAY MACHINE', reward: 1_250_000, rankProgress: 9, steps: [S(O('outlane'), 3, 'アウトレーンを通過する')] },
  { id: 15, name: '宇宙の疫病', english: 'COSMIC PLAGUE', reward: 1_750_000, rankProgress: 11, steps: [S(O('spinner'), 75, 'スピナーを回す'), S(O('spaceWarp'), 1, 'スペースワープを通す')] },
  { id: 16, name: '秘密任務', english: 'SECRET MISSION', reward: 1_500_000, rankProgress: 10, steps: [S(O('coloredWormhole', { color: 2 }), 1, '黄ワームホールに入れる'), S(O('coloredWormhole', { color: 0 }), 1, '赤ワームホールに入れる'), S(O('coloredWormhole', { color: 1 }), 1, '緑ワームホールに入れる')] },
  { id: 17, name: 'タイムワープ', english: 'TIME WARP', reward: 2_000_000, rankProgress: 12, steps: [S(O('rebound'), 25, 'リバウンダーに当てる'), S(O('rampOrHyperspace'), 1, 'ランプで未来／ハイパーで過去へ')] },
  { id: 18, name: 'メイルストロム', english: 'MAELSTROM', reward: 5_000_000, rankProgress: 18, steps: [S(O('dropTarget'), 3, 'ドロップターゲットを倒す'), S(O('spotTarget'), 3, 'スポットターゲットに当てる'), S(O('lane'), 5, 'レーンを通す'), S(O('fullFuel'), 1, '燃料レーンを最上部まで通す'), S(O('ramp'), 1, '発射ランプを通す'), S(O('spinner'), 1, 'スピナーを回す'), S(O('wormhole'), 1, 'ワームホールに入れる'), S(O('hyperspace'), 1, 'ハイパースペースに入れる')] },
].map((m) => ({ ...m, acceptanceScore: m.id < 6 ? 10_000 : m.id < 15 ? 20_000 : 30_000 }));

export const findMission = (id) => Missions.find((m) => m.id === id);
export const SelectionRows = [[3, 4, 2, 5], [9, 11, 10, 16], [6, 8, 7, 15], [12, 13, 14, 17], [15, 16, 17, 18]];
export function selectMission(rank, target, allLit) {
  const tier = rank === 0 ? 0 : rank < 3 ? 1 : rank < 5 ? 2 : rank < 7 ? 3 : 4;
  return findMission(SelectionRows[tier][allLit ? 3 : Math.max(0, Math.min(2, target))]);
}
