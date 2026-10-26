import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_COUNTS,
  CONSUMABLE_LIST,
  CONTENT_CATALOG,
  ELITE_CORE_LIST,
  FREE_SKILL_LIST,
  HEX_LIST,
  HEX_OWNERS,
  HEX_RARITIES,
  ITEM_RARITIES,
  RECIPE_LIST,
  SHOP_ITEM_LIST,
  getConsumable,
  getEliteCore,
  getFreeSkill,
  getHex,
  getRecipe,
  getShopItem,
  listConsumables,
  listEliteCores,
  listFreeSkills,
  listHexes,
  listRecipes,
  listShopItems,
  validateContentCatalog,
  type ConsumableDefinition,
  type EliteCoreDefinition,
  type FreeSkillDefinition,
  type HexDefinition,
  type HexOwner,
  type HexRarity,
  type ItemRarity,
  type RecipeDefinition,
  type ShopItemDefinition,
} from '../src/game/data';

const ROOT = process.cwd();

interface RawItem {
  id: string;
  name: string;
  base_price: number;
  stack_cap: number;
  benefit: string;
  cost: string;
  tag: string;
  rarity: string;
}

interface RawConsumable {
  id: string;
  name: string;
  base_price: number;
  effect: string;
  limit: string;
}

interface RawSkill {
  id: string;
  name: string;
  base_price: number;
  cooldown_seconds: number;
  effect: string;
  tag: string;
}

interface RawCore {
  id: string;
  name: string;
  effect: string;
  tag: string;
}

interface RawRecipe {
  id: string;
  name: string;
  ingredients: string[];
  fee: number;
  effect: string;
  tag: string;
}

interface RawHex {
  id: string;
  name: string;
  rarity: string;
  effect: string;
  owner: string;
}

interface RawCatalog {
  status: string;
  items: RawItem[];
  consumables: RawConsumable[];
  skills: RawSkill[];
  elite_cores: RawCore[];
  recipes: RawRecipe[];
  hexes: RawHex[];
}

const RAW = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/design/v0.2/data/catalog.json'), 'utf8'),
) as RawCatalog;

type MutableContentCatalog = {
  items: ShopItemDefinition[];
  consumables: ConsumableDefinition[];
  skills: FreeSkillDefinition[];
  eliteCores: EliteCoreDefinition[];
  recipes: RecipeDefinition[];
  hexes: HexDefinition[];
};

function mutableCatalog(): MutableContentCatalog {
  return {
    items: CONTENT_CATALOG.items.map((item) => ({ ...item })),
    consumables: CONTENT_CATALOG.consumables.map((consumable) => ({ ...consumable })),
    skills: CONTENT_CATALOG.skills.map((skill) => ({ ...skill })),
    eliteCores: CONTENT_CATALOG.eliteCores.map((core) => ({ ...core })),
    recipes: CONTENT_CATALOG.recipes.map((recipe) => ({
      ...recipe,
      ingredients: [...recipe.ingredients] as [string, string, string],
    })),
    hexes: CONTENT_CATALOG.hexes.map((hex) => ({ ...hex })),
  };
}

