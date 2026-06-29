import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChatPage } from './ChatPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RuntimeGate } from './components/RuntimeGate';
import './styles/globals.css';

const root = document.getElementById('root')!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RuntimeGate>
        <ChatPage />
      </RuntimeGate>
    </ErrorBoundary>
  </React.StrictMode>,
);
