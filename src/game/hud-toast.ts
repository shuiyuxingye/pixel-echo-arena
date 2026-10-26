/**
 * 战斗内短提示（US-057）：金币入账、战利品资格等瞬时反馈。
 *
 * 纯逻辑模块：时间由调用方传入「已模拟秒数」，场景只按这里的模型绘制文本。
 * 约定：
 * - 短提示不弹窗、不暂停、不抢占键盘输入；
 * - 同时最多显示 4 条，超出时丢弃最旧的一条；
 * - 到达持续时间后淡出并从列表移除，暂停时模拟秒不前进，提示一并冻结。
 */

/** 短提示的持续时间、队列上限与布局（HUD 逻辑像素）。 */
export const HUD_TOAST = {
  /** 每条提示从出现到消失的总秒数。 */
  durationSeconds: 1.6,
  /** 从生命周期的这个比例开始淡出。 */
  fadeStartRatio: 0.65,
  /** 同屏最多条数，超出丢弃最旧。 */
  maxVisible: 4,
  /** 相邻两条的纵向间距。 */
  lineHeight: 20,
  /** 第一条提示的顶部 Y；避开顶部字段与 Boss 名称行。 */
  topY: 96,
  /** 生命周期内整体上移的距离。 */
  rise: 10,
} as const;

export type HudToastKind = 'gold' | 'loot' | 'heal' | 'skill' | 'warning';

/** 提示文字色；暖金用于经济反馈，绿色用于恢复，蓝色用于技能。 */
export const HUD_TOAST_COLORS: Readonly<Record<HudToastKind, string>> = {
  gold: '#ffd98a',
  loot: '#ffe9a8',
  heal: '#9be7a4',
  skill: '#a8d8ff',
  warning: '#ffb4a2',
};

export interface HudToast {
  readonly id: number;
  readonly kind: HudToastKind;
  readonly text: string;
  /** 入队时的模拟秒数。 */
  readonly bornAt: number;
}

export interface HudToastSpec {
  readonly kind: HudToastKind;
  readonly text: string;
}

function safeNow(now: number): number {
  return Number.isFinite(now) && now > 0 ? now : 0;
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function toastAge(toast: HudToast, now: number): number {
  return Math.max(0, safeNow(now) - safeNow(toast.bornAt));
}

/** 「金币+3」：击杀、赏金与完成奖励共用的短提示文案。 */
export function formatGoldToast(amount: number): string {
  return `金币+${safeCount(amount)}`;
}

/** 「战利品资格+1」：宝箱破碎时的短提示文案。 */
export function formatLootToast(count = 1): string {
  return `战利品资格+${safeCount(count)}`;
}

/** 丢弃已超过持续时间的提示，保持顺序不变。 */
export function pruneHudToasts(
  toasts: readonly HudToast[],
  now: number,
): readonly HudToast[] {
  return toasts.filter(
    (toast) => toastAge(toast, now) < HUD_TOAST.durationSeconds,
  );
}

/**
 * 入队一条短提示。
 * 空白文本不入队；返回原数组引用表示没有变化，场景据此跳过重绘。
 */
export function pushHudToast(
  toasts: readonly HudToast[],
  spec: HudToastSpec,
  now: number,
  id: number,
): readonly HudToast[] {
  const text = spec.text.trim();
  if (text.length === 0) return toasts;
  const alive = pruneHudToasts(toasts, now);
  const next = [
    ...alive,
    { id, kind: spec.kind, text, bornAt: safeNow(now) },
  ];
  const overflow = next.length - HUD_TOAST.maxVisible;
  return overflow > 0 ? next.slice(overflow) : next;
}

export interface HudToastView {
  readonly toast: HudToast;
  readonly ageSeconds: number;
  /** 0–1 生命周期进度。 */
  readonly progress: number;
  readonly alpha: number;
  /** 该条提示当前的顶部 Y（含整体上移）。 */
  readonly y: number;
}

/** 当前存活提示的渲染模型：位置、透明度与生命周期进度。 */
export function hudToastViews(
  toasts: readonly HudToast[],
  now: number,
): readonly HudToastView[] {
  return pruneHudToasts(toasts, now).map((toast, index) => {
    const ageSeconds = toastAge(toast, now);
    const progress = Math.min(1, ageSeconds / HUD_TOAST.durationSeconds);
    const fadeProgress =
      progress <= HUD_TOAST.fadeStartRatio
        ? 0
        : (progress - HUD_TOAST.fadeStartRatio) / (1 - HUD_TOAST.fadeStartRatio);
    return {
      toast,
      ageSeconds,
      progress,
      alpha: Math.max(0, Math.min(1, 1 - fadeProgress)),
      y: HUD_TOAST.topY + index * HUD_TOAST.lineHeight - progress * HUD_TOAST.rise,
    };
  });
}
