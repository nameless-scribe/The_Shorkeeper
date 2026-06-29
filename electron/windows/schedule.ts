import { getWindowManager } from './manager';

export function createScheduleWindow() {
  return getWindowManager().create('schedule');
}

export function showScheduleWindow() {
  return getWindowManager().show('schedule');
}

export function hideScheduleWindow() {
  getWindowManager().hide('schedule');
}

export function toggleScheduleWindow() {
  getWindowManager().toggle('schedule');
}
