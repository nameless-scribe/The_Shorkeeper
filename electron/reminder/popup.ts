import { dialog, app } from 'electron';
import { showReminderWindow } from '../windows/reminder';

export async function showReminderPopup(title: string, body: string): Promise<void> {
  if (!app.isReady()) {
    console.log(`[reminder] ${title} — ${body}`);
    return;
  }

  app.focus({ steal: true });

  try {
    showReminderWindow(title, body);
  } catch (err) {
    console.error('[reminder] 弹窗失败，降级为系统对话框:', err);
    await dialog.showMessageBox({
      type: 'info',
      title,
      message: body,
      buttons: ['知道了'],
      defaultId: 0,
      noLink: true,
    });
  }
}
