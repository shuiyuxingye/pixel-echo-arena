// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RUN_RECORDS,
  RUN_RESULTS_SCHEMA_VERSION,
  RUN_RESULTS_STORAGE_KEY,
  appendRunResult,
  createRunResultRecord,
  formatRunDuration,
  formatRunRecordLine,
  loadRunResults,
  parseRunResults,
  shouldRecordCombatStats,
  type RunResultPayload,
  type RunResultRecord,
} from '../src/game/run-results';
import { mountResultPanel } from '../src/ui/result-panel';

const ROOT = resolve(import.meta.dirname, '..');
const SAVED_AT = new Date('2026-10-20T06:00:00.000Z');

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  } as unknown as Storage;
}

function validRecord(overrides: Partial<RunResultRecord> = {}): RunResultRecord {
  return {
    runId: 'run-1',
    characterId: 'vishdal',
    outcome: 'victory',
    wave: 9,
    durationSeconds: 412.6,
    kills: 57,
    damageDealt: 2140.4,
    upgrades: [
      { id: 'G01', stacks: 2 },
      { id: 'W02', stacks: 1 },
    ],
    recordedAt: SAVED_AT.toISOString(),
    ...overrides,
  };
}

function payload(record: RunResultRecord, saved = true): RunResultPayload {
  return { record, saved };
}

function resultDom(): void {
  document.body.innerHTML = `
    <div id="result-overlay" hidden>
      <section id="result-panel">
        <h2 id="result-title">结算</h2>
        <p id="result-subtitle"></p>
        <dl id="result-stats"></dl>
        <p id="result-build"></p>
        <div id="result-menu">
          <button id="result-restart" type="button">同角色重开</button>
          <button id="result-select" type="button">返回选角</button>
          <button id="result-records" type="button">查看记录</button>
        </div>
        <div id="result-records-view" hidden>
          <ol id="result-record-list"></ol>
          <button id="result-records-back" type="button">返回</button>
        </div>
        <p id="result-hint"></p>
      </section>
    </div>
  `;
}

function press(code: string, key = code): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code,
    key,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function pressDown(count: number): void {
  for (let index = 0; index < count; index += 1) press('ArrowDown');
}

function focusedId(): string | null {
  return (document.activeElement as HTMLElement | null)?.id ?? null;
}

