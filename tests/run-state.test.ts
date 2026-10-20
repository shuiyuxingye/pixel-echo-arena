import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HealthState } from '../src/game/combat';
import {
  INTERMISSION_HEAL_RATIO,
  RunStateMachine,
  WAVE_COUNTDOWN_SECONDS,
  WAVE_STALE_HINT_SECONDS,
  applyIntermissionRecovery,
  formatIntermissionSummary,
  intermissionHealAmount,
  resolvePostDamagePhase,
  resolveStaleEnemyHint,
} from '../src/game/run-state';

const ROOT = resolve(import.meta.dirname, '..');
const STEP = 1 / 60;

describe('局流程状态机', () => {
  it('按 menu → character-select → countdown → combat → upgrade/intermission → combat → result 流转', () => {
    const state = new RunStateMachine();
    expect(state.phase).toBe('menu');

    expect(state.enterCharacterSelect()).toBe('character-select');
    expect(state.beginRun()).toBe('countdown');
    expect(state.countdownRemaining).toBe(WAVE_COUNTDOWN_SECONDS);

    expect(state.stepCountdown(WAVE_COUNTDOWN_SECONDS)).toBe('combat');
    expect(state.beginUpgrade()).toBe('upgrade');
    expect(state.beginIntermission()).toBe('intermission');

    // 波间完成后进入下一波倒计时，而不是直接开打。
    expect(state.beginWave()).toBe('countdown');
    expect(state.stepCountdown(STEP)).toBe('countdown');
    expect(state.stepCountdown(WAVE_COUNTDOWN_SECONDS)).toBe('combat');

    expect(state.beginResult('defeat')).toBe('result');
    expect(state.phase).toBe('result');
    expect(state.outcome).toBe('defeat');
    expect(state.isRewardPhase).toBe(false);
  });

  it('每波倒计时固定 3 秒，第 179 步仍在倒计时、第 180 步进入战斗', () => {
    const state = new RunStateMachine();
    state.enterCharacterSelect();
    state.beginRun();

    for (let step = 0; step < 179; step += 1) {
      expect(state.stepCountdown(STEP)).toBe('countdown');
    }
    expect(state.countdownRemaining).toBeCloseTo(STEP, 6);
    expect(state.stepCountdown(STEP)).toBe('combat');
    expect(state.countdownRemaining).toBe(0);
    expect(state.phase).toBe('combat');
  });

  it('非法阶段迁移不会跳步', () => {
    const state = new RunStateMachine();
    expect(state.beginWave()).toBe('menu');
    state.enterCharacterSelect();
    expect(state.beginUpgrade()).toBe('character-select');
    expect(state.beginIntermission()).toBe('character-select');
    expect(state.beginResult('victory')).toBe('result');
    expect(state.beginWave()).toBe('result');
    expect(state.beginUpgrade()).toBe('result');
  });

  it('暂停保存被暂停前的阶段，恢复后回到原阶段', () => {
    const state = new RunStateMachine();
    state.enterCharacterSelect();
    state.beginRun();
    state.stepCountdown(WAVE_COUNTDOWN_SECONDS);
    expect(state.phase).toBe('combat');

    expect(state.pause()).toBe(true);
    expect(state.phase).toBe('paused');
    expect(state.previousPhase).toBe('combat');
    expect(state.resume()).toBe('combat');
    expect(state.previousPhase).toBeNull();

    state.beginUpgrade();
    expect(state.pause()).toBe(true);
    expect(state.resume()).toBe('upgrade');

    state.beginResult('defeat');
    expect(state.pause()).toBe(false);
    expect(state.phase).toBe('result');
  });

  it('波中升级队列清空后回到 combat', () => {
    const state = new RunStateMachine();
    state.enterCharacterSelect();
    state.beginRun();
    state.stepCountdown(WAVE_COUNTDOWN_SECONDS);

    expect(state.beginUpgrade()).toBe('upgrade');
    expect(state.returnToCombat()).toBe('combat');
    expect(state.returnToCombat()).toBe('combat');
  });
});

describe('波间补给', () => {
  it('回复最大生命的 15%，不超过上限', () => {
    const health = new HealthState({ maxHealth: 100, armor: 0, magicResist: 0 });
    health.applyDamage(50, 'true');
    expect(health.health).toBe(50);
    expect(intermissionHealAmount(health.maxHealth)).toBe(15);
    expect(applyIntermissionRecovery(health)).toBe(15);
    expect(health.health).toBe(65);

    const nearlyFull = new HealthState({ maxHealth: 100 });
    nearlyFull.applyDamage(1, 'true');
    expect(applyIntermissionRecovery(nearlyFull)).toBe(1);
    expect(nearlyFull.health).toBe(100);
  });

  it('死亡角色不复活且治疗量为 0', () => {
    const health = new HealthState({ maxHealth: 100 });
    health.applyDamage(200, 'true');
    expect(health.isDead).toBe(true);
    expect(applyIntermissionRecovery(health)).toBe(0);
    expect(health.isDead).toBe(true);
    expect(health.health).toBe(0);
    expect(health.deathCount).toBe(1);
  });

  it('波间面板显示波次、生命、强化概览与 Enter 提示', () => {
    const text = formatIntermissionSummary({
      wave: 4,
      health: 73.2,
      maxHealth: 100,
      upgrades: [
        { id: 'G01', name: '强袭', stacks: 2 },
        { id: 'G04', name: '生存训练', stacks: 1 },
      ],
    });
    expect(text).toContain('第 4 波');
    expect(text).toContain('生命 74/100');
    expect(text).toContain('G01 强袭 ×2');
    expect(text).toContain('G04 生存训练 ×1');
    expect(text).toContain(`${Math.round(INTERMISSION_HEAL_RATIO * 100)}%`);
    expect(text).toContain('Enter');

    expect(
      formatIntermissionSummary({ wave: 1, health: 100, maxHealth: 100, upgrades: [] }),
    ).toContain('强化：暂无');
  });
});

