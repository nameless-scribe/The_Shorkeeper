/**
 * 显式定时提醒与每日管家提示接入持久账本的薄封装。
 * 数据库未就绪（单元测试、极早启动阶段）时退化为进程内记录，行为与 P2 之前一致。
 */
import type { AssistantActionPolicy, ProactivityRoute } from '../shared/types';
import { isDatabaseReady } from '../db/state';
import { recordDecision } from '../db/repositories/proactivity-decisions';
import {
  claimDelivery,
  getLastSentPopupAt,
  markDeliveryFailed,
  markDeliverySent,
} from '../db/repositories/proactivity-deliveries';
import { PROACTIVITY_RULE_VERSION } from './contract';

type SubjectKind = 'scheduled_reminder' | 'steward_notice';

/** 认领后超过这个时间仍未 sent / failed，视为上次进程在弹窗前退出，允许重新认领。 */
const STALE_CLAIM_MS = 10 * 60 * 1000;

const memoryLastPopupAt = new Map<string, number>();
const memoryClaims = new Set<string>();
let warnedOnce = false;

function warn(error: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn('[proactivity] 账本写入失败，暂用进程内记录:', error instanceof Error ? error.message : error);
}

function subjectKey(kind: SubjectKind, id: string): string {
  return `${kind}:${id}`;
}

export function persistReminderDecision(input: {
  decisionKey: string;
  subjectKind: SubjectKind;
  subjectId: string;
  policy: AssistantActionPolicy;
  route: ProactivityRoute;
  reason: string;
  at: number;
}): void {
  if (!isDatabaseReady()) return;
  try {
    recordDecision({
      decisionKey: input.decisionKey,
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      policy: input.policy,
      route: input.route,
      reason: input.reason,
      ruleVersion: PROACTIVITY_RULE_VERSION,
      evaluatedAt: input.at,
    });
  } catch (error) {
    warn(error);
  }
}

/** 跨重启的"最近一次弹窗时间"。 */
export function lastPopupSentAt(subjectKind: SubjectKind, subjectId: string): number | null {
  if (isDatabaseReady()) {
    try {
      const persisted = getLastSentPopupAt(subjectKind, subjectId);
      if (persisted != null) return persisted;
    } catch (error) {
      warn(error);
    }
  }
  return memoryLastPopupAt.get(subjectKey(subjectKind, subjectId)) ?? null;
}

export interface PopupClaim {
  claimed: boolean;
  commit: (sentAt?: number) => void;
  fail: (category: string) => void;
}

/** 认领一次弹窗；同一 deliveryKey 只能认领一次，重启后依然成立。 */
export function claimPopup(input: { deliveryKey: string; subjectKind: SubjectKind; subjectId: string }): PopupClaim {
  const key = subjectKey(input.subjectKind, input.subjectId);
  if (isDatabaseReady()) {
    try {
      const claimed = claimDelivery({
        deliveryKey: input.deliveryKey,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        channel: 'popup',
      });
      const stalePlanned =
        claimed.delivery.status === 'planned' && Date.now() - claimed.delivery.createdAt > STALE_CLAIM_MS;
      if (!claimed.claimed && claimed.delivery.status !== 'failed' && !stalePlanned) {
        return { claimed: false, commit: () => undefined, fail: () => undefined };
      }
      const id = claimed.delivery.id;
      return {
        claimed: true,
        commit: (sentAt = Date.now()) => {
          memoryLastPopupAt.set(key, sentAt);
          try {
            markDeliverySent(id, sentAt);
          } catch (error) {
            warn(error);
          }
        },
        fail: (category) => {
          try {
            markDeliveryFailed(id, category);
          } catch (error) {
            warn(error);
          }
        },
      };
    } catch (error) {
      warn(error);
    }
  }
  if (memoryClaims.has(input.deliveryKey)) {
    return { claimed: false, commit: () => undefined, fail: () => undefined };
  }
  memoryClaims.add(input.deliveryKey);
  return {
    claimed: true,
    commit: (sentAt = Date.now()) => {
      memoryLastPopupAt.set(key, sentAt);
    },
    fail: () => {
      memoryClaims.delete(input.deliveryKey);
    },
  };
}

/** 测试辅助：清空进程内退化记录。 */
export function resetProactivityLedgerMemory(): void {
  memoryLastPopupAt.clear();
  memoryClaims.clear();
  warnedOnce = false;
}
