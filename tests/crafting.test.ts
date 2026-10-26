import { describe, expect, it } from 'vitest';
import { getRecipe, getShopItem } from '../src/game/data';
import { EconomyLedger } from '../src/game/economy';
import { ItemInventory } from '../src/game/item-inventory';
import { itemStatModifiers } from '../src/game/item-effects';
import { SeededRandom } from '../src/game/random';
import { ShopShelf } from '../src/game/shop-offer';
import { ItemPaymentLedger, ShopSession } from '../src/game/shop-transaction';
import {
  CRAFTED_ITEM_IDS,
  CRAFT_MATERIAL_LAYERS,
  CraftedInventory,
  CraftingSession,
  craftFee,
  craftedStatModifiers,
  describeCraftedItem,
  formatCraftNetChanges,
  inspectRecipe,
  isCraftedItemId,
  statLabel,
  type CraftItemInventory,
  type CraftStatSnapshot,
} from '../src/game/crafting';

const EXPECTED_RECIPES = [
  { id: 'R01', ingredients: ['I01', 'I06', 'I18'], fee: 50 },
  { id: 'R02', ingredients: ['I13', 'I16', 'I24'], fee: 55 },
  { id: 'R03', ingredients: ['I03', 'I14', 'I21'], fee: 60 },
  { id: 'R04', ingredients: ['I07', 'I08', 'I15'], fee: 60 },
  { id: 'R05', ingredients: ['I09', 'I19', 'I20'], fee: 55 },
  { id: 'R06', ingredients: ['I17', 'I22', 'I23'], fee: 45 },
] as const;

interface Harness {
  readonly gold: EconomyLedger;
  readonly inventory: ItemInventory;
  readonly crafted: CraftedInventory;
  readonly payments: ItemPaymentLedger;
  readonly session: CraftingSession;
}

function makeHarness(
  options: {
    readonly gold?: number;
    readonly stacks?: Readonly<Record<string, number>>;
    readonly deliver?: (recipeId: string) => boolean;
    readonly inventory?: CraftItemInventory;
  } = {},
): Harness {
  const gold = new EconomyLedger();
  gold.restore(options.gold ?? 200);
  const inventory = new ItemInventory();
  for (const [id, count] of Object.entries(options.stacks ?? {})) {
    for (let index = 0; index < count; index += 1) inventory.acquire(id);
  }
  const crafted = new CraftedInventory();
  const payments = new ItemPaymentLedger();
  const session = new CraftingSession({
    gold,
    inventory: options.inventory ?? inventory,
    crafted,
    payments,
    ...(options.deliver ? { deliver: options.deliver } : {}),
  });
  return { gold, inventory, crafted, payments, session };
}

function statInput(
  overrides: Partial<CraftStatSnapshot> = {},
): CraftStatSnapshot {
  return {
    maxHealth: 120,
    armor: 34,
    moveSpeed: 160,
    moveSpeedMultiplier: 1,
    attackSpeedMultiplier: 1,
    damageMultiplier: 1,
    directDamageMultiplier: 1,
    skillDamageMultiplier: 1,
    normalAttackDamageMultiplier: 1,
    cooldownReduction: 0,
    explosionRadiusMultiplier: 1,
    damageOverTimeMultiplier: 1,
    recipeDamageOverTimeMultiplier: 1,
    summonDamageMultiplier: 1,
    summonHealthMultiplier: 1,
    ...overrides,
  };
}

describe('三件合成目录', () => {
  it('六条配方与内容目录的材料、手续费逐项一致', () => {
    expect(CRAFTED_ITEM_IDS).toEqual(EXPECTED_RECIPES.map((entry) => entry.id));
    for (const expected of EXPECTED_RECIPES) {
      const recipe = getRecipe(expected.id);
      expect(recipe).toBeDefined();
      expect(recipe?.ingredients).toEqual(expected.ingredients);
      expect(recipe?.fee).toBe(expected.fee);
      expect(craftFee(expected.id)).toBe(expected.fee);
      expect(isCraftedItemId(expected.id)).toBe(true);
    }
    expect(isCraftedItemId('I01')).toBe(false);
    expect(craftFee('R99')).toBe(0);
  });

  it('材料固定各消耗 1 层', () => {
    expect(CRAFT_MATERIAL_LAYERS).toBe(1);
  });
});

