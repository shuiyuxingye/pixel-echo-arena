/**
 * 选角页的纯逻辑与视图模型：四角色顺序、定位/技能摘要、2×2 键盘焦点。
 * 不依赖 DOM 与 Phaser，可直接在 Node 测试中导入。
 */

import { ASSET_PATHS } from './config';
import {
  CHARACTER_LIST,
  DEFAULT_CHARACTER_ID,
  getCharacter,
  type AttackDefinition,
  type CharacterDefinition,
  type CharacterId,
  type DamageType,
} from './data';
import { playerArtFor } from './player-art';

/** 选角页从左到右、从上到下的固定顺序（与角色数据顺序一致）。 */
export const CHARACTER_SELECT_ORDER: readonly CharacterId[] = CHARACTER_LIST.map(
  (character) => character.id,
);

/** 选角卡片单行四列；焦点左右移动，布局边界不换行。 */
export const CHARACTER_SELECT_COLUMNS = 4;

/** 预览沿用各自场内精灵表并做整数倍最近邻放大（见 `PlayerArtSpec.previewScale`）。 */

/** 六向定位摘要（docs/game-design.md §5）。 */
export const CHARACTER_ROLES: Readonly<Record<CharacterId, string>> = {
  vishdal: '远程爆破',
  amiya: '连射术师',
  saria: '近身守护',
  muelsyse: '召唤控场',
};

/** 与场内精灵表一一对应的预览资源，禁止另挂静态插画。 */
const CHARACTER_PREVIEW_PATHS: Readonly<Record<CharacterId, string>> = {
  vishdal: ASSET_PATHS.playerVishdal,
  amiya: ASSET_PATHS.playerAmiya,
  saria: ASSET_PATHS.playerSaria,
  muelsyse: ASSET_PATHS.playerMuelsyse,
};

const DAMAGE_LABELS: Readonly<Record<DamageType, string>> = {
  physical: '物伤',
  magic: '法伤',
  true: '真伤',
};

export type CharacterSelectDirection = 'left' | 'right' | 'up' | 'down';

export interface CharacterSelectSkillSummary {
  readonly key: 'J' | 'K' | 'L';
  readonly name: string;
  readonly description: string;
  readonly cooldownSeconds?: number;
}

