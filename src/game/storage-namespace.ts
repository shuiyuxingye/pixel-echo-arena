/**
 * V0.2 存档命名空间：进行中、成绩与设置全部落在 `pixel-echo.v2.*` 下。
 *
 * V0.1 的键只作为一次性设置导入来源（键位与静音），
 * 不参与任何 V2 的读取路径；旧构筑、旧成绩与 9 波进行中进度不迁移。
 * 本模块不依赖 DOM/Phaser，可直接在 Node 测试中导入。
 */

/** V0.2 所有玩家数据的命名空间前缀。 */
export const V2_STORAGE_NAMESPACE = 'pixel-echo.v2';

/** V0.2 的三个独立持久化键；互相不覆盖。 */
export const V2_STORAGE_KEYS = {
  run: `${V2_STORAGE_NAMESPACE}.run`,
  results: `${V2_STORAGE_NAMESPACE}.results`,
  settings: `${V2_STORAGE_NAMESPACE}.settings`,
} as const;

/** V0.1 旧键；仅用于一次性设置导入，V2 读路径不得使用。 */
export const V1_STORAGE_KEYS = {
  run: 'pixel-echo.run.v1',
  results: 'pixel-echo.results.v1',
  settings: 'pixel-echo.settings.v1',
} as const;

/** 记录玩家已经完成（或明确处理过）旧设置导入，避免再次提示。 */
export const LEGACY_SETTINGS_IMPORT_MARKER_KEY = `${V2_STORAGE_NAMESPACE}.legacy-settings-imported`;
