import type { Fence } from './fencing.js';
import type { Draft, PerformanceStore, WriteFence } from './performance-store.js';

/**
 * R3（A-P1-1）：消费者（OpenDot 适配器 → 员工入口）的唯一业务写入入口（应用侧）。
 * 每个方法都把 M07 消费租约的 epoch 凭据带进 store 的 fencedWrite：同一事务条件锁读租约行 + 条件 INSERT/UPDATE，
 * 不成立抛 FencedWriteRejected，什么都不写。入账/目标/改账/预约的最终提交走 commitConfirming*（guard.fence，同一事务条件 UPDATE）。
 * 静态检查 tests/r3/r3-write-paths.test.ts：消费者模块里除这里和 commitConfirming* 以外不许直接调用 store 写方法。
 */
export interface ConsumerWrites {
  createDraft(draft: Draft): Promise<void>;
  rewriteDraft(draft: Draft): Promise<void>;
  transitionPending(expected: Draft, next: Draft): Promise<boolean>;
  putOperationRecord(key: string, value: string): Promise<void>;
}
export function writeFenceOf(fence: Fence | undefined, nowMs: () => number): WriteFence | undefined {
  return fence ? { key: fence.key, owner: fence.owner, epoch: fence.epoch, nowMs } : undefined;
}
export function consumerWrites(store: PerformanceStore, fence: Fence | undefined, nowMs: () => number): ConsumerWrites {
  const f = writeFenceOf(fence, nowMs);
  return {
    createDraft: draft => store.saveDraft(draft, { ifAbsent: true, fence: f }),
    rewriteDraft: draft => store.saveDraft(draft, { ifAbsent: false, fence: f }),
    transitionPending: (expected, next) => store.transitionPendingDraft(expected, next, f),
    putOperationRecord: (key, value) => store.setConfig(key, value, f),
  };
}
