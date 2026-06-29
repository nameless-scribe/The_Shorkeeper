import { getWindowManager } from '../windows/manager';

export function broadcastTasksUpdated(): void {
  getWindowManager().broadcast('tasks:updated', { ts: Date.now() });
}
