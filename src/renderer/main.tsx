import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatPage } from './ChatPage';
import { StatusPage } from './status/StatusPage';
import { SchedulePage } from './schedule/SchedulePage';
import { ReminderPage } from './reminder/ReminderPage';
import { DockPage } from './dock/DockPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RuntimeGate } from './components/RuntimeGate';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles/globals.css';

function resolvePanel(): 'chat' | 'status' | 'schedule' | 'reminder' | 'dock' {
  const panel = new URLSearchParams(window.location.search).get('panel');
  if (
    panel === 'status' ||
    panel === 'schedule' ||
    panel === 'reminder' ||
    panel === 'dock'
  ) {
    return panel;
  }
  return 'chat';
}

function App() {
  const panel = resolvePanel();
  if (panel === 'status') return <StatusPage />;
  if (panel === 'schedule') return <SchedulePage />;
  if (panel === 'reminder') return <ReminderPage />;
  if (panel === 'dock') return <DockPage />;
  return <ChatPage />;
}

const root = document.getElementById('root')!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RuntimeGate>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </RuntimeGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