export interface CharacterPreview {
  /** 场内同一张精灵表；四名角色均为 864×480 的 9×5 帧（每帧 96×96）。 */
  readonly path: string;
  readonly sheetWidth: number;
  readonly sheetHeight: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** 预览显示的是第 0 行第 0 列的下向待机帧。 */
  readonly column: number;
  readonly row: number;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

export interface CharacterSelectEntry {
  readonly id: CharacterId;
  readonly name: string;
  readonly role: string;
  readonly stats: {
    readonly maxHealth: number;
    readonly armor: number;
    readonly magicResistPercent: number;
    readonly moveSpeed: number;
  };
  readonly preview: CharacterPreview;
  readonly skills: readonly CharacterSelectSkillSummary[];
  readonly passive: {
    readonly name: string;
    readonly description: string;
  };
}

/** 把集中配置的 J 数值压成一行摘要；与数据保持一致，不另写一份数值。 */
function describeAttack(attack: AttackDefinition): string {
  const parts = [
    attack.name,
    `${attack.intervalSeconds} 秒间隔`,
    `${attack.damage} ${DAMAGE_LABELS[attack.damageType]}`,
  ];
  if (attack.range >= 200) parts.push(`${attack.range} 射程`);
  if (attack.arcDegrees) parts.push(`${attack.arcDegrees}° 扇区`);
  if (attack.splashRadius) parts.push(`${attack.splashRadius} 溅射`);
  if (attack.knockback) parts.push(`击退 ${attack.knockback}`);
  return parts.join(' · ');
}

function createEntry(character: CharacterDefinition): CharacterSelectEntry {
  const art = playerArtFor(character.id);
  return {
    id: character.id,
    name: character.name,
    role: CHARACTER_ROLES[character.id],
    stats: {
      maxHealth: character.maxHealth,
      armor: character.armor,
      magicResistPercent: Math.round(character.magicResist * 100),
      moveSpeed: character.moveSpeed,
    },
    preview: {
      path: CHARACTER_PREVIEW_PATHS[character.id],
      sheetWidth: art.sheetWidth,
      sheetHeight: art.sheetHeight,
      frameWidth: art.frameWidth,
      frameHeight: art.frameHeight,
      column: 0,
      row: 0,
      scale: art.previewScale,
      width: art.frameWidth * art.previewScale,
      height: art.frameHeight * art.previewScale,
    },
    skills: [
      {
        key: 'J',
        name: character.attack.name,
        description: describeAttack(character.attack),
      },
      {
        key: 'K',
        name: character.skillK.name,
        description: character.skillK.description,
        cooldownSeconds: character.skillK.cooldownSeconds,
      },
      {
        key: 'L',
        name: character.skillL.name,
        description: character.skillL.description,
        cooldownSeconds: character.skillL.cooldownSeconds,
      },
    ],
    passive: {
      name: character.passive.name,
      description: character.passive.description,
    },
  };
}

const ENTRIES_BY_ID: ReadonlyMap<CharacterId, CharacterSelectEntry> = new Map(
  CHARACTER_SELECT_ORDER.map((id) => [id, createEntry(getCharacter(id))]),
);

/** 选角页展示顺序的完整条目。 */
export const CHARACTER_SELECT_ENTRIES: readonly CharacterSelectEntry[] =
  CHARACTER_SELECT_ORDER.map((id) => {
    const entry = ENTRIES_BY_ID.get(id);
    if (!entry) throw new Error(`Missing character select entry: ${id}`);
    return entry;
  });

export function getCharacterSelectEntry(id: CharacterId): CharacterSelectEntry {
  const entry = ENTRIES_BY_ID.get(id);
  if (!entry) throw new Error(`Unknown character select id: ${id}`);
  return entry;
}

/** 选角焦点状态：只在本页内移动，边界不跳到列表外。 */
export class CharacterSelectState {
  private index: number;

  constructor(initialId: CharacterId = DEFAULT_CHARACTER_ID) {
    this.index = Math.max(0, CHARACTER_SELECT_ORDER.indexOf(initialId));
  }

  get focusIndex(): number {
    return this.index;
  }

  get focusedId(): CharacterId {
    return CHARACTER_SELECT_ORDER[this.index] ?? DEFAULT_CHARACTER_ID;
  }

  get focusedEntry(): CharacterSelectEntry {
    return getCharacterSelectEntry(this.focusedId);
  }

  /** 焦点下标；越界会被钳制在当前列表内。 */
  focusTo(index: number): void {
    if (!Number.isInteger(index)) return;
    this.index = Math.min(Math.max(index, 0), CHARACTER_SELECT_ORDER.length - 1);
  }

  focusToCharacter(id: CharacterId): void {
    this.focusTo(CHARACTER_SELECT_ORDER.indexOf(id));
  }

  /** 2×2 网格移动；边界返回 false 且不换行、不跳到无关控件。 */
  moveFocus(direction: CharacterSelectDirection): boolean {
    const columns = CHARACTER_SELECT_COLUMNS;
    const count = CHARACTER_SELECT_ORDER.length;
    const row = Math.floor(this.index / columns);
    const column = this.index % columns;
    let next = this.index;

    if (direction === 'left' && column > 0) next = this.index - 1;
    else if (direction === 'right' && column < columns - 1 && this.index + 1 < count) {
      next = this.index + 1;
    } else if (direction === 'up' && row > 0) next = this.index - columns;
    else if (direction === 'down' && this.index + columns < count) {
      next = this.index + columns;
    }

    if (next === this.index) return false;
    this.index = next;
    return true;
  }

  /** 确认当前焦点角色；调用方负责把结果带入新的局。 */
  confirm(): CharacterId {
    return this.focusedId;
  }
}