function text(id: string): string {
  return document.querySelector<HTMLElement>(`#${id}`)?.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('成绩字段', () => {
  it('结算记录包含角色、波次、用时、击杀、伤害与最终构筑', () => {
    const record = createRunResultRecord(
      {
        runId: 'run-42',
        characterId: 'amiya',
        outcome: 'defeat',
        wave: 7,
        durationSeconds: 236.4,
        kills: 31,
        damageDealt: 1875.6,
        upgrades: [
          { id: 'A02', stacks: 1 },
          { id: 'G01', stacks: 3 },
        ],
      },
      SAVED_AT,
    );

    expect(record).toMatchObject({
      runId: 'run-42',
      characterId: 'amiya',
      outcome: 'defeat',
      wave: 7,
      durationSeconds: 236.4,
      kills: 31,
      damageDealt: 1875.6,
    });
    expect(record.upgrades).toEqual([
      { id: 'A02', stacks: 1 },
      { id: 'G01', stacks: 3 },
    ]);
    expect(record.recordedAt).toBe(SAVED_AT.toISOString());
  });

  it('摘要行包含胜败、角色、波次、用时、击杀、伤害与构筑', () => {
    const line = formatRunRecordLine(validRecord());
    expect(line).toContain('第 9 波');
    expect(line).toContain('胜利');
    expect(line).toContain('爆破手');
    expect(line).toContain('6:52');
    expect(line).toContain('击杀 57');
    expect(line).toContain('伤害 2140');
    expect(line).toContain('G01×2');
    expect(formatRunDuration(65)).toBe('1:05');
    expect(formatRunDuration(0)).toBe('0:00');
  });
});

describe('最近 10 局与同局去重', () => {
  it('只保留最近 10 局，新记录在最前', () => {
    const storage = memoryStorage();
    for (let index = 1; index <= MAX_RUN_RECORDS + 2; index += 1) {
      appendRunResult(
        validRecord({
          runId: `run-${index}`,
          recordedAt: new Date(SAVED_AT.getTime() + index * 1000).toISOString(),
        }),
        storage,
      );
    }

    const records = loadRunResults(storage);
    expect(records).toHaveLength(MAX_RUN_RECORDS);
    expect(records[0]?.runId).toBe('run-12');
    expect(records.at(-1)?.runId).toBe('run-3');
    expect(records.some((record) => record.runId === 'run-1')).toBe(false);
    expect(records.some((record) => record.runId === 'run-2')).toBe(false);
  });

  it('同一 runId 只记录一次，重复提交保留第一条', () => {
    const storage = memoryStorage();
    const first = validRecord({ damageDealt: 100 });
    appendRunResult(first, storage);
    const second = appendRunResult(
      validRecord({ damageDealt: 999, kills: 99 }),
      storage,
    );

    const records = loadRunResults(storage);
    expect(records).toHaveLength(1);
    expect(records[0]?.damageDealt).toBe(100);
    expect(records[0]?.kills).toBe(57);
    expect(second.duplicate).toBe(true);
    expect(second.record.damageDealt).toBe(100);
  });

  it('损坏或未知版本的记录不阻断新成绩写入', () => {
    const storage = memoryStorage();
    storage.setItem(RUN_RESULTS_STORAGE_KEY, '{not json');
    expect(loadRunResults(storage)).toEqual([]);

    const appended = appendRunResult(validRecord(), storage);
    expect(appended.saved).toBe(true);
    expect(loadRunResults(storage)).toHaveLength(1);
  });

  it('非法字段的记录整体视为损坏', () => {
    expect(
      parseRunResults({
        schemaVersion: RUN_RESULTS_SCHEMA_VERSION,
        records: [validRecord({ wave: 0 })],
      }),
    ).toBeNull();
    expect(
      parseRunResults({
        schemaVersion: RUN_RESULTS_SCHEMA_VERSION,
        records: [validRecord({ upgrades: [{ id: 'X99', stacks: 1 }] })],
      }),
    ).toBeNull();
    expect(
      parseRunResults({ schemaVersion: 99, records: [validRecord()] }),
    ).toBeNull();
  });

  it('存储不可写时返回 saved=false 并保留当前记录用于展示', () => {
    const readOnly = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    const appended = appendRunResult(validRecord(), readOnly);
    expect(appended.saved).toBe(false);
    expect(appended.record.runId).toBe('run-1');
  });
});

describe('失败后统计冻结', () => {
  it('死亡或结果阶段的击杀与伤害不再累计', () => {
    expect(shouldRecordCombatStats(false, 'combat')).toBe(true);
    expect(shouldRecordCombatStats(false, 'paused')).toBe(true);
    expect(shouldRecordCombatStats(true, 'combat')).toBe(false);
    expect(shouldRecordCombatStats(true, 'result')).toBe(false);
    expect(shouldRecordCombatStats(false, 'result')).toBe(false);
  });

  it('场景在失败路径清除续局并写入一次失败成绩', () => {
    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain('shouldRecordCombatStats(');
    expect(scene).toContain('this.damageDealt += Math.max(0, result.damage)');
    expect(scene).toContain('publishRunResult(');

    // 击杀数、伤害与经验球 spawn 都在统计守卫内，失败后不再增长。
    // 按方法体边界取块（到下一个成员声明为止），避免方法增长后固定窗口截断。
    const damageStart = scene.indexOf('private showDamageResult');
    expect(damageStart).toBeGreaterThan(-1);
    const damageEnd = scene
      .slice(damageStart + 1)
      .search(/\n {2}(?:private|public|protected|override) /);
    const damageBlock = scene.slice(
      damageStart,
      damageEnd === -1 ? undefined : damageStart + 1 + damageEnd,
    );
    expect(damageBlock).toContain('if (countStats) {');
    expect(damageBlock.indexOf('spawnXpOrb')).toBeGreaterThan(
      damageBlock.indexOf('if (countStats) {'),
    );

    const deathStart = scene.indexOf('private handlePlayerDeath');
    const deathBlock = scene.slice(deathStart, deathStart + 2200);
    expect(deathStart).toBeGreaterThan(-1);
    expect(deathBlock).toContain('clearRunCheckpoint()');
    expect(deathBlock).toContain("this.publishRunResult('defeat')");

    const victoryStart = scene.indexOf('private handleBossVictory');
    const victoryBlock = scene.slice(victoryStart, victoryStart + 2600);
    expect(victoryStart).toBeGreaterThan(-1);
    expect(victoryBlock).toContain('clearRunCheckpoint()');
    expect(victoryBlock).toContain("this.publishRunResult('victory')");
  });
});

describe('结算面板键盘导航', () => {
  it('默认聚焦同角色重开，Enter 用同一角色重开', () => {
    resultDom();
    const onRestart = vi.fn();
    const onReturnToSelect = vi.fn();
    const panel = mountResultPanel({
      onRestart,
      onReturnToSelect,
      getRecords: () => [],
    });
    panel.show(payload(validRecord()));

    expect(document.querySelector<HTMLElement>('#result-overlay')?.hidden).toBe(false);
    expect(focusedId()).toBe('result-restart');
    expect(text('result-title')).toBe('试炼完成');
    expect(text('result-subtitle')).toContain('爆破手');
    expect(text('result-subtitle')).toContain('第 9 波');
    expect(text('result-stats')).toContain('爆破手');
    expect(text('result-stats')).toContain('6:52');
    expect(text('result-stats')).toContain('57');
    expect(text('result-stats')).toContain('2140');
    expect(text('result-build')).toContain('G01 强袭 ×2');

    press('Enter');
    expect(onRestart).toHaveBeenCalledWith('vishdal');
    expect(onReturnToSelect).not.toHaveBeenCalled();
    panel.hide();
  });

  it('方向键移动焦点到返回选角并用 Enter 确认', () => {
    resultDom();
    const onRestart = vi.fn();
    const onReturnToSelect = vi.fn();
    const panel = mountResultPanel({
      onRestart,
      onReturnToSelect,
      getRecords: () => [],
    });
    panel.show(payload(validRecord({ outcome: 'defeat', wave: 4 })));

    expect(text('result-title')).toBe('试炼失败');
    pressDown(1);
    expect(focusedId()).toBe('result-select');
    press('Enter');
    expect(onReturnToSelect).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    panel.hide();
  });

  it('查看记录可用键盘打开、浏览并以 Esc 返回', () => {
    resultDom();
    const records = [
      validRecord(),
      validRecord({
        runId: 'run-2',
        characterId: 'saria',
        outcome: 'defeat',
        wave: 6,
        kills: 12,
      }),
    ];
    const panel = mountResultPanel({
      onRestart: () => undefined,
      onReturnToSelect: () => undefined,
      getRecords: () => records,
    });
    panel.show(payload(validRecord()));

    pressDown(2);
    expect(focusedId()).toBe('result-records');
    press('Enter');

    const view = document.querySelector<HTMLElement>('#result-records-view');
    expect(view?.hidden).toBe(false);
    expect(document.querySelectorAll('.result-record')).toHaveLength(2);
    const firstItem = document.querySelector<HTMLElement>('.result-record');
    expect(firstItem?.textContent).toContain('爆破手');
    expect(firstItem?.classList.contains('is-focused')).toBe(true);

    pressDown(1);
    const items = document.querySelectorAll<HTMLElement>('.result-record');
    expect(items[1]?.classList.contains('is-focused')).toBe(true);
    expect(items[1]?.textContent).toContain('骑士');

    press('Escape');
    expect(view?.hidden).toBe(true);
    expect(focusedId()).toBe('result-records');
    panel.hide();
  });
});

describe('接入', () => {
  it('HTML 提供结算容器与三个动作按钮', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('id="result-overlay"');
    expect(html).toContain('id="result-stats"');
    expect(html).toContain('id="result-build"');
    expect(html).toContain('id="result-restart"');
    expect(html).toContain('id="result-select"');
    expect(html).toContain('id="result-records"');
    expect(html).toContain('id="result-record-list"');
  });

  it('应用壳挂载结算面板并转发结算事件', () => {
    const app = readFileSync(resolve(ROOT, 'src/app.ts'), 'utf8');
    expect(app).toContain('mountResultPanel');
    expect(app).toContain('RUN_RESULT_EVENT');
    expect(app).toContain('loadRunResults');
    expect(app).toContain('resultPanel.show(payload)');
    expect(app).toContain('resultPanel.hide()');

    const scene = readFileSync(
      resolve(ROOT, 'src/game/scenes/ArenaScene.ts'),
      'utf8',
    );
    expect(scene).toContain('this.game.events.emit(RUN_RESULT_EVENT, payload)');
    expect(scene).toContain('appendRunResult(record)');
    expect(scene).toContain('createRunResultRecord({');
  });
});