describe('成品属性 R01–R06', () => {
  it('R01 锻心引擎：最大生命 +80、护甲 +20、移速 −6%', () => {
    expect(craftedStatModifiers('R01')).toEqual([
      { stat: 'maxHealth', mode: 'flat', value: 80 },
      { stat: 'armor', mode: 'flat', value: 20 },
      { stat: 'moveSpeed', mode: 'percent', value: -0.06 },
    ]);
  });

  it('R02 连锁反应堆：爆炸半径 +30%、持续伤害 +30%（独立叠乘）、攻速 −8%', () => {
    expect(craftedStatModifiers('R02')).toEqual([
      { stat: 'explosionRadius', mode: 'percent', value: 0.3 },
      { stat: 'recipeDamageOverTime', mode: 'percent', value: 0.3 },
      { stat: 'attackSpeed', mode: 'percent', value: -0.08 },
    ]);
  });

  it('R03 折镜机关：攻速 +20%、J 伤害 −10%', () => {
    expect(craftedStatModifiers('R03')).toEqual([
      { stat: 'attackSpeed', mode: 'percent', value: 0.2 },
      { stat: 'normalAttackDamage', mode: 'percent', value: -0.1 },
    ]);
  });

  it('R04 永昼回路：技能伤害 +30%、冷却缩减 +15%、最大生命 −20', () => {
    expect(craftedStatModifiers('R04')).toEqual([
      { stat: 'skillDamage', mode: 'percent', value: 0.3 },
      { stat: 'cooldownReduction', mode: 'percent', value: 0.15 },
      { stat: 'maxHealth', mode: 'flat', value: -20 },
    ]);
  });

  it('R05 潮生母巢：召唤物伤害 +25%、生命 +35%、自身 J 伤害 −10%', () => {
    expect(craftedStatModifiers('R05')).toEqual([
      { stat: 'summonDamage', mode: 'percent', value: 0.25 },
      { stat: 'summonHealth', mode: 'percent', value: 0.35 },
      { stat: 'normalAttackDamage', mode: 'percent', value: -0.1 },
    ]);
  });

  it('R06 命运交易所没有属性修正，只提供商店/恢复机制', () => {
    expect(craftedStatModifiers('R06')).toEqual([]);
  });

  it('未知成品与非法 ID 返回空修正', () => {
    expect(craftedStatModifiers('R99')).toEqual([]);
    expect(craftedStatModifiers('I01')).toEqual([]);
    expect(statLabel('maxHealth')).toBe('最大生命');
  });

  it('构筑面板描述不依赖材料层数', () => {
    expect(describeCraftedItem('R03')).toMatchObject({
      id: 'R03',
      name: '折镜机关',
      statModifiers: craftedStatModifiers('R03'),
    });
    expect(describeCraftedItem('R03')?.mechanics.length).toBeGreaterThan(0);
    expect(describeCraftedItem('R99')).toBeNull();
  });
});

