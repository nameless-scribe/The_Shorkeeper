import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RuntimeGate } from './components/RuntimeGate';
import { ThemeProvider } from './theme/ThemeProvider';
import './styles/globals.css';

const ChatPage = lazy(() => import('./ChatPage').then((module) => ({ default: module.ChatPage })));
const StatusPage = lazy(() => import('./status/StatusPage').then((module) => ({ default: module.StatusPage })));
const SchedulePage = lazy(() => import('./schedule/SchedulePage').then((module) => ({ default: module.SchedulePage })));
const ReminderPage = lazy(() => import('./reminder/ReminderPage').then((module) => ({ default: module.ReminderPage })));
const DockPage = lazy(() => import('./dock/DockPage').then((module) => ({ default: module.DockPage })));
const SplashPage = lazy(() => import('./splash/SplashPage').then((module) => ({ default: module.SplashPage })));
const CallStage = lazy(() => import('./call/CallStage').then((module) => ({ default: module.CallStage })));

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
    <Suspense fallback={null}><App /></Suspense>
  ) : (
    <ErrorBoundary>
      <RuntimeGate>
        <ThemeProvider>
          <Suspense fallback={null}><App /></Suspense>
        </ThemeProvider>
      </RuntimeGate>
    </ErrorBoundary>
  );

ReactDOM.createRoot(root).render(
  <React.StrictMode>{appTree}</React.StrictMode>,
);
