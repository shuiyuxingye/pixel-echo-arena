/**
 * DOM 帮助页：纯键盘可读的操作、规则与状态说明；Esc/Enter 返回来源界面。
 * 快捷键文案读取设置 store，重绑后再次打开即显示新键位。
 */

import {
  keyCodeLabel,
  type KeyBindings,
  type SettingsStore,
} from '../game/settings';

export interface HelpPanelOptions {
  doc?: Document;
  store: SettingsStore;
  onBack: () => void;
}

export interface HelpPanelHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

const BACK_KEYS = new Set(['Escape', 'Enter', 'NumpadEnter']);

interface HelpSection {
  readonly title: string;
  readonly lines: readonly string[];
}

function buildSections(bindings: KeyBindings): HelpSection[] {
  const key = (action: keyof KeyBindings): string => keyCodeLabel(bindings[action]);
  return [
    {
      title: '目标',
      lines: [
        '从四名干员中选择一人，穿过 18 波敌潮，击败第 18 波的首领。',
        '生命归零立即结束；等级 2/4/6/8/10/12/14 各获得一次海克斯三选一。',
        '第 1–17 波清空或倒计时结束进入商店；第 18 波击败首领后直接结算。',
      ],
    },
    {
      title: '战斗操作',
      lines: [
        `${key('moveUp')} / ${key('moveLeft')} / ${key('moveDown')} / ${key('moveRight')}：八向移动（斜向不加速）`,
        `${key('attack')}：按住沿当前面向持续普通攻击，允许空射`,
        `${key('skillK')}：战术技能（每次按下触发一次）`,
        `${key('skillL')}：招牌技能（每次按下触发一次）`,
        `${key('skillU')} / ${key('skillI')}：自由技能（商店购买装备，各自独立冷却）`,
        `${key('dodge')}：按移动方向闪避；静止时沿最近朝向，0.18 秒 / 90 像素 / 3 秒冷却`,
        `${key('cycleTarget')}：切换前方扇区内的提示目标，不改变面向`,
        'Esc：暂停 / 返回；强化选择不可用 Esc 跳过',
        'B：打开构筑面板（来源分组与净属性），B 或 Esc 关闭并继续',
      ],
    },
    {
      title: '菜单与设置',
      lines: [
        '方向键或 W/S 移动可见焦点，Enter 或空格确认。',
        '设置中可重绑战斗按键；重复键位会提示冲突，Esc 取消编辑且不改变原绑定。',
        '恢复默认只重置键位；静音、屏震开关立即生效并保存在本机。',
        '失焦会自动暂停，回到页面后需按 Enter 明确继续。',
      ],
    },
    {
      title: '战斗规则',
      lines: [
        '每波开始有 3 秒倒计时，波间回复最大生命 15%。',
        '升级三选一：方向键或 1–3 移动焦点，Enter 确认，R 重抽（默认每局 2 次）。',
        '物理伤害受护甲减免，法术伤害受法抗减免，真实伤害不受减免。',
        '眩晕、束缚与减速是独立状态；Boss 免疫强制位移，控制转为 30% 减速。',
      ],
    },
  ];
}

export function mountHelp({
  doc = document,
  store,
  onBack,
}: HelpPanelOptions): HelpPanelHandle {
  const overlay = doc.querySelector<HTMLElement>('#help-overlay');
  const content = doc.querySelector<HTMLElement>('#help-content');
  const backButton = doc.querySelector<HTMLButtonElement>('#help-back-button');

  if (!overlay || !content || !backButton) {
    throw new Error(
      'Help requires #help-overlay, #help-content and #help-back-button',
    );
  }

  let visible = false;

  const render = (): void => {
    const sections = buildSections(store.get().keyBindings);
    const nodes = sections.map((section) => {
      const block = doc.createElement('section');
      block.className = 'help-section';
      const title = doc.createElement('h3');
      title.className = 'help-section-title';
      title.textContent = section.title;
      block.append(title);
      const list = doc.createElement('ul');
      list.className = 'help-list';
      for (const line of section.lines) {
        const item = doc.createElement('li');
        item.textContent = line;
        list.append(item);
      }
      block.append(list);
      return block;
    });
    content.replaceChildren(...nodes);
  };

  const hide = (): void => {
    visible = false;
    doc.removeEventListener('keydown', onKeyDown);
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  };

  const back = (): void => {
    hide();
    onBack();
  };

  const show = (): void => {
    visible = true;
    render();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    doc.removeEventListener('keydown', onKeyDown);
    doc.addEventListener('keydown', onKeyDown);
    backButton.focus({ preventScroll: true });
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!visible) return;
    if (BACK_KEYS.has(event.code)) {
      event.preventDefault();
      if (!event.repeat) back();
    }
  }

  backButton.addEventListener('click', () => {
    if (visible) back();
  });

  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');

  return {
    show,
    hide,
    destroy: () => {
      hide();
      content.replaceChildren();
    },
  };
}
