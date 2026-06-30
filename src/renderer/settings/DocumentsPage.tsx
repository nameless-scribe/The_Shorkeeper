import { useCallback, useEffect, useState } from 'react';
import type { DocumentInfo, ImportProgress } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsEmpty,
  SettingsIntro,
  SettingsListCard,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSection,
} from './components/settings-ui';

function formatProgress(progress: ImportProgress | null): string {
  if (!progress) return '';
  switch (progress.phase) {
    case 'reading':
      return '正在读取文件…';
    case 'chunking':
      return `分块完成，共 ${progress.chunkCount} 段`;
    case 'embedding':
      return `向量化 ${progress.done}/${progress.total}…`;
    case 'done':
      return `导入完成：${progress.document.filename}`;
    default:
      return '';
  }
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.documents.list();
    setDocuments(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  useEffect(() => {
    const unsub = window.shorekeeper.documents.onImportProgress((p) => {
      setProgress(p);
    });
    return unsub;
  }, []);

  const handleImport = async () => {
    setError(null);
    setImporting(true);
    setProgress(null);
    try {
      const doc = await window.shorekeeper.documents.import();
      if (doc) await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await window.shorekeeper.documents.delete(id);
    await refresh();
  };

  if (loading) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        导入 MD 或 TXT 后，对话将自动检索相关内容。文件保存在工作区 knowledge/ 目录。
        也可在聊天中说「<span className="text-keeper-cyan/90">将本次对话计入知识库</span>」提炼会话。
      </SettingsIntro>

      <SettingsPanel title="导入文档" icon="📥">
        <SettingsPrimaryButton
          className="w-full"
          disabled={importing}
          onClick={() => void handleImport()}
        >
          {importing ? '导入中…' : '选择文件导入'}
        </SettingsPrimaryButton>
        {progress && (
          <p className="text-center text-xs text-keeper-cyan/80">{formatProgress(progress)}</p>
        )}
        {error && <p className="text-xs text-red-300/80">{error}</p>}
      </SettingsPanel>

      <SettingsSection title="知识库" hint={`${documents.length} 个文档`}>
        {documents.length === 0 ? (
          <SettingsEmpty title="暂无导入文档" hint="点击上方按钮导入 MD / TXT" />
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <SettingsListCard
                key={doc.id}
                title={doc.filename}
                meta={`${doc.chunkCount} 块 · ${formatDate(doc.importedAt)}`}
                actions={
                  <SettingsActionLink onClick={() => void handleDelete(doc.id)} danger>
                    删除
                  </SettingsActionLink>
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
