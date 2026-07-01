import { broadcastToAllRendererWindows } from '../windows/broadcast';

export function broadcastTasksUpdated(): void {
  broadcastToAllRendererWindows('tasks:updated', { ts: Date.now() });
}