describe('合成报价与净变化', () => {
  it('材料层数多于 1 时只移除 1 层，并列出材料移除与成品修正', () => {
    const { inventory, session } = makeHarness({
      stacks: { I01: 2, I06: 1, I18: 1 },
    });
    const inspection = session.inspect('R01');
    expect(inspection).not.toBeNull();
    expect(inspection?.fee).toBe(50);
    expect(inspection?.materials).toMatchObject([
      { id: 'I01', name: '红铜心', stacksBefore: 2, stacksAfter: 1, layersConsumed: 1 },
      { id: 'I06', name: '反应护甲', stacksBefore: 1, stacksAfter: 0, layersConsumed: 1 },
      { id: 'I18', name: '锻心碎片', stacksBefore: 1, stacksAfter: 0, layersConsumed: 1 },
    ]);
    // 报价不修改库存。
    expect(inventory.stacksOf('I01')).toBe(2);
    expect(inventory.stacksOf('I06')).toBe(1);
    expect(inventory.stacksOf('I18')).toBe(1);

    // 移除的修正只算 1 层材料，不是全部层数。
    expect(inspection?.removedModifiers).toEqual([
      ...itemStatModifiers('I01', 1),
      ...itemStatModifiers('I06', 1),
      ...itemStatModifiers('I18', 1),
    ]);
    expect(inspection?.addedModifiers).toEqual(craftedStatModifiers('R01'));

    const change = (stat: string, mode: string) =>
      inspection?.statChanges.find(
        (entry) => entry.stat === stat && entry.mode === mode,
      );
    expect(change('maxHealth', 'flat')).toMatchObject({
      removed: 25,
      added: 80,
      net: 55,
    });
    expect(change('armor', 'flat')).toMatchObject({
      removed: 12,
      added: 20,
      net: 8,
    });
    // 材料 I01 −3% 与 I18 −4% 都被移除，成品只保留 −6%。
    expect(change('moveSpeed', 'percent')).toMatchObject({
      removed: -0.07,
      added: -0.06,
      net: 0.01,
    });
    // 移除 I06 的 −5% 攻速代价，成品不再提供攻速。
    expect(change('attackSpeed', 'percent')).toMatchObject({
      removed: -0.05,
      added: 0,
      net: 0.05,
    });
    expect(inspection?.mechanics.length).toBeGreaterThan(0);
    expect(inspection?.netModifiers).toEqual(
      expect.arrayContaining([
        { stat: 'maxHealth', mode: 'flat', value: 55 },
        { stat: 'armor', mode: 'flat', value: 8 },
        { stat: 'moveSpeed', mode: 'percent', value: 0.01 },
        { stat: 'attackSpeed', mode: 'percent', value: 0.05 },
      ]),
    );
  });

  it('六条配方的材料移除与净变化逐项正确', () => {
    const expectedNet: Readonly<
      Record<string, readonly [string, string, number][]>
    > = {
      R01: [
        ['maxHealth', 'flat', 55],
        ['armor', 'flat', 8],
        ['moveSpeed', 'percent', 0.01],
        ['attackSpeed', 'percent', 0.05],
      ],
      R02: [
        ['attackSpeed', 'percent', -0.08],
        ['directDamage', 'percent', 0.05],
        ['explosionRadius', 'percent', 0.12],
        ['explosionDamage', 'percent', 0.05],
        ['explosionSkillCooldown', 'percent', -0.08],
        ['damageOverTime', 'percent', -0.25],
        ['recipeDamageOverTime', 'percent', 0.3],
      ],
      R03: [
        ['attackSpeed', 'percent', 0.12],
        ['damage', 'percent', 0.06],
        ['normalAttackDamage', 'percent', -0.05],
      ],
      R04: [
        ['maxHealth', 'flat', -10],
        ['skillDamage', 'percent', 0.1],
        ['normalAttackDamage', 'percent', 0.08],
        ['cooldownReduction', 'percent', 0.07],
        ['skillDuration', 'percent', -0.15],
        ['skillCooldown', 'percent', -0.05],
      ],
      R05: [
        ['maxHealth', 'flat', 10],
        ['damage', 'percent', 0.04],
        ['normalAttackDamage', 'percent', -0.05],
        ['summonDamage', 'percent', 0.07],
        ['summonHealth', 'percent', 0.1],
      ],
      R06: [
        ['maxHealth', 'flat', 10],
        ['healingEffect', 'percent', 0.1],
        ['xpRadius', 'percent', -0.4],
        ['killGold', 'percent', -0.08],
        ['completionGold', 'percent', 0.15],
      ],
    };

    for (const expected of EXPECTED_RECIPES) {
      const stacks: Record<string, number> = {};
      for (const id of expected.ingredients) stacks[id] = 1;
      const { session } = makeHarness({ stacks });
      const inspection = session.inspect(expected.id);
      if (!inspection) throw new Error(`缺少 ${expected.id} 报价`);

      expect(inspection.fee).toBe(expected.fee);
      expect(inspection.materials.map((material) => material.id)).toEqual(
        expected.ingredients,
      );
      expect(
        inspection.materials.every(
          (material) => material.stacksBefore === 1 && material.stacksAfter === 0,
        ),
      ).toBe(true);
      expect(inspection.addedModifiers).toEqual(
        craftedStatModifiers(expected.id),
      );
      expect(inspection.removedModifiers).toEqual(
        expected.ingredients.flatMap((id) => itemStatModifiers(id, 1)),
      );

      const actual = inspection.statChanges.map(
        (change) =>
          [change.stat, change.mode, change.net] as [string, string, number],
      );
      expect(actual).toEqual(expectedNet[expected.id]);
    }
  });

  it('把净变化换算为当前值 → 合成后值', () => {
    const { session } = makeHarness({ stacks: { I01: 2, I06: 1, I18: 1 } });
    const inspection = session.inspect('R01');
    if (!inspection) throw new Error('缺少 R01 报价');
    const lines = formatCraftNetChanges(inspection, statInput());
    const line = (label: string) => lines.find((entry) => entry.label === label);
    expect(line('最大生命')?.text).toBe('最大生命 120 → 175（净 +55）');
    expect(line('护甲')?.text).toBe('护甲 34 → 42（净 +8）');
    expect(line('移动速度')?.text).toBe('移动速度 160 → 161.6（净 +1%）');
    expect(line('攻击速度')?.text).toBe('攻击速度 100% → 105%（净 +5%）');
    expect(line('最大生命')?.positive).toBe(true);
  });

  it('R06 材料移除后没有成品属性，净变化全部来自材料撤销', () => {
    const { session } = makeHarness({
      stacks: { I17: 1, I22: 1, I23: 1 },
    });
    const inspection = session.inspect('R06');
    expect(inspection?.addedModifiers).toEqual([]);
    expect(inspection?.netModifiers.length).toBeGreaterThan(0);
    const healing = inspection?.statChanges.find(
      (entry) => entry.stat === 'healingEffect',
    );
    // I23 的恢复 −10% 被移除，合成后恢复效果回到 100%。
    expect(healing).toMatchObject({ removed: -0.1, added: 0, net: 0.1 });
  });

  it('未知配方返回 null', () => {
    const { session } = makeHarness();
    expect(session.inspect('R99')).toBeNull();
    expect(inspectRecipe('I01', new ItemInventory())).toBeNull();
  });
});

