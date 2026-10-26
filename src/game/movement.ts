/**
 * 玩家走位与闪避规则（纯逻辑，不依赖 Phaser）。
 *
 * 位置使用碰撞圆圆心，单位为逻辑像素；所有计时使用固定逻辑步长传入的秒数，
 * 不读取渲染帧长。键盘状态以浏览器物理键位 `event.code` 为准。
 */
import { isCircleBlocked, type ArenaLayout } from './arena';
import type { PlayerDirection } from './player-art';
import type { PlayerWorldSnapshot } from './world-snapshot';
import {
  DEFAULT_KEY_BINDINGS,
  movementBindingActionForKeyCode,
  type KeyBindings,
} from './settings';

export interface MoveVector {
  x: number;
  y: number;
}

export type Facing =
  | 'east'
  | 'southEast'
  | 'south'
  | 'southWest'
  | 'west'
  | 'northWest'
  | 'north'
  | 'northEast';

export const FACING_LIST: readonly Facing[] = [
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'north',
  'northEast',
];

/** 战斗移动使用的物理键位（KeyboardEvent.code）。 */
export const MOVE_KEY_CODES = {
  KeyW: 'north',
  KeyS: 'south',
  KeyA: 'west',
  KeyD: 'east',
} as const;

export type MoveKeyCode = keyof typeof MOVE_KEY_CODES;

/** 战斗期间必须阻止浏览器默认行为的物理键位：Space 滚屏、Tab 抢焦点。 */
export const COMBAT_PREVENT_DEFAULT_CODES: readonly string[] = ['Space', 'Tab'];

/** 斜向单位分量。 */
const DIAGONAL = Math.SQRT1_2;

/** 八个面向对应的单位向量；屏幕坐标 y 轴向下。 */
export const FACING_VECTORS: Readonly<Record<Facing, MoveVector>> = {
  east: { x: 1, y: 0 },
  southEast: { x: DIAGONAL, y: DIAGONAL },
  south: { x: 0, y: 1 },
  southWest: { x: -DIAGONAL, y: DIAGONAL },
  west: { x: -1, y: 0 },
  northWest: { x: -DIAGONAL, y: -DIAGONAL },
  north: { x: 0, y: -1 },
  northEast: { x: DIAGONAL, y: -DIAGONAL },
};

/** 闪避基线（docs/game-design.md §4，全角色一致）。 */
export const DODGE = {
  durationSeconds: 0.18,
  distance: 90,
  invulnerableSeconds: 0.15,
  cooldownSeconds: 3,
  /** 闪避期间的速度：90 / 0.18 = 500 逻辑像素/秒。 */
  speed: 90 / 0.18,
} as const;

/** 初始面向：向右（docs/game-design.md §4）。 */
export const INITIAL_FACING: Facing = 'east';

/** 碰撞移动的子步上限，避免高速位移穿过薄掩体。 */
const MAX_SUBSTEP_PIXELS = 4;

/** 浮点累计容差，避免 0.18 秒这类定时在最后一步留下 1e-17 的余额。 */
const TIME_EPSILON = 1e-9;

