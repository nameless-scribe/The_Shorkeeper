import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppStatus } from '@/shared/types';
import { hasSpeakableDialogue } from '@/voice/text-for-speech';
import { useAgentEvents } from './hooks/useAgentEvents';
import { deriveAgentWorkflow } from './hooks/agent-workflow';
import { useVoicePlayback } from './hooks/useVoicePlayback';
import { AppBackground } from './components/AppBackground';
import { TitleBar } from './components/TitleBar';
import { AgentWorkflowStrip } from './components/AgentWorkflowStrip';
import { MessageList } from './components/MessageList';
import { InputBar } from './components/InputBar';
import { SettingsDrawer } from './settings/SettingsDrawer';
import { SessionHistoryPanel } from './components/SessionHistoryPanel';
import { PermissionDialog } from './components/PermissionDialog';
import { usePermissionRequests } from './hooks/usePermissionRequests';

export function ChatPage() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const voicePrefsRef = useRef({ enabled: false, autoPlay: false });
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refreshVoiceSettings = useCallback(() => {
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
    window.shorekeeper.sessions.current().then((s) => setSessionId(s.id)).catch(console.error);

    const off = window.shorekeeper.window.onOpenSettings(() => setSettingsOpen(true));
    refreshVoiceSettings();
    return () => {
      off();
    };
  }, [refreshStatus, refreshVoiceSettings]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const session = await window.shorekeeper.sessions.current();
    sessionIdRef.current = session.id;
    setSessionId(session.id);
    return session.id;
  }, [sessionId]);

  const { request: permissionRequest, respond: respondPermission } = usePermissionRequests();
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

  const { messages, loadingMessages, isRunning, error, send } = useAgentEvents(sessionId, ensureSession, {
    onRunFinished: bumpHistory,
    onRunStarted: stopSpeech,
    onRunStopped: stopSpeech,
    onAssistantReplyFinished: handleAssistantReplyFinished,
    onAssistantMessagePersisted: handleAssistantMessagePersisted,
  });

  const workflow = useMemo(
    () => deriveAgentWorkflow(messages, isRunning, permissionRequest),
    [messages, isRunning, permissionRequest],
  );

  const handleNewChat = useCallback(async () => {
    stopSpeech();
    if (isRunning) {
      await window.shorekeeper.agent.abort();
    }
    const session = await window.shorekeeper.sessions.create();
    setSessionId(session.id);
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
    },
    [sessionId, isRunning, stopSpeech],
  );

  return (
    <div className="relative h-screen overflow-hidden rounded-3xl border border-keeper-silver/25 shadow-cyanSm">
      <AppBackground />

      <div className="relative z-10 flex h-full min-h-0">
        <SessionHistoryPanel
          open={historyOpen}
          currentSessionId={sessionId}
          onSelect={handleSelectSession}
          refreshKey={historyRefreshKey}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TitleBar
            status={status}
            onOpenSettings={() => setSettingsOpen(true)}
            onNewChat={handleNewChat}
            onToggleHistory={() => setHistoryOpen((v) => !v)}
            historyOpen={historyOpen}
          />
          <AgentWorkflowStrip status={workflow} />
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
          />
          <SettingsDrawer
            open={settingsOpen}
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
    </div>
  );
}