describe('可合成性检查', () => {
  it('材料不足时列出缺失材料且不改状态', () => {
    const { gold, inventory, crafted, session } = makeHarness();
    const check = session.canCraft('R01');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe('missing-materials');
    expect(check.missing).toEqual([
      { id: 'I01', name: '红铜心', required: 1, available: 0 },
      { id: 'I06', name: '反应护甲', required: 1, available: 0 },
      { id: 'I18', name: '锻心碎片', required: 1, available: 0 },
    ]);
    expect(gold.gold).toBe(200);
    expect(inventory.snapshot()).toEqual([]);
    expect(crafted.snapshot()).toEqual([]);
  });

  it('只缺一种材料时只列该材料', () => {
    const { session } = makeHarness({ stacks: { I01: 1, I06: 1 } });
    const check = session.canCraft('R01');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.missing).toEqual([
      { id: 'I18', name: '锻心碎片', required: 1, available: 0 },
    ]);
  });

  it('金币不足时给出差额且不扣款', () => {
    const { gold, inventory, session } = makeHarness({
      gold: 49,
      stacks: { I01: 1, I06: 1, I18: 1 },
    });
    const check = session.canCraft('R01');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe('insufficient-gold');
    expect(check.shortfall).toBe(1);
    expect(gold.gold).toBe(49);
    expect(inventory.stacksOf('I01')).toBe(1);
  });

  it('成品已拥有时入口关闭，优先于材料/金币检查', () => {
    const { session, crafted } = makeHarness({ gold: 0 });
    crafted.acquire('R01');
    const check = session.canCraft('R01');
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toBe('already-owned');
  });

  it('未知配方与可合成成功分支', () => {
    const { session } = makeHarness({
      stacks: { I01: 1, I06: 1, I18: 1 },
    });
    expect(session.canCraft('R99')).toMatchObject({
      ok: false,
      reason: 'unknown-recipe',
    });
    const check = session.canCraft('R01');
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.fee).toBe(50);
    expect(check.shortfall).toBe(0);
    expect(session.craftableIds()).toEqual(['R01']);
  });
});

