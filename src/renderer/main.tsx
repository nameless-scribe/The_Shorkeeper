import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatPage } from './ChatPage';
import { StatusPage } from './status/StatusPage';
import { SchedulePage } from './schedule/SchedulePage';
import { ReminderPage } from './reminder/ReminderPage';
import { DockPage } from './dock/DockPage';
import { SplashPage } from './splash/SplashPage';
import { CallStage } from './call/CallStage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RuntimeGate } from './components/RuntimeGate';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles/globals.css';

function resolvePanel(): 'chat' | 'status' | 'schedule' | 'reminder' | 'dock' | 'splash' | 'call' {
  const panel = new URLSearchParams(window.location.search).get('panel');
  if (
    panel === 'status' ||
    panel === 'schedule' ||
    panel === 'reminder' ||
    panel === 'dock' ||
    panel === 'splash' ||
    panel === 'call'
  ) {
    return panel;
  }
  return 'chat';
}

const initialPanel = resolvePanel();
if (initialPanel === 'dock') {
  document.documentElement.classList.add('panel-transparent');
} else if (initialPanel !== 'splash') {
  document.documentElement.classList.add('keeper-window');
}

function App() {
  const panel = initialPanel;
  if (panel === 'status') return <StatusPage />;
  if (panel === 'schedule') return <SchedulePage />;
  if (panel === 'reminder') return <ReminderPage />;
  if (panel === 'dock') return <DockPage />;
  if (panel === 'splash') return <SplashPage />;
  if (panel === 'call') return <CallStage />;
  return <ChatPage />;
}

const root = document.getElementById('root')!;

const appTree =
  initialPanel === 'splash' ? (
    <App />
  ) : (
    <ErrorBoundary>
      <RuntimeGate>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </RuntimeGate>
    </ErrorBoundary>
  );

ReactDOM.createRoot(root).render(
  <React.StrictMode>{appTree}</React.StrictMode>,
);
