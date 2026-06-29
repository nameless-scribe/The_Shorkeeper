import { createChatWindow, getWindowManager } from './manager';

export { createChatWindow, getWindowManager };

export function showChatWindow() {
  return getWindowManager().show('chat');
}

export function hideChatWindow() {
  getWindowManager().hide('chat');
}
