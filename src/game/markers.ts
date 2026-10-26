/**
 * 占位显示标记：本体/主流形/副本/敌人的短标签、外圈样式与八向面向指示。
 *
 * 本轮逻辑优先，美术延期：新增表现只用圆形、矩形、线段与短标签，
 * 不新增 SVG、图片或精灵表。该模块是纯数据与几何计算，不依赖 Phaser，
 * 测试可直接在 Node 环境导入；ArenaScene 只消费这里的结果。
 */
import type { EnemyBehavior } from './data/enemies';
import { FACING_VECTORS, type Facing } from './movement';

/** 场上可区分的占位对象类别。 */
export type MarkerKind = 'player' | 'form' | 'copy' | 'enemy' | 'boss';

/** 外圈线型：本体单圈、主流形双圈、副本细圈。 */
export type MarkerRingStyle = 'solid' | 'double' | 'thin';

/** 一个对象的占位标记：短标签 + 形状字符 + 外圈参数。 */
export interface EntityMarker {
  readonly kind: MarkerKind;
  /** 简单形状字符，配合名称即可区分种类，不依赖颜色。 */
  readonly glyph: string;
  /** 不含动态数值的短标签；场上文本可在此基础上追加生命/剩余时间。 */
  readonly label: string;
  readonly ringWidth: number;
  readonly ringAlpha: number;
  readonly ringStyle: MarkerRingStyle;
}

/** 本体：实心圆点 + 单圈，短标签“本体”。 */
export const PLAYER_MARKER: EntityMarker = {
  kind: 'player',
  glyph: '●',
  label: '本体',
  ringWidth: 2,
  ringAlpha: 0.85,
  ringStyle: 'solid',
};

/** 主流形：菱形标记 + 双圈，和本体、副本的短标签不同。 */
export const FORM_MARKERS: Readonly<Record<'melee' | 'ranged', EntityMarker>> = {
  melee: {
    kind: 'form',
    glyph: '◆',
    label: '近战流形',
    ringWidth: 2,
    ringAlpha: 0.62,
    ringStyle: 'double',
  },
  ranged: {
    kind: 'form',
    glyph: '◆',
    label: '远程流形',
    ringWidth: 2,
    ringAlpha: 0.62,
    ringStyle: 'double',
  },
};

/** 副本：空心菱形 + 细圈，比主流形更淡。 */
export const COPY_MARKER: EntityMarker = {
  kind: 'copy',
  glyph: '◇',
  label: '副本',
  ringWidth: 1,
  ringAlpha: 0.42,
  ringStyle: 'thin',
};

/** 占位外圈半径：只影响可见标记，不参与碰撞。 */
export const MARKER_RING_RADIUS = {
  player: 18,
  form: 16,
  copy: 12,
} as const;

/** 主流形短标签相对实体的垂直偏移；创建与逐帧同步共用，避免标签停在生成点。 */
export const FORM_LABEL_OFFSET_Y = 64;

/**
 * 怪物行为对应的形状与线宽；形状 + 名称区分种类，不只依赖颜色。
 * 团团怪追击 ●、镰足虫绕侧 »、喷菇孢子弹 ✶、冲锋猪冲锋 ►、
 * 盾壳蟹挡路 ■、灯灵治疗 ✚、爆爆兽自爆 ✸、巢母召唤 ❖、
 * 旧占位射击 ▲、旧占位重装 ◆、Boss ★；幼虫用专用 · 覆盖。
 */
const ENEMY_MARKER_STYLES: Readonly<
  Record<
    EnemyBehavior,
    Pick<EntityMarker, 'glyph' | 'ringWidth' | 'ringAlpha' | 'ringStyle'>
  >
> = {
  chase: { glyph: '●', ringWidth: 2, ringAlpha: 0.9, ringStyle: 'solid' },
  flank: { glyph: '»', ringWidth: 1, ringAlpha: 0.85, ringStyle: 'thin' },
  spit: { glyph: '✶', ringWidth: 1.5, ringAlpha: 0.9, ringStyle: 'solid' },
  shoot: { glyph: '▲', ringWidth: 1.5, ringAlpha: 0.9, ringStyle: 'solid' },
  charge: { glyph: '►', ringWidth: 2.5, ringAlpha: 0.9, ringStyle: 'solid' },
  guard: { glyph: '■', ringWidth: 3, ringAlpha: 0.95, ringStyle: 'solid' },
  mend: { glyph: '✚', ringWidth: 1.5, ringAlpha: 0.9, ringStyle: 'double' },
  explode: { glyph: '✸', ringWidth: 2.5, ringAlpha: 0.95, ringStyle: 'solid' },
  summon: { glyph: '❖', ringWidth: 3, ringAlpha: 0.95, ringStyle: 'double' },
  heavy: { glyph: '◆', ringWidth: 3, ringAlpha: 0.95, ringStyle: 'solid' },
  boss: { glyph: '★', ringWidth: 4, ringAlpha: 1, ringStyle: 'double' },
};

