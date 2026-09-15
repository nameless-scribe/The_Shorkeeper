import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppStatus, AssistantMode, ProactiveSourceTarget } from '@/shared/types';
import { DEFAULT_ASSISTANT_MODE } from '@/assistant/mode';
import { hasSpeakableDialogue } from '@/voice/text-for-speech';
import { useAgentEvents } from './hooks/useAgentEvents';
import { deriveAgentWorkflow } from './hooks/agent-workflow';
import { useVoicePlayback } from './hooks/useVoicePlayback';
import { AppBackground } from './components/AppBackground';
import { TitleBar } from './components/TitleBar';
import { AgentWorkflowStrip } from './components/AgentWorkflowStrip';
import { AgentPlanPanel } from './components/AgentPlanPanel';
import { MessageList } from './components/MessageList';
import { InputBar } from './components/InputBar';
import { SettingsDrawer } from './settings/SettingsDrawer';
import { SessionHistoryPanel } from './components/SessionHistoryPanel';
import { ProactiveInboxPanel } from './components/ProactiveInboxPanel';
import type { SettingsTab } from './settings/SettingsSidebar';
import { PermissionDialog } from './components/PermissionDialog';
import { QuestionDialog } from './components/QuestionDialog';
import { usePromptRequests } from './hooks/usePromptRequests';