describe('90 秒残敌方向提示', () => {
  const player = { x: 100, y: 100 };

  it('89.99 秒不提示，90 秒提示最近存活敌人的八向方位与剩余数量', () => {
    const enemies = [
      { id: 'far', x: 100, y: 500, isAlive: true },
      { id: 'near', x: 100, y: 50, isAlive: true },
    ];
    expect(resolveStaleEnemyHint(WAVE_STALE_HINT_SECONDS - 0.01, player, enemies)).toBeNull();

    const hint = resolveStaleEnemyHint(WAVE_STALE_HINT_SECONDS, player, enemies);
    expect(hint).not.toBeNull();
    expect(hint?.count).toBe(2);
    expect(hint?.direction).toBe('north');
    expect(hint?.label).toBe('上方');
    expect(hint?.distance).toBeCloseTo(50, 6);
  });

  it('忽略死亡敌人；全部死亡或没有敌人时不提示', () => {
    const hint = resolveStaleEnemyHint(WAVE_STALE_HINT_SECONDS + 30, player, [
      { id: 'dead', x: 101, y: 100, isAlive: false },
      { id: 'alive', x: 100, y: 160, isAlive: true },
    ]);
    expect(hint?.count).toBe(1);
    expect(hint?.direction).toBe('south');
    expect(hint?.label).toBe('下方');

    expect(
      resolveStaleEnemyHint(WAVE_STALE_HINT_SECONDS, player, [
        { id: 'dead-a', x: 0, y: 0, isAlive: false },
      ]),
    ).toBeNull();
  });

  it('斜向与等距目标按稳定规则给出方位', () => {
    const diagonal = resolveStaleEnemyHint(WAVE_STALE_HINT_SECONDS, player, [
      { id: 'corner', x: 200, y: 200, isAlive: true },
    ]);
    expect(diagonal?.direction).toBe('southEast');
    expect(diagonal?.label).toBe('右下');

    const tied = resolveStaleEnemyHint(WAVE_STALE_HINT_SECONDS, player, [
      { id: 'b', x: 100, y: 60, isAlive: true },
      { id: 'a', x: 100, y: 140, isAlive: true },
    ]);
    // 等距时按 id 升序选 'a'（下方），而不是按数组顺序。
    expect(tied?.direction).toBe('south');
  });
});

describe('伤害之后的结算顺序', () => {
  it('同帧死亡优先于胜利、升级与波间，且不发奖励', () => {
    expect(
      resolvePostDamagePhase({
        playerDead: true,
        waveCleared: true,
        pendingLevelUps: 2,
        needsMechanicChoice: true,
        victory: true,
      }),
    ).toEqual({ phase: 'result', outcome: 'defeat', rewardsAllowed: false });
  });

  it('存活时按清空结果进入升级、机制或波间', () => {
    expect(
      resolvePostDamagePhase({ playerDead: false, waveCleared: true, pendingLevelUps: 1 }),
    ).toEqual({ phase: 'upgrade', outcome: null, rewardsAllowed: true });
    expect(
      resolvePostDamagePhase({
        playerDead: false,
        waveCleared: true,
        pendingLevelUps: 0,
        needsMechanicChoice: true,
      }),
    ).toEqual({ phase: 'upgrade', outcome: null, rewardsAllowed: true });
    expect(
      resolvePostDamagePhase({ playerDead: false, waveCleared: true, pendingLevelUps: 0 }),
    ).toEqual({ phase: 'intermission', outcome: null, rewardsAllowed: true });
    expect(
      resolvePostDamagePhase({ playerDead: false, waveCleared: false, pendingLevelUps: 3 }),
    ).toEqual({ phase: 'combat', outcome: null, rewardsAllowed: true });
  });

  it('没有死亡时胜利进入结果阶段', () => {
    expect(
      resolvePostDamagePhase({ playerDead: false, waveCleared: true, victory: true }),
    ).toEqual({ phase: 'result', outcome: 'victory', rewardsAllowed: false });
  });
});

describe('场景接入', () => {
  const scene = readFileSync(
    resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
    'utf8',
  );

  it('场景使用状态机、倒计时、波间补给、残敌提示与死亡结算', () => {
    expect(scene).toContain("from '../run-state'");
    expect(scene).toContain('new RunStateMachine()');
    expect(scene).toContain('stepCountdown');
    expect(scene).toContain('applyIntermissionRecovery');
    expect(scene).toContain('formatIntermissionSummary');
    expect(scene).toContain('resolveStaleEnemyHint');
    expect(scene).toContain('resolvePostDamagePhase');
    expect(scene).toContain('handlePlayerDeath');
    expect(scene).toMatch(/runState\.beginResult\(/);
  });

  it('死亡处理位于经验升级与波次清空之前', () => {
    const start = scene.indexOf('private updateCombat(');
    const end = scene.indexOf('private stepAmiya(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const combat = scene.slice(start, end);
    const death = combat.indexOf('this.handlePlayerDeath()');
    const progression = combat.indexOf('this.progression.step(');
    const wave = combat.indexOf('this.stepWave(');
    expect(death).toBeGreaterThan(-1);
    expect(progression).toBeGreaterThan(death);
    expect(wave).toBeGreaterThan(death);
  });
});