export interface EnemyMarkerInput {
  readonly behavior: EnemyBehavior;
  readonly name: string;
  readonly elite?: boolean;
  /** 覆盖行为默认形状（幼虫用更小的点区分团团怪）。 */
  readonly markerGlyph?: string;
}

/**
 * 敌人标记：行为决定形状与线宽，精英加“精英”前缀并加粗/双层外圈。
 * 纯显示映射，不读写任何战斗数值。
 */
export function enemyMarkerFor(enemy: EnemyMarkerInput): EntityMarker {
  const style = ENEMY_MARKER_STYLES[enemy.behavior];
  const elite = enemy.elite === true;
  return {
    kind: enemy.behavior === 'boss' ? 'boss' : 'enemy',
    glyph: enemy.markerGlyph ?? style.glyph,
    label: elite ? `精英 ${enemy.name}` : enemy.name,
    ringWidth: style.ringWidth + (elite ? 2 : 0),
    ringAlpha: style.ringAlpha,
    ringStyle: elite ? 'double' : style.ringStyle,
  };
}

/**
 * 普通敌人受伤后血条与名称的显示窗口（秒）。
 * 03-art §怪物：普通怪不常驻名称，受伤时短暂显示血条；精英与 Boss 常驻。
 */
export const ENEMY_REVEAL_SECONDS = 1.2;

export interface EnemyHudVisibilityInput {
  readonly boss: boolean;
  readonly elite: boolean;
  /** 受伤后剩余的显示秒数；未受伤为 0。 */
  readonly revealRemainingSeconds: number;
}

export interface EnemyHudVisibility {
  readonly showHealthBar: boolean;
  readonly showName: boolean;
}

/**
 * 敌人的血条/名称显示规则：
 * - 精英与 Boss 常驻血条与名称；
 * - 普通敌人只在受伤后的短窗口内显示，避免满屏长标签。
 * 纯显示规则，不读写任何战斗数值。
 */
export function enemyHudVisibility(
  input: EnemyHudVisibilityInput,
): EnemyHudVisibility {
  const always = input.boss || input.elite;
  const recentlyDamaged =
    Number.isFinite(input.revealRemainingSeconds) &&
    input.revealRemainingSeconds > 0;
  const show = always || recentlyDamaged;
  return { showHealthBar: show, showName: show };
}

/** 面向指示线的几何参数（世界像素）。 */
export interface FacingIndicatorOptions {
  readonly innerRadius: number;
  readonly length: number;
  readonly headLength: number;
  readonly headHalfWidth: number;
}

export const FACING_INDICATOR: FacingIndicatorOptions = {
  innerRadius: 14,
  length: 34,
  headLength: 8,
  headHalfWidth: 5,
};

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** 八向指示线：起止点、箭头两翼与真实单位方向。 */
export interface FacingIndicatorGeometry {
  readonly start: Point2D;
  readonly end: Point2D;
  readonly headLeft: Point2D;
  readonly headRight: Point2D;
  /** 与 FACING_VECTORS 完全一致，弹体方向与指示方向共用同一来源。 */
  readonly direction: Point2D;
}

/**
 * 按真实八向面向生成地面指示线段与箭头。
 * 方向直接取 `FACING_VECTORS`，因此斜向也精确落在 ±45°，
 * 不会因为精灵只有四向行走帧而丢失真实面向。
 */
export function facingIndicatorAt(
  origin: Point2D,
  facing: Facing,
  options: FacingIndicatorOptions = FACING_INDICATOR,
): FacingIndicatorGeometry {
  const direction = FACING_VECTORS[facing];
  const start = {
    x: origin.x + direction.x * options.innerRadius,
    y: origin.y + direction.y * options.innerRadius,
  };
  const end = {
    x: origin.x + direction.x * options.length,
    y: origin.y + direction.y * options.length,
  };
  const baseX = end.x - direction.x * options.headLength;
  const baseY = end.y - direction.y * options.headLength;
  // 屏幕坐标 y 轴向下，垂直向量取 (-dy, dx)。
  const headLeft = {
    x: baseX + -direction.y * options.headHalfWidth,
    y: baseY + direction.x * options.headHalfWidth,
  };
  const headRight = {
    x: baseX - -direction.y * options.headHalfWidth,
    y: baseY - direction.x * options.headHalfWidth,
  };
  return { start, end, headLeft, headRight, direction: { x: direction.x, y: direction.y } };
}
