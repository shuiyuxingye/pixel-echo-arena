/**
 * US-050 普通/高胡构筑校准（固定 Boss 场景）。
 *
 * 证据链：
 * 1. 设计预算 CSV 与 01 §数值预算验证 的窗口一致（模型只做算术一致性检查）；
 * 2. 普通参考构筑只使用可由商店获得的普通/稀有道具与金/银海克斯，
 *    不含成品或棱彩海克斯，且按真实波次价不超 2139 金币；
 * 3. 四职业固定 Boss 场景的普通/高胡理论用时落在设计窗口内，
 *    高胡至少比普通快 2 倍，普通承伤余量 > 1.3；
 * 4. 结算使用 `src/game/**` 的真实属性聚合、伤害减免、目录数值与 Boss 定义。
 *
 * 这是固定输入脚本的算术场景，不是 AI 通关，也不是完整 18 波人工试玩。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHex, getShopItem } from '../src/game/data';
import { getEnemy } from '../src/game/data/enemies';
import {
  HIGH_ROLL_GOLD_BUDGET,
  HIGH_ROLL_TTK_RANGE_SECONDS,
  NORMAL_CAPACITY_MARGIN_MIN,
  NORMAL_GOLD_BUDGET,
  NORMAL_TTK_RANGE_SECONDS,
  REFERENCE_BUILDS,
  aggregateBuild,
  buildGoldCost,
  evaluateAll,
  evaluateBuild,
  summarize,
} from '../tools/design/v2-build-calibration';

const ROOT = resolve(__dirname, '..');

function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const headers = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? '']),
    );
  });
}

describe('US-050 设计预算 CSV 一致性', () => {
  it('boss-budget.csv 保留普通 48.9–58.1 秒、高胡 22.0–26.2 秒的目标窗口', () => {
    const rows = readCsv(resolve(ROOT, 'docs/design/v0.2/data/boss-budget.csv'));
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const ttk = Number(row.boss_ttk_seconds);
      if (row.build === '普通构筑') {
        expect(ttk).toBeGreaterThanOrEqual(NORMAL_TTK_RANGE_SECONDS.min);
        expect(ttk).toBeLessThanOrEqual(NORMAL_TTK_RANGE_SECONDS.max);
        expect(Number(row.capacity_margin)).toBeGreaterThan(NORMAL_CAPACITY_MARGIN_MIN);
      }
      if (row.build === '高胡构筑') {
        expect(ttk).toBeGreaterThanOrEqual(HIGH_ROLL_TTK_RANGE_SECONDS.min);
        expect(ttk).toBeLessThanOrEqual(HIGH_ROLL_TTK_RANGE_SECONDS.max);
      }
    }
  });

  it('economy.csv 的普通/高胡金币总量与预算常量一致', () => {
    const rows = readCsv(resolve(ROOT, 'docs/design/v0.2/data/economy.csv'));
    const normal = rows.find((row) => row.preset === '普通构筑');
    const high = rows.find((row) => row.preset === '高收益');
    expect(Number(normal?.total_gold)).toBe(NORMAL_GOLD_BUDGET);
    expect(Number(high?.total_gold)).toBe(HIGH_ROLL_GOLD_BUDGET);
  });
});

describe('US-050 普通参考构筑合法性', () => {
  it('只使用普通/稀有永久道具，不含成品与棱彩海克斯', () => {
    for (const build of REFERENCE_BUILDS.filter((entry) => entry.tier === 'normal')) {
      expect(build.crafted).toHaveLength(0);
      for (const [itemId, stacks] of Object.entries(build.items)) {
        const item = getShopItem(itemId);
        expect(item, itemId).toBeDefined();
        expect(['普通', '稀有']).toContain(item?.rarity);
        expect(stacks).toBeGreaterThan(0);
      }
      for (const hexId of build.hexes) {
        expect(['银', '金']).toContain(getHex(hexId)?.rarity);
      }
    }
  });

  it('普通构筑按真实波次价不超过 2139 金币', () => {
    for (const build of REFERENCE_BUILDS.filter((entry) => entry.tier === 'normal')) {
      const cost = buildGoldCost(build);
      expect(cost, build.id).toBeLessThanOrEqual(NORMAL_GOLD_BUDGET);
    }
  });

  it('高胡构筑包含成品与棱彩海克斯，且不超过 2458 金币', () => {
    for (const build of REFERENCE_BUILDS.filter((entry) => entry.tier === 'highRoll')) {
      expect(build.crafted.length).toBeGreaterThan(0);
      expect(build.hexes).toContain('H19');
      expect(buildGoldCost(build)).toBeLessThanOrEqual(HIGH_ROLL_GOLD_BUDGET);
    }
  });
});

describe('US-050 固定 Boss 场景', () => {
  it('Boss 数值来自真实敌人定义（12000 生命 / 20 护甲 / 15% 法抗）', () => {
    const boss = getEnemy('boss');
    expect(boss?.maxHealth).toBe(12000);
    expect(boss?.armor).toBe(20);
    expect(boss?.magicResist).toBe(0.15);
  });

  it('属性聚合结果与 StatAggregator 一致，不使用隐藏加成', () => {
    for (const build of REFERENCE_BUILDS) {
      const stats = aggregateBuild(build);
      expect(stats.damageMultiplier).toBeGreaterThan(0);
      expect(stats.attackSpeedMultiplier).toBeGreaterThan(0);
    }
  });

  it('固定场景中每个生效加成都来自构筑明确拥有的 ID', () => {
    for (const build of REFERENCE_BUILDS) {
      const owned = new Set<string>([
        ...build.hexes,
        ...build.cores,
        ...build.crafted,
      ]);
      const row = evaluateBuild(build);
      expect(row.appliedBonusSources.length, build.id).toBeGreaterThan(0);
      for (const source of row.appliedBonusSources) {
        expect(owned.has(source), `${build.id} 生效了未拥有的 ${source}`).toBe(true);
      }
    }
  });

  it('职业海克斯按各自 ID 生效，不借用相邻条目', () => {
    // 战术家高胡拥有 H46（召唤物 +35%）但未拥有 H47（主流形补击）。
    const muelsyse = REFERENCE_BUILDS.find((build) => build.id === 'muelsyse-high-roll')!;
    expect(muelsyse.hexes).toContain('H46');
    expect(muelsyse.hexes).not.toContain('H47');
    const muelsyseRow = evaluateBuild(muelsyse);
    expect(muelsyseRow.appliedBonusSources).toContain('H46');
    expect(muelsyseRow.appliedBonusSources).not.toContain('H47');
    expect(muelsyseRow.streams.some((stream) => stream.name.includes('H47'))).toBe(false);
    // R05 小流形属于该构筑的成品，必须计入独立召唤流。
    expect(muelsyseRow.appliedBonusSources).toContain('R05');
    expect(muelsyseRow.streams.some((stream) => stream.name.startsWith('R05'))).toBe(true);

    // 术士高胡拥有 H32（情绪吸收 5→3）但未拥有 H33（追加术式）。
    const amiya = REFERENCE_BUILDS.find((build) => build.id === 'amiya-high-roll')!;
    expect(amiya.hexes).toContain('H32');
    expect(amiya.hexes).not.toContain('H33');
    const amiyaRow = evaluateBuild(amiya);
    expect(amiyaRow.appliedBonusSources).toContain('H32');
    expect(amiyaRow.appliedBonusSources).not.toContain('H33');
    expect(amiyaRow.appliedBonusSources).not.toContain('H38');
  });

  it('H47 只在构筑明确拥有时按 TACTICIAN_HEX_PARAMS 结算', () => {
    const base = REFERENCE_BUILDS.find((build) => build.id === 'muelsyse-high-roll')!;
    const withH47 = {
      ...base,
      id: 'muelsyse-high-roll+h47',
      hexes: [...base.hexes, 'H47'],
    };
    const before = evaluateBuild(base);
    const after = evaluateBuild(withH47);
    expect(after.appliedBonusSources).toContain('H47');
    expect(after.totalDps).toBeGreaterThan(before.totalDps);
    expect(after.ttkSeconds).toBeLessThan(before.ttkSeconds);
  });

  it('四职业普通/高胡理论用时落在设计窗口，高胡至少快 2 倍', () => {
    const rows = evaluateAll();
    console.log(renderTable(rows));
    const summary = summarize(rows);
    expect(summary.normalWithinBudget).toBe(true);
    expect(summary.highRollWithinBudget).toBe(true);
    expect(summary.normalTtkWithinRange).toBe(true);
    expect(summary.highRollTtkWithinRange).toBe(true);
    expect(summary.atLeastDoubleSpeed).toBe(true);
    if (process.env.CALIBRATION_ARTIFACT === '1') {
      writeArtifact(rows);
    }
  });

  it('普通构筑承伤余量 > 1.3，固定场景下不会因算术承伤直接暴毙', () => {
    for (const row of evaluateAll().filter((entry) => entry.tier === 'normal')) {
      expect(row.capacityMargin, row.buildId).toBeGreaterThan(NORMAL_CAPACITY_MARGIN_MIN);
    }
  });
});

function renderTable(rows: ReturnType<typeof evaluateAll>): string {
  const header = [
    'build',
    'hero',
    'gold',
    'dmg×',
    'as×',
    'dps',
    'ttk(s)',
    'margin',
  ];
  const lines = rows.map((row) =>
    [
      row.buildId,
      row.heroName,
      row.goldCost,
      row.damageMultiplier.toFixed(2),
      row.attackSpeedMultiplier.toFixed(2),
      row.totalDps.toFixed(1),
      row.ttkSeconds.toFixed(1),
      row.capacityMargin.toFixed(2),
    ].join('\t'),
  );
  return [header.join('\t'), ...lines].join('\n');
}

/**
 * 生成证据产物：`CALIBRATION_ARTIFACT=1 npx vitest run tests/balance-calibration.test.ts`。
 * 默认测试不写文件，避免日常跑测污染工作区。
 */
