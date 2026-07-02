import { useCallback, useEffect, useState } from 'react';
import type { UpdateInfo } from '@/shared/types';
import { TETHYS_EMBLEM_URL } from '../public-assets';
import { TethysEmblem } from '../components/TethysEmblem';
import {
  SettingsIntro,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from './components/settings-ui';

const STATUS_LABEL: Record<UpdateInfo['status'], string> = {
  idle: '尚未检查',
  checking: '正在检查…',
  available: '发现新版本，正在下载…',
  'not-available': '已是最新版本',
  downloading: '正在下载…',
  downloaded: '更新已下载，可重启安装',
  error: '检查失败',
};

const AUTHOR_QQ = '2335677859';

function formatStatus(info: UpdateInfo): string {
  const base = STATUS_LABEL[info.status];
  if (info.version && info.status !== 'not-available') {
    return `${base}（${info.version}）`;
  }
  if (info.version && info.status === 'not-available') {
    return `${base}（当前 ${info.version}）`;
  }
  return base;
}

export function AboutPage() {
  const [version, setVersion] = useState('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo>({ status: 'idle' });
  const [checking, setChecking] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!window.shorekeeper?.update) return;
    const [ver, status] = await Promise.all([
      window.shorekeeper.update.getVersion(),
      window.shorekeeper.update.getStatus(),
    ]);
    setVersion(ver);
    setUpdateInfo(status);
  }, []);

  useEffect(() => {
    void refreshStatus();
    if (!window.shorekeeper?.update) return undefined;

    const off = window.shorekeeper.update.onStatus((info) => {
      setUpdateInfo(info);
      if (info.status !== 'checking') {
        setChecking(false);
      }
    });

    return off;
  }, [refreshStatus]);

  const handleCheck = async () => {
    if (!window.shorekeeper?.update) return;
    setChecking(true);
    setUpdateInfo({ status: 'checking' });
    try {
      const result = await window.shorekeeper.update.check();
      setUpdateInfo(result);
    } finally {
      setChecking(false);
    }
  };

  const handleInstall = () => {
    void window.shorekeeper?.update?.install();
  };

  const handleCopyQq = async () => {
    try {
      await navigator.clipboard.writeText(AUTHOR_QQ);
    } catch {
      /* ignore */
    }
  };

  const isBusy = checking || updateInfo.status === 'checking' || updateInfo.status === 'downloading';

  return (
    <SettingsPageShell>
      <SettingsIntro>
        首次安装后，后续版本可通过联网自动更新，无需重新下载完整安装包。更新不会影响你的对话、设置与自定义外观。
      </SettingsIntro>

      <SettingsPanel title="关于" subtitle="版本与更新" icon="ℹ️">
        <div className="space-y-4">
          <div className="rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 px-4 py-3">
            <p className="text-[11px] text-keeper-ice/45">当前版本</p>
            <p className="mt-1 font-mono text-sm text-keeper-cyan">v{version || '…'}</p>
          </div>

          <div className="rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 px-4 py-3">
            <p className="text-[11px] text-keeper-ice/45">更新状态</p>
            <p className="mt-1 text-sm text-keeper-ice/85">{formatStatus(updateInfo)}</p>
            {updateInfo.status === 'downloading' && updateInfo.progress != null && (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-keeper-silver/10">
                  <div
                    className="h-full rounded-full bg-keeper-cyan transition-[width] duration-300"
                    style={{ width: `${updateInfo.progress}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-keeper-ice/40">{updateInfo.progress}%</p>
              </div>
            )}
            {updateInfo.error && (
              <p className="mt-2 text-xs leading-relaxed text-red-300/90">{updateInfo.error}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <SettingsPrimaryButton disabled={isBusy} onClick={() => void handleCheck()}>
              {isBusy ? '检查中…' : '检查更新'}
            </SettingsPrimaryButton>
            {updateInfo.status === 'downloaded' && (
              <SettingsSecondaryButton onClick={handleInstall}>重启并安装</SettingsSecondaryButton>
            )}
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel title="联系作者" subtitle="反馈、建议与问题咨询" imageIcon={TETHYS_EMBLEM_URL}>
        <div className="flex items-center gap-3 rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 px-4 py-3">
          <TethysEmblem size="md" rounded="2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-keeper-ice/45">作者 QQ</p>
            <p className="mt-1 font-mono text-sm text-keeper-cyan">{AUTHOR_QQ}</p>
          </div>
          <SettingsSecondaryButton onClick={() => void handleCopyQq()}>
            复制
          </SettingsSecondaryButton>
        </div>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
