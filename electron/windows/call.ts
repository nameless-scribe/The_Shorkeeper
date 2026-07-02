import { getWindowManager } from './manager';

export function createCallWindow() {
  return getWindowManager().create('call');
}

export function showCallWindow() {
  return getWindowManager().show('call');
}

export function hideCallWindow() {
  getWindowManager().hide('call');
}