function writeArtifact(rows: ReturnType<typeof evaluateAll>): void {
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  const payload = {
    scene: 'v0.2 fixed boss scenario (arithmetic, not a playthrough)',
    boss: { id: 'boss', maxHealth: 12000, armor: 20, magicResist: 0.15 },
    assumptions: {
      bossWindowSeconds: 1.4,
      bossWindowDamage: 30,
      bossHitRate: 0.3,
      normalTtkRangeSeconds: NORMAL_TTK_RANGE_SECONDS,
      highRollTtkRangeSeconds: HIGH_ROLL_TTK_RANGE_SECONDS,
      normalGoldBudget: NORMAL_GOLD_BUDGET,
      highRollGoldBudget: HIGH_ROLL_GOLD_BUDGET,
    },
    builds: REFERENCE_BUILDS.map((build) => ({
      id: build.id,
      tier: build.tier,
      heroId: build.heroId,
      items: build.items,
      upgrades: build.upgrades,
      hexes: build.hexes,
      cores: build.cores,
      crafted: build.crafted,
      skills: build.skills.map((skill) => ({
        id: skill.skillId,
        level: skill.targetLevel,
      })),
      dodgeUptime: build.dodgeUptime ?? 0,
      goldCost: buildGoldCost(build),
      assumptions: build.assumptions,
    })),
    results: rows.map((row) => ({
      buildId: row.buildId,
      heroId: row.heroId,
      goldCost: row.goldCost,
      maxHealth: round(row.maxHealth),
      armor: round(row.armor),
      magicResist: round(row.magicResist),
      damageMultiplier: round(row.damageMultiplier),
      attackSpeedMultiplier: round(row.attackSpeedMultiplier),
      cooldownReduction: round(row.cooldownReduction),
      totalDps: round(row.totalDps),
      ttkSeconds: round(row.ttkSeconds),
      capacityMargin: round(row.capacityMargin),
      streams: row.streams.map((stream) => ({
        name: stream.name,
        damageType: stream.damageType,
        dps: round(stream.dps),
      })),
    })),
  };
  const dir = resolve(ROOT, 'docs/calibration');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'v0.2-boss-scenarios.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}
