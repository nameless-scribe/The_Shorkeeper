import { getWindowManager } from './manager';

export function createStatusWindow() {
  return getWindowManager().create('status');
}

export function showStatusWindow() {
  return getWindowManager().show('status');
}

export function hideStatusWindow() {
  getWindowManager().hide('status');
}

export function toggleStatusWindow() {
  getWindowManager().toggle('status');
}
