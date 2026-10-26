import { describe, expect, it } from 'vitest';
import { getCharacter } from '../src/game/data';
import { craftedStatModifiers } from '../src/game/crafting';
import {
  FREE_SKILL_S01_DAMAGE_PER_SECOND,
  FREE_SKILL_S04_DAMAGE_PER_SECOND,
  FREE_SKILL_S08_DAMAGE_PER_SECOND,
} from '../src/game/free-skill-effects';
import { itemStatModifiers } from '../src/game/item-effects';
import {
  SUSTAINED_CHANNEL_REQUIRED_NOTE,
  SUSTAINED_DAMAGE_SKILL_IDS,
  directDamageMultiplierOf,
  isSustainedDamageSkill,
  sustainedChannelNote,
  sustainedDamageMultiplierOf,
  sustainedDamageSourceLabels,
} from '../src/game/damage-channel';
import {
  StatAggregator,
  characterBaseStats,
  type ComputedStats,
} from '../src/game/stats';

function statsWith(
  items: Record<string, number> = {},
  crafted: readonly string[] = [],
): ComputedStats {
  const stats = new StatAggregator(characterBaseStats(getCharacter('vishdal')));
  for (const [id, stacks] of Object.entries(items)) {
    stats.setSource(`item:${id}`, itemStatModifiers(id, stacks));
  }
  for (const id of crafted) {
    stats.setSource(`craft:${id}`, craftedStatModifiers(id));
  }
  return stats.snapshot();
}

function sustainedDamage(
  basePerSecond: number,
  stats: ComputedStats,
): number {
  return basePerSecond * sustainedDamageMultiplierOf(stats);
}

