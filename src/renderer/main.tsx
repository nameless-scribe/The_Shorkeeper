import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatPage } from './ChatPage';
import { StatusPage } from './status/StatusPage';
import { SchedulePage } from './schedule/SchedulePage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RuntimeGate } from './components/RuntimeGate';
import './styles/globals.css';

function resolvePanel(): 'chat' | 'status' | 'schedule' {
  const panel = new URLSearchParams(window.location.search).get('panel');
  if (panel === 'status' || panel === 'schedule') return panel;
  return 'chat';
}

function App() {
  const panel = resolvePanel();
  if (panel === 'status') return <StatusPage />;
  if (panel === 'schedule') return <SchedulePage />;
  return <ChatPage />;
}

const root = document.getElementById('root')!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RuntimeGate>
        <App />
      </RuntimeGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