describe('content catalog / counts and ids', () => {
  it('matches the design catalog counts', () => {
    expect(CATALOG_COUNTS).toEqual({
      items: 24,
      consumables: 8,
      skills: 12,
      eliteCores: 8,
      recipes: 6,
      hexes: 48,
    });
    expect(SHOP_ITEM_LIST).toHaveLength(24);
    expect(CONSUMABLE_LIST).toHaveLength(8);
    expect(FREE_SKILL_LIST).toHaveLength(12);
    expect(ELITE_CORE_LIST).toHaveLength(8);
    expect(RECIPE_LIST).toHaveLength(6);
    expect(HEX_LIST).toHaveLength(48);
    expect(RAW.items).toHaveLength(24);
    expect(RAW.consumables).toHaveLength(8);
    expect(RAW.skills).toHaveLength(12);
    expect(RAW.elite_cores).toHaveLength(8);
    expect(RAW.recipes).toHaveLength(6);
    expect(RAW.hexes).toHaveLength(48);
  });

  it('exports every id from the design catalog in order', () => {
    expect(SHOP_ITEM_LIST.map((item) => item.id)).toEqual(RAW.items.map((item) => item.id));
    expect(CONSUMABLE_LIST.map((entry) => entry.id)).toEqual(
      RAW.consumables.map((entry) => entry.id),
    );
    expect(FREE_SKILL_LIST.map((entry) => entry.id)).toEqual(RAW.skills.map((entry) => entry.id));
    expect(ELITE_CORE_LIST.map((entry) => entry.id)).toEqual(
      RAW.elite_cores.map((entry) => entry.id),
    );
    expect(RECIPE_LIST.map((entry) => entry.id)).toEqual(RAW.recipes.map((entry) => entry.id));
    expect(HEX_LIST.map((entry) => entry.id)).toEqual(RAW.hexes.map((entry) => entry.id));
  });

  it('keeps ids unique across the whole catalog', () => {
    const ids = [
      ...SHOP_ITEM_LIST,
      ...CONSUMABLE_LIST,
      ...FREE_SKILL_LIST,
      ...ELITE_CORE_LIST,
      ...RECIPE_LIST,
      ...HEX_LIST,
    ].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('content catalog / design values', () => {
  it('matches every permanent item field', () => {
    SHOP_ITEM_LIST.forEach((item, index) => {
      const raw = RAW.items[index] as RawItem;
      expect(item).toMatchObject({
        id: raw.id,
        name: raw.name,
        basePrice: raw.base_price,
        stackCap: raw.stack_cap,
        benefit: raw.benefit,
        cost: raw.cost,
        tag: raw.tag,
        rarity: raw.rarity,
      });
    });
  });

  it('matches every consumable field', () => {
    CONSUMABLE_LIST.forEach((consumable, index) => {
      const raw = RAW.consumables[index] as RawConsumable;
      expect(consumable).toMatchObject({
        id: raw.id,
        name: raw.name,
        basePrice: raw.base_price,
        effect: raw.effect,
        limit: raw.limit,
      });
    });
  });

  it('matches every free skill field', () => {
    FREE_SKILL_LIST.forEach((skill, index) => {
      const raw = RAW.skills[index] as RawSkill;
      expect(skill).toMatchObject({
        id: raw.id,
        name: raw.name,
        basePrice: raw.base_price,
        cooldownSeconds: raw.cooldown_seconds,
        effect: raw.effect,
        tag: raw.tag,
      });
    });
  });

  it('matches every elite core field', () => {
    ELITE_CORE_LIST.forEach((core, index) => {
      const raw = RAW.elite_cores[index] as RawCore;
      expect(core).toMatchObject({
        id: raw.id,
        name: raw.name,
        effect: raw.effect,
        tag: raw.tag,
      });
    });
  });

  it('matches every recipe ingredient, fee and effect', () => {
    RECIPE_LIST.forEach((recipe, index) => {
      const raw = RAW.recipes[index] as RawRecipe;
      expect(recipe).toMatchObject({
        id: raw.id,
        name: raw.name,
        ingredients: raw.ingredients,
        fee: raw.fee,
        effect: raw.effect,
        tag: raw.tag,
      });
    });
  });

  it('matches every hex rarity, owner and effect', () => {
    HEX_LIST.forEach((hex, index) => {
      const raw = RAW.hexes[index] as RawHex;
      expect(hex).toMatchObject({
        id: raw.id,
        name: raw.name,
        rarity: raw.rarity,
        effect: raw.effect,
        owner: raw.owner,
      });
    });
  });

  it('uses only the documented rarity and owner values', () => {
    for (const item of SHOP_ITEM_LIST) {
      expect(ITEM_RARITIES).toContain(item.rarity);
      expect(item.stackCap).toBeGreaterThanOrEqual(1);
      expect(item.stackCap).toBeLessThanOrEqual(3);
    }
    for (const hex of HEX_LIST) {
      expect(HEX_RARITIES).toContain(hex.rarity);
      expect(HEX_OWNERS).toContain(hex.owner);
    }
  });
});

describe('content catalog / queries', () => {
  it('finds each entry by id and lists the same read-only collections', () => {
    for (const item of SHOP_ITEM_LIST) expect(getShopItem(item.id)).toBe(item);
    for (const entry of CONSUMABLE_LIST) expect(getConsumable(entry.id)).toBe(entry);
    for (const entry of FREE_SKILL_LIST) expect(getFreeSkill(entry.id)).toBe(entry);
    for (const entry of ELITE_CORE_LIST) expect(getEliteCore(entry.id)).toBe(entry);
    for (const entry of RECIPE_LIST) expect(getRecipe(entry.id)).toBe(entry);
    for (const entry of HEX_LIST) expect(getHex(entry.id)).toBe(entry);

    expect(listShopItems()).toBe(SHOP_ITEM_LIST);
    expect(listConsumables()).toBe(CONSUMABLE_LIST);
    expect(listFreeSkills()).toBe(FREE_SKILL_LIST);
    expect(listEliteCores()).toBe(ELITE_CORE_LIST);
    expect(listRecipes()).toBe(RECIPE_LIST);
    expect(listHexes()).toBe(HEX_LIST);
  });

  it('returns undefined for unknown ids', () => {
    expect(getShopItem('I99')).toBeUndefined();
    expect(getConsumable('P99')).toBeUndefined();
    expect(getFreeSkill('S99')).toBeUndefined();
    expect(getEliteCore('E99')).toBeUndefined();
    expect(getRecipe('R99')).toBeUndefined();
    expect(getHex('H99')).toBeUndefined();
  });

  it('does not expose the raw catalog for mutation through the exported data', () => {
    expect(Object.isFrozen(CONTENT_CATALOG)).toBe(true);
    expect(Object.isFrozen(SHOP_ITEM_LIST)).toBe(true);
    expect(Object.isFrozen(CONSUMABLE_LIST)).toBe(true);
    expect(Object.isFrozen(FREE_SKILL_LIST)).toBe(true);
    expect(Object.isFrozen(ELITE_CORE_LIST)).toBe(true);
    expect(Object.isFrozen(RECIPE_LIST)).toBe(true);
    expect(Object.isFrozen(HEX_LIST)).toBe(true);
  });
});

describe('content catalog / validation rejects illegal entries', () => {
  it('rejects duplicate ids within a category', () => {
    const catalog = mutableCatalog();
    catalog.items[1] = { ...catalog.items[1] as ShopItemDefinition, id: catalog.items[0]?.id as string };
    expect(() => validateContentCatalog(catalog)).toThrow(/重复 ID I01/);
  });

  it('rejects duplicate ids across categories', () => {
    const catalog = mutableCatalog();
    catalog.consumables[0] = { ...catalog.consumables[0] as ConsumableDefinition, id: 'I01' };
    expect(() => validateContentCatalog(catalog)).toThrow(/重复 ID I01/);
  });

  it('rejects missing entries when a category count is short', () => {
    const catalog = mutableCatalog();
    catalog.items.pop();
    expect(() => validateContentCatalog(catalog)).toThrow(/永久道具 数量应为 24，实际为 23/);
  });

  it('rejects an illegal item stack cap', () => {
    const catalog = mutableCatalog();
    catalog.items[0] = { ...catalog.items[0] as ShopItemDefinition, stackCap: 4 };
    expect(() => validateContentCatalog(catalog)).toThrow(/叠层上限/);
  });

  it('rejects a zero stack cap', () => {
    const catalog = mutableCatalog();
    catalog.items[0] = { ...catalog.items[0] as ShopItemDefinition, stackCap: 0 };
    expect(() => validateContentCatalog(catalog)).toThrow(/叠层上限/);
  });

  it('rejects an unknown item rarity', () => {
    const catalog = mutableCatalog();
    catalog.items[0] = {
      ...catalog.items[0] as ShopItemDefinition,
      rarity: '传说' as ItemRarity,
    };
    expect(() => validateContentCatalog(catalog)).toThrow(/品质/);
  });

  it('rejects an unknown hex rarity', () => {
    const catalog = mutableCatalog();
    catalog.hexes[0] = { ...catalog.hexes[0] as HexDefinition, rarity: '钻石' as HexRarity };
    expect(() => validateContentCatalog(catalog)).toThrow(/品质/);
  });

  it('rejects an unknown hex owner', () => {
    const catalog = mutableCatalog();
    catalog.hexes[0] = { ...catalog.hexes[0] as HexDefinition, owner: '游侠' as HexOwner };
    expect(() => validateContentCatalog(catalog)).toThrow(/归属/);
  });

  it('rejects a recipe that references a missing item', () => {
    const catalog = mutableCatalog();
    catalog.recipes[0] = {
      ...catalog.recipes[0] as RecipeDefinition,
      ingredients: ['I01', 'I06', 'I99'],
    };
    expect(() => validateContentCatalog(catalog)).toThrow(/不存在的道具 I99/);
  });

  it('rejects a recipe with duplicate ingredients', () => {
    const catalog = mutableCatalog();
    catalog.recipes[0] = {
      ...catalog.recipes[0] as RecipeDefinition,
      ingredients: ['I01', 'I01', 'I06'],
    };
    expect(() => validateContentCatalog(catalog)).toThrow(/材料不能重复/);
  });

  it('rejects a recipe without three ingredients', () => {
    const catalog = mutableCatalog();
    catalog.recipes[0] = {
      ...catalog.recipes[0] as RecipeDefinition,
      ingredients: ['I01', 'I06'] as unknown as [string, string, string],
    };
    expect(() => validateContentCatalog(catalog)).toThrow(/恰好引用三种材料/);
  });

  it('rejects a negative recipe fee', () => {
    const catalog = mutableCatalog();
    catalog.recipes[0] = { ...catalog.recipes[0] as RecipeDefinition, fee: -1 };
    expect(() => validateContentCatalog(catalog)).toThrow(/手续费/);
  });

  it('rejects an empty name or a non-positive price', () => {
    const blankName = mutableCatalog();
    blankName.consumables[0] = { ...blankName.consumables[0] as ConsumableDefinition, name: ' ' };
    expect(() => validateContentCatalog(blankName)).toThrow(/名称/);

    const badPrice = mutableCatalog();
    badPrice.skills[0] = { ...badPrice.skills[0] as FreeSkillDefinition, basePrice: 0 };
    expect(() => validateContentCatalog(badPrice)).toThrow(/基础价/);

    const badCooldown = mutableCatalog();
    badCooldown.skills[0] = { ...badCooldown.skills[0] as FreeSkillDefinition, cooldownSeconds: 0 };
    expect(() => validateContentCatalog(badCooldown)).toThrow(/冷却/);
  });

  it('accepts the shipped catalog', () => {
    expect(() => validateContentCatalog(CONTENT_CATALOG)).not.toThrow();
  });
});