/** 归一化二维向量；零向量保持为零。 */
export function normalizeVector(x: number, y: number): MoveVector {
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

/**
 * 由按下的物理键位合成八向移动向量；键位可被设置面板重绑。
 * 相反方向互相抵消；对角向量归一化，因此斜向不会加速。
 */
export function movementDirectionFromKeys(
  pressedKeys: ReadonlySet<string>,
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
): MoveVector {
  const x =
    (pressedKeys.has(bindings.moveRight) ? 1 : 0) -
    (pressedKeys.has(bindings.moveLeft) ? 1 : 0);
  const y =
    (pressedKeys.has(bindings.moveDown) ? 1 : 0) -
    (pressedKeys.has(bindings.moveUp) ? 1 : 0);
  return normalizeVector(x, y);
}

/** 非零移动向量对应的八向面向；零向量返回 null。 */
export function facingFromVector(vector: MoveVector): Facing | null {
  if (vector.x === 0 && vector.y === 0) return null;
  if (vector.x > 0 && vector.y === 0) return 'east';
  if (vector.x < 0 && vector.y === 0) return 'west';
  if (vector.x === 0 && vector.y > 0) return 'south';
  if (vector.x === 0 && vector.y < 0) return 'north';
  if (vector.x > 0 && vector.y > 0) return 'southEast';
  if (vector.x > 0 && vector.y < 0) return 'northEast';
  if (vector.x < 0 && vector.y > 0) return 'southWest';
  return 'northWest';
}

/**
 * 任意方向最近的八向；用于轻自瞄后的施法帧，不影响弹体的真实飞行方向。
 * 零向量返回 null（调用方沿用原面向）。
 */
export function nearestFacing(vector: MoveVector): Facing | null {
  if (!(Number.isFinite(vector.x) && Number.isFinite(vector.y))) return null;
  if (vector.x === 0 && vector.y === 0) return null;
  const angle = Math.atan2(vector.y, vector.x);
  const index = Math.round(angle / (Math.PI / 4));
  return FACING_LIST[((index % 8) + 8) % 8] ?? null;
}

/**
 * 八向面向映射到精灵表的四向行走行。
 * 斜向在四向素材中没有专用行走帧，取水平行表达。
 */
export function facingToSpriteDirection(facing: Facing): PlayerDirection {
  switch (facing) {
    case 'east':
    case 'northEast':
    case 'southEast':
      return 'right';
    case 'west':
    case 'northWest':
    case 'southWest':
      return 'left';
    case 'north':
      return 'up';
    case 'south':
      return 'down';
  }
}

export function isMoveKeyCode(code: string): code is MoveKeyCode {
  return code in MOVE_KEY_CODES;
}

export interface PlayerMotionOptions {
  layout: ArenaLayout;
  /** 角色移动速度（逻辑像素/秒），来自角色数据配置。 */
  moveSpeed: number;
  startX: number;
  startY: number;
  /** 碰撞半径，默认取场地配置。 */
  radius?: number;
  /** 当前用户键位；缺省使用默认 WASD。 */
  keyBindings?: KeyBindings;
}

/**
 * 玩家运动状态：八向移动、面向保持、墙体/掩体阻挡与闪避。
 * 位置为碰撞圆圆心；调用方每个固定逻辑步调用一次 `step(stepSeconds)`。
 */
export class PlayerMotion {
  private readonly layout: ArenaLayout;
  private readonly moveSpeed: number;
  private readonly radius: number;
  private readonly pressedKeys = new Set<string>();
  private keyBindings: KeyBindings;
  private moveSpeedMultiplier = 1;
  /** 外部来源（E07 逆风齿轮）的闪避冷却倍率；只影响之后发起的闪避。 */
  private dodgeCooldownMultiplier = 1;

  private x: number;
  private y: number;
  private facing: Facing = INITIAL_FACING;
  private moving = false;

  private dodgeRemainingSeconds = 0;
  private dodgeInvulnerableSeconds = 0;
  private dodgeCooldownSeconds = 0;
  private dodgeDirection: MoveVector = { x: 0, y: 0 };

  constructor(options: PlayerMotionOptions) {
    this.layout = options.layout;
    this.moveSpeed = options.moveSpeed;
    this.radius = options.radius ?? options.layout.playerRadius;
    this.keyBindings = options.keyBindings ?? DEFAULT_KEY_BINDINGS;
    this.x = options.startX;
    this.y = options.startY;
  }

  get position(): Readonly<MoveVector> {
    return { x: this.x, y: this.y };
  }

  get facingDirection(): Facing {
    return this.facing;
  }

  get isMoving(): boolean {
    return this.moving;
  }

  get isDodging(): boolean {
    return this.dodgeRemainingSeconds > 0;
  }

  /** 闪避前 0.15 秒无敌。 */
  get isInvulnerable(): boolean {
    return this.dodgeInvulnerableSeconds > 0;
  }

  /**
   * 授予额外无敌时间（E03 不屈圣印的 2 秒保命窗口）。
   * 与闪避无敌共用同一计时，取两者剩余时间的较大值，不互相覆盖。
   */
  grantInvulnerability(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.dodgeInvulnerableSeconds = Math.max(
      this.dodgeInvulnerableSeconds,
      seconds,
    );
  }

  get dodgeCooldownRemaining(): number {
    return this.dodgeCooldownSeconds;
  }

  /** 波中快照：位置、八向面向与闪避冷却。 */
  snapshotWorld(): PlayerWorldSnapshot {
    return {
      x: this.x,
      y: this.y,
      facing: this.facing,
      dodgeCooldownSeconds: this.dodgeCooldownSeconds,
    };
  }

  /**
   * 从波中快照恢复：保持保存时的八向面向，清空按键与进行中的闪避。
   * 非法坐标或面向保持当前值，避免损坏数据把玩家送进墙里。
   */
  restoreWorld(state: PlayerWorldSnapshot): void {
    if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) return;
    if (!FACING_LIST.includes(state.facing)) return;
    if (!isCircleBlocked(this.layout, state.x, state.y, this.radius)) {
      this.x = state.x;
      this.y = state.y;
    }
    this.facing = state.facing;
    const cooldown = Number.isFinite(state.dodgeCooldownSeconds)
      ? Math.max(0, state.dodgeCooldownSeconds)
      : 0;
    this.dodgeCooldownSeconds = cooldown;
    this.dodgeRemainingSeconds = 0;
    this.dodgeInvulnerableSeconds = 0;
    this.pressedKeys.clear();
    this.moving = false;
  }

  /** 当前按键合成的移动方向，不受墙体阻挡影响。 */
  get moveDirection(): MoveVector {
    return movementDirectionFromKeys(this.pressedKeys, this.keyBindings);
  }

  pressKey(code: string): void {
    if (movementBindingActionForKeyCode(this.keyBindings, code)) {
      this.pressedKeys.add(code);
    }
  }

  /** 设置面板修改键位后立即生效；已按下的旧键全部清空，避免粘键。 */
  setKeyBindings(bindings: KeyBindings): void {
    this.keyBindings = bindings;
    this.pressedKeys.clear();
  }

  /** 更新 G02 的移速倍率；最低为基础的 40%，与全局移速下限一致。 */
  setMoveSpeedMultiplier(multiplier: number): void {
    this.moveSpeedMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? Math.max(0.4, multiplier) : 1;
  }

  /**
   * 更新闪避冷却倍率（E07 低血时 −25% → 0.75）。
   * 只影响之后发起的闪避，不追溯当前剩余冷却。
   */
  setDodgeCooldownMultiplier(multiplier: number): void {
    this.dodgeCooldownMultiplier =
      Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  releaseKey(code: string): void {
    this.pressedKeys.delete(code);
  }

  /** 失焦时立即清空按键；面向保持最后有效方向。 */
  clearKeys(): void {
    this.pressedKeys.clear();
    this.moving = false;
  }

  /** 取消进行中的闪避（失焦暂停时用），冷却与无敌状态一并结束。 */
  cancelDodge(): void {
    this.dodgeRemainingSeconds = 0;
    this.dodgeInvulnerableSeconds = 0;
    this.moving = false;
  }

  /** 进入下一波：结束进行中的闪避并清空冷却，闪避立即可用。 */
  resetDodgeForWaveStart(): void {
    this.cancelDodge();
    this.dodgeCooldownSeconds = 0;
  }

  /**
   * 请求一次闪避。冷却未结束或正在闪避时返回 false。
   * 方向取当前移动输入；静止时沿当前面向。
   */
  requestDodge(): boolean {
    if (this.isDodging || this.dodgeCooldownSeconds > 0) return false;

    const input = this.moveDirection;
    const hasInput = input.x !== 0 || input.y !== 0;
    if (hasInput) {
      this.facing = facingFromVector(input) ?? this.facing;
      this.dodgeDirection = input;
    } else {
      this.dodgeDirection = FACING_VECTORS[this.facing];
    }

    this.dodgeRemainingSeconds = DODGE.durationSeconds;
    // 与 grantInvulnerability 共用计时：闪避不得缩短已有的更长无敌。
    this.dodgeInvulnerableSeconds = Math.max(
      this.dodgeInvulnerableSeconds,
      DODGE.invulnerableSeconds,
    );
    this.dodgeCooldownSeconds = DODGE.cooldownSeconds * this.dodgeCooldownMultiplier;
    this.moving = true;
    return true;
  }

  /** 推进一个逻辑步；方向输入更新面向，闪避期间按固定闪避方向位移。 */
  step(stepSeconds: number): void {
    if (!(stepSeconds > 0) || !Number.isFinite(stepSeconds)) return;

    const input = this.moveDirection;
    const inputFacing = facingFromVector(input);
    if (inputFacing) this.facing = inputFacing;

    if (this.isDodging) {
      // 闪避位移只消耗剩余闪避时长，避免大步长多走。
      const activeSeconds = Math.min(stepSeconds, this.dodgeRemainingSeconds);
      this.moveWithCollision(
        this.dodgeDirection.x * DODGE.speed * activeSeconds,
        this.dodgeDirection.y * DODGE.speed * activeSeconds,
      );
      this.dodgeRemainingSeconds = decay(this.dodgeRemainingSeconds, stepSeconds);
      this.moving = true;
    } else if (input.x !== 0 || input.y !== 0) {
      this.moveWithCollision(
        input.x * this.moveSpeed * this.moveSpeedMultiplier * stepSeconds,
        input.y * this.moveSpeed * this.moveSpeedMultiplier * stepSeconds,
      );
      this.moving = true;
    } else {
      this.moving = false;
    }

    // 无敌计时与闪避状态解耦：E03 等外部来源在非闪避时授予的无敌同样要到期。
    this.dodgeInvulnerableSeconds = decay(this.dodgeInvulnerableSeconds, stepSeconds);
    this.dodgeCooldownSeconds = decay(this.dodgeCooldownSeconds, stepSeconds);
  }

  /**
   * 分轴移动并逐轴判定阻挡，因此顶墙时仍可沿墙滑动，但不会穿墙。
   * 位移被拆成不超过 4 像素的子步，避免高速闪避穿过薄掩体。
   */
  private moveWithCollision(dx: number, dy: number): void {
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;

    const substeps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP_PIXELS));
    const stepX = dx / substeps;
    const stepY = dy / substeps;

    for (let step = 0; step < substeps; step += 1) {
      const nextX = this.x + stepX;
      if (!isCircleBlocked(this.layout, nextX, this.y, this.radius)) {
        this.x = nextX;
      }
      const nextY = this.y + stepY;
      if (!isCircleBlocked(this.layout, this.x, nextY, this.radius)) {
        this.y = nextY;
      }
    }
  }
}

function decay(value: number, seconds: number): number {
  const next = value - seconds;
  return next <= TIME_EPSILON ? 0 : next;
}
