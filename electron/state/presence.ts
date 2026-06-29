import type { AgentPresenceState } from '../../src/agent/types';
import { getModelConfigSafe } from '../../src/models/config';
import { getTodayTokenCount } from '../../src/db/token-usage';
import { ev } from '../../src/agent/events';
import type { AgUiEvent } from '../../src/agent/types';
import { getWindowManager } from '../windows/manager';

const DEFAULT_STATE: AgentPresenceState = {
  online: true,
  mood: 'calm',
  activity: 'idle',
  currentModel: '未配置',
  tokenUsageToday: 0,
};

let state: AgentPresenceState = { ...DEFAULT_STATE };
let feedingTimer: ReturnType<typeof setTimeout> | null = null;

function refreshModelAndTokens(): void {
  const config = getModelConfigSafe();
  state = {
    ...state,
    currentModel: config?.model ?? '未配置',
    tokenUsageToday: getTodayTokenCount(),
  };
}

function broadcastState(): void {
  refreshModelAndTokens();
  getWindowManager().broadcast('agent:event', ev.stateUpdate({ ...state }));
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
  setPresencePatch({ online: true, mood: 'thinking', activity: 'working' });
}

export function onRunFinished(): void {
  setPresencePatch({ online: true, mood: 'happy', activity: 'accompanying' });
  setTimeout(() => {
    if (state.activity === 'accompanying' && state.mood === 'happy') {
      setPresencePatch({ mood: 'calm', activity: 'idle' });
    }
  }, 5000);
}

export function onRunError(): void {
  setPresencePatch({ online: true, mood: 'calm', activity: 'idle' });
}

export function feedShorekeeper(): void {
  if (feedingTimer) {
    clearTimeout(feedingTimer);
  }
  setPresencePatch({ mood: 'happy', activity: 'feeding' });
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
    getWindowManager().broadcast('agent:event', event);
    getWindowManager().broadcast('agent:event', withTokens);
    return;
  }
  getWindowManager().broadcast('agent:event', event);
}

export function emitInitialState(): void {
  broadcastState();
}
