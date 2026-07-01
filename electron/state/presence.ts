import type { AgentPresenceState } from '../../src/agent/types';
import {
  getAffectionStageLabel,
  recordChatAffection,
  recordFeedAffection,
} from '../../src/affection';
import { getModelConfigSafe } from '../../src/models/config';
import { getTodayTokenCount } from '../../src/db/token-usage';
import { ev } from '../../src/agent/events';
import type { AgUiEvent } from '../../src/agent/types';
import { broadcastToAllRendererWindows } from '../windows/broadcast';

const DEFAULT_STATE: AgentPresenceState = {
  online: true,
  mood: 'calm',
  activity: 'idle',
  affectionStage: '守望',
  currentModel: '未配置',
  tokenUsageToday: 0,
};

let state: AgentPresenceState = { ...DEFAULT_STATE };
let feedingTimer: ReturnType<typeof setTimeout> | null = null;
let activeRunCount = 0;
let idleResetTimer: ReturnType<typeof setTimeout> | null = null;

function refreshModelAndTokens(): void {
  const config = getModelConfigSafe();
  state = {
    ...state,
    affectionStage: getAffectionStageLabel(),
    currentModel: config?.model ?? '未配置',
    tokenUsageToday: getTodayTokenCount(),
  };
}

function broadcastState(): void {
  refreshModelAndTokens();
  broadcastToAllRendererWindows('agent:event', ev.stateUpdate({ ...state }));
}

export function getPresenceState(): AgentPresenceState {
  refreshModelAndTokens();
  return { ...state };
}

export function setPresencePatch(patch: Partial<AgentPresenceState>): void {
  state = { ...state, ...patch };
  broadcastState();
}

export function onRunStarted(): void {
  activeRunCount += 1;
  if (idleResetTimer) {
    clearTimeout(idleResetTimer);
    idleResetTimer = null;
  }
  setPresencePatch({ online: true, mood: 'thinking', activity: 'working' });
}

export function onRunFinished(): void {
  activeRunCount = Math.max(0, activeRunCount - 1);
  if (activeRunCount > 0) return;

  recordChatAffection();
  setPresencePatch({
    online: true,
    mood: 'happy',
    activity: 'accompanying',
    affectionStage: getAffectionStageLabel(),
  });
  idleResetTimer = setTimeout(() => {
    idleResetTimer = null;
    if (activeRunCount === 0 && state.activity === 'accompanying' && state.mood === 'happy') {
      setPresencePatch({ mood: 'calm', activity: 'idle' });
    }
  }, 5000);
}

export function onRunError(): void {
  activeRunCount = Math.max(0, activeRunCount - 1);
  if (activeRunCount > 0) return;
  if (idleResetTimer) {
    clearTimeout(idleResetTimer);
    idleResetTimer = null;
  }
  setPresencePatch({ online: true, mood: 'calm', activity: 'idle' });
}

export function feedShorekeeper(): void {
  if (feedingTimer) {
    clearTimeout(feedingTimer);
  }
  recordFeedAffection();
  setPresencePatch({
    mood: 'happy',
    activity: 'feeding',
    affectionStage: getAffectionStageLabel(),
  });
  feedingTimer = setTimeout(() => {
    feedingTimer = null;
    if (state.activity === 'feeding') {
      setPresencePatch({ mood: 'calm', activity: 'idle' });
    }
  }, 30_000);
}

export function broadcastAgentEvent(event: AgUiEvent): void {
  if (event.type === 'usage') {
    refreshModelAndTokens();
    const withTokens = ev.stateUpdate({ ...state, tokenUsageToday: getTodayTokenCount() });
    broadcastToAllRendererWindows('agent:event', event);
    broadcastToAllRendererWindows('agent:event', withTokens);
    return;
  }
  broadcastToAllRendererWindows('agent:event', event);
}

export function emitInitialState(): void {
  broadcastState();
}
