/**
 * The finance engine: typed inputs, deterministic outputs, no storage and no
 * React. The browser, API, reports and the Assistant all consume the same
 * results, so no other file may hold its own version of these formulas
 * (§14.1). Bump `ENGINE_VERSION` whenever a published figure could change.
 */
export const ENGINE_VERSION = '1.0.0';

export * from './decimal';
export * from './tax';
export * from './allocation';
export * from './cost-position';
export * from './schedule';
export * from './returns';
export * from './interest';
export * from './profit';
export * from './settlement';
export * from './waterfall';
export * from './funding';
export * from './scenario';