describe('持续伤害通道', () => {
  it('只有 S01/S04/S08 走持续通道', () => {
    expect([...SUSTAINED_DAMAGE_SKILL_IDS]).toEqual(['S01', 'S04', 'S08']);
    for (const id of SUSTAINED_DAMAGE_SKILL_IDS) {
      expect(isSustainedDamageSkill(id), id).toBe(true);
    }
    for (const id of ['S02', 'S03', 'S05', 'S06', 'S07', 'S09', 'S10', 'S11', 'S12']) {
      expect(isSustainedDamageSkill(id), id).toBe(false);
    }
  });

  it('卡面前置：无持续技能写「需持续类技能」，有则按目录顺序列出来源', () => {
    expect(sustainedChannelNote([])).toBe(SUSTAINED_CHANNEL_REQUIRED_NOTE);
    expect(sustainedChannelNote(['S02', 'S05'])).toBe(
      SUSTAINED_CHANNEL_REQUIRED_NOTE,
    );
    expect(sustainedDamageSourceLabels(['S08', 'S01', 'S04'])).toEqual([
      'S01 旋刃环',
      'S04 燃烧轨迹',
      'S08 重力井',
    ]);
    expect(sustainedChannelNote(['S08', 'S01'])).toBe(
      '影响 S01 旋刃环、S08 重力井',
    );
  });

  it('无道具时持续伤害等于基准，S01/S04/S08 分别取各自每秒伤害', () => {
    const stats = statsWith();
    expect(sustainedDamageMultiplierOf(stats)).toBeCloseTo(1, 12);
    expect(sustainedDamage(FREE_SKILL_S01_DAMAGE_PER_SECOND, stats)).toBe(45);
    expect(sustainedDamage(FREE_SKILL_S04_DAMAGE_PER_SECOND, stats)).toBe(22);
    expect(sustainedDamage(FREE_SKILL_S08_DAMAGE_PER_SECOND, stats)).toBe(18);
  });

  it('I16 只乘持续通道，直接伤害 −5% 不进入持续倍率', () => {
    const stats = statsWith({ I16: 1 });
    expect(stats.damageOverTimeMultiplier).toBeCloseTo(1.25, 12);
    expect(stats.directDamageMultiplier).toBeCloseTo(0.95, 12);
    expect(sustainedDamageMultiplierOf(stats)).toBeCloseTo(1.25, 12);

    expect(sustainedDamage(FREE_SKILL_S01_DAMAGE_PER_SECOND, stats)).toBeCloseTo(
      56.25,
      12,
    );
    expect(sustainedDamage(FREE_SKILL_S04_DAMAGE_PER_SECOND, stats)).toBeCloseTo(
      27.5,
      12,
    );
    expect(sustainedDamage(FREE_SKILL_S08_DAMAGE_PER_SECOND, stats)).toBeCloseTo(
      22.5,
      12,
    );
  });

  it('R02 只乘持续通道，与 I16 叠乘且每个加成只进入一次', () => {
    const r02 = statsWith({}, ['R02']);
    expect(r02.recipeDamageOverTimeMultiplier).toBeCloseTo(1.3, 12);
    expect(r02.damageOverTimeMultiplier).toBeCloseTo(1, 12);
    expect(sustainedDamageMultiplierOf(r02)).toBeCloseTo(1.3, 12);

    const both = statsWith({ I16: 1 }, ['R02']);
    expect(sustainedDamageMultiplierOf(both)).toBeCloseTo(1.25 * 1.3, 12);
    // 叠乘而不是加算：1.25 + 0.3 = 1.55 是错误口径。
    expect(sustainedDamageMultiplierOf(both)).not.toBeCloseTo(1.55, 6);
    expect(sustainedDamage(FREE_SKILL_S01_DAMAGE_PER_SECOND, both)).toBeCloseTo(
      73.125,
      12,
    );
  });

  it('I16 多层与 R02 叠乘：1.75 × 1.3，不重复计同一来源', () => {
    const stats = new StatAggregator(
      characterBaseStats(getCharacter('vishdal')),
    );
    // 同来源重复注册只保留最后一次，不会再叠一次 I16。
    stats.setSource('item:I16', itemStatModifiers('I16', 3));
    stats.setSource('item:I16', itemStatModifiers('I16', 3));
    stats.setSource('craft:R02', craftedStatModifiers('R02'));
    const snapshot = stats.snapshot();
    expect(sustainedDamageMultiplierOf(snapshot)).toBeCloseTo(1.75 * 1.3, 12);
    expect(sustainedDamage(FREE_SKILL_S08_DAMAGE_PER_SECOND, snapshot)).toBeCloseTo(
      40.95,
      12,
    );
  });

  it('直击不受持续加成影响，只吃 I16 的直接伤害 −5%', () => {
    const stats = statsWith({ I16: 1 }, ['R02']);
    // J 与技能路径都走 directDamageMultiplierOf；R02 不提供直击加成。
    expect(directDamageMultiplierOf(stats)).toBeCloseTo(0.95, 12);
    expect(
      directDamageMultiplierOf(stats, stats.normalAttackDamageMultiplier),
    ).toBeCloseTo(0.95, 12);
    expect(
      directDamageMultiplierOf(stats, stats.skillDamageMultiplier),
    ).toBeCloseTo(0.95, 12);
    // 榴弹爆炸沿用 J 倍率，同样不读取 damageOverTime。
    expect(directDamageMultiplierOf(stats) * 100).toBeCloseTo(95, 12);
  });

  it('持续通道与直击通道互不串味：I16 的 +25% 不出现在直击，−5% 不出现在持续', () => {
    const stats = statsWith({ I16: 1 });
    expect(directDamageMultiplierOf(stats)).toBeCloseTo(0.95, 12);
    expect(sustainedDamageMultiplierOf(stats)).toBeCloseTo(1.25, 12);
    expect(directDamageMultiplierOf(stats)).not.toBeCloseTo(1.25, 6);
    expect(sustainedDamageMultiplierOf(stats)).not.toBeCloseTo(0.95, 6);
  });

  it('没有持续加成的成品不改变通道倍率', () => {
    const stats = statsWith({}, ['R01', 'R03']);
    expect(stats.recipeDamageOverTimeMultiplier).toBe(1);
    expect(sustainedDamageMultiplierOf(stats)).toBe(1);
    expect(directDamageMultiplierOf(stats)).toBe(1);
  });
});
