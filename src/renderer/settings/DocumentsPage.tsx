import { useCallback, useEffect, useState } from 'react';
import type { DocumentInfo, EmbeddingSettingsInfo, ImportProgress } from '@/shared/types';
import { SettingsSegmented } from './components/SettingsSegmented';
import {
  SettingsActionLink,
  SettingsEmpty,
  SettingsField,
  SettingsIntro,
  SettingsListCard,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSection,
  SETTINGS_INPUT_CLASS,
} from './components/settings-ui';

const BAILIAN_EMBEDDING_HINT =
  'https://llm-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

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
  const [embedding, setEmbedding] = useState<EmbeddingSettingsInfo | null>(null);
  const [embeddingForm, setEmbeddingForm] = useState({
    useChatApi: true,
    baseUrl: '',
    model: 'text-embedding-v3',
    apiKey: '',
  });
  const [embeddingSaving, setEmbeddingSaving] = useState(false);
  const [embeddingSaved, setEmbeddingSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.documents.list();
    setDocuments(list);
    setLoading(false);
  }, []);

  const loadEmbedding = useCallback(async () => {
    const info = await window.shorekeeper.embedding.getSettings();
    setEmbedding(info);
    setEmbeddingForm({
      useChatApi: info.useChatApi,
      baseUrl: info.useChatApi ? '' : info.baseUrl,
      model: info.model,
      apiKey: '',
    });
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    loadEmbedding().catch(console.error);
  }, [refresh, loadEmbedding]);

  useEffect(() => {
    const unsub = window.shorekeeper.documents.onImportProgress((p) => {
      setProgress(p);
    });
    return unsub;
  }, []);

  const handleSaveEmbedding = async () => {
    setEmbeddingSaving(true);
    setEmbeddingSaved(false);
    setError(null);
    try {
      const info = await window.shorekeeper.embedding.setSettings({
        useChatApi: embeddingForm.useChatApi,
        baseUrl: embeddingForm.useChatApi ? undefined : embeddingForm.baseUrl.trim(),
        model: embeddingForm.model.trim() || undefined,
        apiKey: embeddingForm.apiKey.trim() || undefined,
      });
      setEmbedding(info);
      setEmbeddingForm((f) => ({
        ...f,
        apiKey: '',
        baseUrl: info.useChatApi ? '' : info.baseUrl,
        model: info.model,
      }));
      setEmbeddingSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmbeddingSaving(false);
    }
  };

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

  if (loading || !embedding) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        导入 MD 或 TXT 后，对话将自动检索相关内容。第三方 Claude 代理通常<strong className="text-keeper-ice/90">不支持</strong>{' '}
        向量接口，请在下方向量 API 单独配置百炼等 Embedding 接入；对话仍可在 API 设置里使用 Claude。
      </SettingsIntro>

      <SettingsPanel
        title="向量 API（Embedding）"
        subtitle={
          embeddingForm.useChatApi
            ? '当前与对话 API 相同'
            : embedding.apiKeyConfigured
              ? '已单独配置，用于导入与检索'
              : '请填写 Embedding 接入'
        }
        icon="🧬"
        badge={
          embeddingSaved ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] text-emerald-300">
              ✓ 已保存
            </span>
          ) : undefined
        }
      >
        <div className="space-y-2">
          <span className="text-xs font-medium text-keeper-ice/75">向量来源</span>
          <SettingsSegmented
            value={embeddingForm.useChatApi ? 'chat' : 'dedicated'}
            options={[
              { value: 'chat', label: '与对话相同' },
              { value: 'dedicated', label: '单独配置' },
            ]}
            onChange={(value) => {
              setEmbeddingForm((f) => ({ ...f, useChatApi: value === 'chat' }));
              setEmbeddingSaved(false);
            }}
          />
        </div>

        {!embeddingForm.useChatApi && (
          <>
            <SettingsField
              label="Embedding Base URL"
              hint="OpenAI 兼容接入点，百炼以 /compatible-mode/v1 结尾"
            >
              <input
                value={embeddingForm.baseUrl}
                onChange={(e) => {
                  setEmbeddingForm((f) => ({ ...f, baseUrl: e.target.value }));
                  setEmbeddingSaved(false);
                }}
                placeholder={BAILIAN_EMBEDDING_HINT}
                className={`${SETTINGS_INPUT_CLASS} font-mono text-[13px]`}
              />
            </SettingsField>

            <div className="grid gap-4 sm:grid-cols-2">
              <SettingsField label="Embedding 模型" hint="百炼常用 text-embedding-v3">
                <input
                  value={embeddingForm.model}
                  onChange={(e) => {
                    setEmbeddingForm((f) => ({ ...f, model: e.target.value }));
                    setEmbeddingSaved(false);
                  }}
                  placeholder="text-embedding-v3"
                  className={`${SETTINGS_INPUT_CLASS} font-mono text-[13px]`}
                />
              </SettingsField>

              <SettingsField label="Embedding API Key">
                <input
                  type="password"
                  value={embeddingForm.apiKey}
                  onChange={(e) => {
                    setEmbeddingForm((f) => ({ ...f, apiKey: e.target.value }));
                    setEmbeddingSaved(false);
                  }}
                  placeholder={
                    embedding.apiKeyConfigured
                      ? `已配置 ${embedding.apiKeyMasked}`
                      : 'sk- 开头'
                  }
                  autoComplete="off"
                  className={SETTINGS_INPUT_CLASS}
                />
              </SettingsField>
            </div>
          </>
        )}

        {embeddingForm.useChatApi && (
          <p className="text-[11px] leading-relaxed text-keeper-ice/45">
            使用当前对话 API 的 Key 与 Base URL，模型 ID 取{' '}
            <code className="rounded bg-keeper-navyDeep/60 px-1 text-keeper-cyan/90">
              {embedding.model}
            </code>
            （可在 .env 的 EMBEDDING_MODEL 覆盖）。若对话为 Claude 代理且导入失败，请切换为「单独配置」。
          </p>
        )}

        <SettingsPrimaryButton
          className="w-full"
          disabled={
            embeddingSaving ||
            (!embeddingForm.useChatApi &&
              !embeddingForm.baseUrl.trim() &&
              !embedding.baseUrl)
          }
          onClick={() => void handleSaveEmbedding()}
        >
          {embeddingSaving ? '保存中…' : '保存向量配置'}
        </SettingsPrimaryButton>
      </SettingsPanel>

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