describe('合成提交与原子回滚', () => {
  it('成功时扣手续费、各消耗 1 层、成品唯一', () => {
    const { gold, inventory, crafted, session } = makeHarness({
      gold: 200,
      stacks: { I01: 2, I06: 1, I18: 1 },
    });
    const result = session.craft('R01');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fee).toBe(50);
    expect(result.goldBefore).toBe(200);
    expect(result.goldAfter).toBe(150);
    expect(result.materials).toEqual([
      { id: 'I01', name: '红铜心', stacksBefore: 2, stacksAfter: 1 },
      { id: 'I06', name: '反应护甲', stacksBefore: 1, stacksAfter: 0 },
      { id: 'I18', name: '锻心碎片', stacksBefore: 1, stacksAfter: 0 },
    ]);
    expect(gold.gold).toBe(150);
    expect(inventory.stacksOf('I01')).toBe(1);
    expect(inventory.stacksOf('I06')).toBe(0);
    expect(inventory.stacksOf('I18')).toBe(0);
    expect(crafted.snapshot()).toEqual(['R01']);
    expect(result.crafted).toEqual(['R01']);

    // 第二次合成被“已拥有”拒绝，金币与材料不变。
    const repeat = session.craft('R01');
    expect(repeat.ok).toBe(false);
    if (repeat.ok) return;
    expect(repeat.reason).toBe('already-owned');
    expect(repeat.gold).toBe(150);
    expect(inventory.stacksOf('I01')).toBe(1);
    expect(crafted.snapshot()).toEqual(['R01']);
  });

  it('金币不足时材料与金币完全不变', () => {
    const { gold, inventory, session } = makeHarness({
      gold: 49,
      stacks: { I01: 1, I06: 1, I18: 1 },
    });
    const result = session.craft('R01');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-gold');
    expect(gold.gold).toBe(49);
    expect(inventory.stacksOf('I01')).toBe(1);
    expect(inventory.stacksOf('I06')).toBe(1);
    expect(inventory.stacksOf('I18')).toBe(1);
  });

  it('发货失败时全额退回手续费与已移除材料', () => {
    const { gold, inventory, crafted, session } = makeHarness({
      gold: 200,
      stacks: { I01: 2, I06: 1, I18: 1 },
      deliver: () => false,
    });
    const result = session.craft('R01');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('delivery-failed');
    expect(gold.gold).toBe(200);
    expect(inventory.stacksOf('I01')).toBe(2);
    expect(inventory.stacksOf('I06')).toBe(1);
    expect(inventory.stacksOf('I18')).toBe(1);
    expect(crafted.snapshot()).toEqual([]);
  });

  it('中途移除材料失败时回滚已移除层与手续费', () => {
    const inner = new ItemInventory();
    for (const id of ['I01', 'I06', 'I18']) inner.acquire(id);
    const flaky: CraftItemInventory = {
      stacksOf: (id) => inner.stacksOf(id),
      acquire: (id) => inner.acquire(id),
      release: (id) => (id === 'I06' ? false : inner.release(id)),
    };
    const { gold, session } = makeHarness({
      gold: 200,
      inventory: flaky,
    });
    const before = inner.snapshot();
    const result = session.craft('R01');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-materials');
    expect(gold.gold).toBe(200);
    // I01 已正常移除后被回滚，三种材料仍然各 1 层；快照顺序不参与语义。
    const normalize = (entries: readonly { id: string; stacks: number }[]) =>
      [...entries].sort((left, right) => left.id.localeCompare(right.id));
    expect(normalize(inner.snapshot())).toEqual(normalize(before));
    expect(inner.stacksOf('I01')).toBe(1);
    expect(inner.stacksOf('I06')).toBe(1);
    expect(inner.stacksOf('I18')).toBe(1);
  });

  it('材料被消耗后裁剪支付账本，避免留下可退款幽灵层', () => {
    const { payments, session } = makeHarness({
      gold: 200,
      stacks: { I01: 2, I06: 1, I18: 1 },
    });
    payments.record('I01', 45);
    payments.record('I01', 45);
    payments.record('I06', 55);
    payments.record('I18', 70);
    const result = session.craft('R01');
    expect(result.ok).toBe(true);
    expect(payments.countOf('I01')).toBe(1);
    expect(payments.countOf('I06')).toBe(0);
    expect(payments.countOf('I18')).toBe(0);
    // 保留的是最近一层支付记录。
    expect(payments.sumLatest('I01', 1)).toBe(45);
  });
});

describe('成品库存与不可出售', () => {
  it('成品唯一、按目录顺序输出、恢复忽略损坏条目', () => {
    const inventory = new CraftedInventory();
    expect(inventory.acquire('R99')).toBe(false);
    expect(inventory.acquire('R03')).toBe(true);
    expect(inventory.acquire('R01')).toBe(true);
    expect(inventory.acquire('R01')).toBe(false);
    expect(inventory.snapshot()).toEqual(['R01', 'R03']);
    expect(inventory.has('R01')).toBe(true);
    expect(inventory.has('R99')).toBe(false);

    inventory.restore(['R05', 'R05', 'R99', 'I01']);
    expect(inventory.snapshot()).toEqual(['R05']);
    inventory.reset();
    expect(inventory.snapshot()).toEqual([]);
  });

  it('成品不在永久道具目录，商店出售入口返回 not-sellable', () => {
    expect(getShopItem('R01')).toBeUndefined();
    const random = new SeededRandom(20261022);
    const shelf = new ShopShelf(() => random.next(), {
      shopWave: 7,
      characterId: 'vishdal',
      stacksOf: () => 0,
    });
    const gold = new EconomyLedger();
    gold.restore(200);
    const inventory = new ItemInventory();
    inventory.acquire('I01');
    const session = new ShopSession({
      shelf,
      gold,
      inventory,
      isSellable: (itemId) => getShopItem(itemId) !== undefined,
    });
    expect(session.canSell('R01')).toMatchObject({
      ok: false,
      reason: 'not-sellable',
    });
    expect(session.sell('R01')).toMatchObject({
      ok: false,
      reason: 'not-sellable',
    });
  });
});
