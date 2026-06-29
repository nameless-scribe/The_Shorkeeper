import { useCallback, useEffect, useState } from 'react';
import type { DocumentInfo, ImportProgress } from '@/shared/types';

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
      if (doc) {
        await refresh();
      }
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

  if (loading) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs leading-relaxed text-keeper-ice/60">
          导入 MD 或 TXT 文档后，对话将自动检索相关内容并注入上下文。文件保存在工作区 knowledge/
          目录。也可以在聊天中说「<span className="text-keeper-cyan/90">将本次对话计入知识库</span>
          」，系统会提炼当前会话并写入。
        </p>
        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          className="mt-3 w-full rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/15 py-2.5 text-sm font-medium text-keeper-cyan transition hover:bg-keeper-cyan/25 disabled:opacity-50"
        >
          {importing ? '导入中…' : '导入文档'}
        </button>
        {progress && (
          <p className="mt-2 text-xs text-keeper-cyan/80">{formatProgress(progress)}</p>
        )}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>

      {documents.length === 0 ? (
        <p className="text-sm text-keeper-ice/50">暂无导入文档</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-keeper-silver/15 bg-white/5 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-keeper-ice">{doc.filename}</p>
                <p className="mt-0.5 text-[10px] text-keeper-ice/50">
                  {doc.chunkCount} 块 · {formatDate(doc.importedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(doc.id)}
                className="shrink-0 text-xs text-red-400/80 hover:text-red-400"
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