export function ChatPage() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>(DEFAULT_ASSISTANT_MODE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [requestedTab, setRequestedTab] = useState<{ tab: SettingsTab; nonce: number } | null>(null);
  const [draftPrompt, setDraftPrompt] = useState<{ text: string; nonce: number } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSettingsNonce, setVoiceSettingsNonce] = useState(0);
  const voicePrefsRef = useRef({ enabled: false, autoPlay: false });
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refreshVoiceSettings = useCallback(() => {
    // 同时通知输入栏重读语音输入相关设置（sttEnabled / pushToTalk / sttAutoSend），
    // 复用既有的"抽屉关闭 / 配置变更"两个刷新点，不新增调用处。
    setVoiceSettingsNonce((n) => n + 1);
    window.shorekeeper?.voice
      .getSettings()
      .then((s) => {
        const enabled = s.ttsEnabled && s.voiceConfigured;
        setVoiceEnabled(enabled);
        voicePrefsRef.current = { enabled, autoPlay: s.ttsAutoPlay };
      })
      .catch(console.error);
  }, []);

  const bumpHistory = useCallback(() => {
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  const refreshStatus = useCallback(() => {
    window.shorekeeper?.app.status().then(setStatus).catch(console.error);
  }, []);

  useEffect(() => {
    if (!window.shorekeeper) return;
    refreshStatus();
    window.shorekeeper.sessions.current().then((s) => {
      setSessionId(s.id);
      setAssistantMode(s.assistantMode);
    }).catch(console.error);

    const off = window.shorekeeper.window.onOpenSettings(() => setSettingsOpen(true));
    window.shorekeeper.proactivity
      .unreadCount()
      .then(setInboxUnread)
      .catch(console.error);
    const offInbox = window.shorekeeper.proactivity.onUpdated((payload) => {
      setInboxUnread(payload.unreadCount);
    });
    refreshVoiceSettings();
    return () => {
      off();
      offInbox();
    };
  }, [refreshStatus, refreshVoiceSettings]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const session = await window.shorekeeper.sessions.current();
    sessionIdRef.current = session.id;
    setSessionId(session.id);
    return session.id;
  }, [sessionId]);

  const { permissionRequest, questionRequest, respondPermission, respondQuestion } = usePromptRequests();
  const { playText, stop: stopSpeech, remapPlayingId, playingId, loadingId, error: voiceError } =
    useVoicePlayback();
  const playTextRef = useRef(playText);
  playTextRef.current = playText;

  const handleAssistantReplyFinished = useCallback(
    (message: { id: string; content: string; sessionId: string }) => {
      if (message.sessionId !== sessionIdRef.current) return;
      if (!hasSpeakableDialogue(message.content)) return;

      void (async () => {
        try {
          const callActive = await window.shorekeeper.voice.call.isActive(message.sessionId);
          if (callActive.active) return;

          const settings = await window.shorekeeper.voice.getSettings();
          if (message.sessionId !== sessionIdRef.current) return;

          const enabled = settings.ttsEnabled && Boolean(settings.ttsVoiceId.trim());
          if (!enabled || !settings.ttsAutoPlay) return;

          voicePrefsRef.current = { enabled, autoPlay: settings.ttsAutoPlay };
          await playTextRef.current(message.id, message.content);
        } catch (err) {
          console.error('[voice] auto-play failed:', err);
        }
      })();
    },
    [],
  );

  const handleAssistantMessagePersisted = useCallback(
    (message: { streamId: string; persistedId: string; sessionId: string }) => {
      if (message.sessionId !== sessionIdRef.current) return;
      remapPlayingId(message.streamId, message.persistedId);
    },
    [remapPlayingId],
  );

  const { messages, loadingMessages, isRunning, error, agentPlan, send } = useAgentEvents(sessionId, ensureSession, {
    onRunFinished: bumpHistory,
    onRunStarted: stopSpeech,
    onRunStopped: stopSpeech,
    onAssistantReplyFinished: handleAssistantReplyFinished,
    onAssistantMessagePersisted: handleAssistantMessagePersisted,
  });

  const workflow = useMemo(
    () => deriveAgentWorkflow(messages, isRunning, permissionRequest, questionRequest),
    [messages, isRunning, permissionRequest, questionRequest],
  );

  const handleNewChat = useCallback(async () => {
    stopSpeech();
    if (isRunning) {
      await window.shorekeeper.agent.abort();
    }
    const session = await window.shorekeeper.sessions.create();
    setSessionId(session.id);
    setAssistantMode(session.assistantMode);
    bumpHistory();
  }, [bumpHistory, isRunning, stopSpeech]);

  const handleSelectSession = useCallback(
    async (id: string) => {
      if (id === sessionId) return;
      stopSpeech();
      if (isRunning) {
        await window.shorekeeper.agent.abort();
      }
      const session = await window.shorekeeper.sessions.switch(id);
      setSessionId(session.id);
      setAssistantMode(session.assistantMode);
    },
    [sessionId, isRunning, stopSpeech],
  );

  const handleAssistantModeChange = useCallback(async (mode: AssistantMode) => {
    if (!sessionId || isRunning) return;
    try {
      const session = await window.shorekeeper.sessions.setMode(sessionId, mode);
      setAssistantMode(session.assistantMode);
    } catch (err) {
      console.error('[assistant-mode] 切换失败:', err);
    }
  }, [isRunning, sessionId]);

  const handleOpenSource = useCallback((target: ProactiveSourceTarget) => {
    if (target.open === 'chat') {
      setInboxOpen(false);
      if (target.suggestedPrompt) {
        setDraftPrompt({ text: target.suggestedPrompt, nonce: Date.now() });
      }
      return;
    }
    setRequestedTab({ tab: target.open, nonce: Date.now() });
    setSettingsOpen(true);
  }, []);

  const handleOpenCall = useCallback(async () => {
    try {
      await window.shorekeeper.window.show('call');
    } catch (err) {
      console.error('打开通话窗失败:', err);
    }
  }, []);

  return (
    <div className="keeper-panel-shell border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground />

      <div className="relative z-10 flex h-full min-h-0">
        <SessionHistoryPanel
          open={historyOpen}
          currentSessionId={sessionId}
          onSelect={handleSelectSession}
          refreshKey={historyRefreshKey}
        />
        <ProactiveInboxPanel
          open={inboxOpen}
          onOpenSource={handleOpenSource}
          onUnreadChange={setInboxUnread}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TitleBar
            status={status}
            assistantMode={assistantMode}
            assistantModeDisabled={!sessionId || isRunning}
            onAssistantModeChange={(mode) => void handleAssistantModeChange(mode)}
            onOpenSettings={() => setSettingsOpen(true)}
            onNewChat={handleNewChat}
            onToggleHistory={() => setHistoryOpen((v) => !v)}
            onOpenCall={handleOpenCall}
            historyOpen={historyOpen}
            onToggleInbox={() => setInboxOpen((v) => !v)}
            inboxOpen={inboxOpen}
            inboxUnread={inboxUnread}
          />
          <AgentWorkflowStrip status={workflow} />
          {agentPlan.length > 0 && (
            <div className="no-drag shrink-0 border-b border-keeper-cyan/12 px-4 py-2">
              <AgentPlanPanel items={agentPlan} />
            </div>
          )}
          <MessageList
            messages={messages}
            loading={loadingMessages}
            voiceEnabled={voiceEnabled}
            speechPlayingId={playingId}
            speechLoadingId={loadingId}
            onSpeechToggle={(id, text) => void playText(id, text)}
          />
          {(error || voiceError) && (
            <div className="mx-4 mb-2 rounded-xl border border-red-400/30 bg-red-950/40 px-3 py-2 text-xs text-red-200 no-drag">
              {error ?? voiceError}
            </div>
          )}
          <InputBar
            disabled={isRunning || !status?.apiConfigured}
            onSend={(text, attachments) => send(text, attachments)}
            onModelChange={refreshStatus}
            draft={draftPrompt}
            voiceSettingsNonce={voiceSettingsNonce}
          />
          <SettingsDrawer
            open={settingsOpen}
            requestedTab={requestedTab}
            onClose={() => {
              setSettingsOpen(false);
              refreshVoiceSettings();
            }}
            onConfigChange={() => {
              refreshStatus();
              refreshVoiceSettings();
            }}
          />
        </div>
      </div>
      <PermissionDialog request={permissionRequest} onRespond={respondPermission} />
      <QuestionDialog request={questionRequest} onRespond={respondQuestion} />
    </div>
  );
}
