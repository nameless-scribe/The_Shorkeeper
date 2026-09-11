import { useCallback, useEffect, useState } from 'react';
import type { DocumentInfo, EmbeddingSettingsInfo, ImportProgress, ReindexProgress } from '@/shared/types';
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

const BAILIAN_URL_PLACEHOLDER =
  '从百炼控制台复制，勿填 llm-xxxx 占位符';

function hasPlaceholderUrl(url: string): boolean {
  return /xxxx/i.test(url);
}

function formatProgress(progress: ImportProgress | null): string {
  if (!progress) return '';
  switch (progress.phase) {
    case 'reading':
      return '正在读取文件…';
    case 'chunking':
      return `分块完成，共 ${progress.chunkCount} 段`;
    case 'embedding':
      return `向量化 ${progress.done}/${progress.total}…`;
    case 'retrying':
      return `向量服务暂时失败，正在重试 ${progress.attempt}/${progress.maxAttempts}（${progress.done}/${progress.total}）…`;
    case 'done':
      return `导入完成：${progress.document.filename}`;
    case 'skipped':
      return `已跳过：${progress.reason}（${progress.document.filename}）`;
    default:
      return '';
  }
}

function formatReindexProgress(progress: ReindexProgress | null): string {
  if (!progress) return '';
  if (progress.total === 0) return '无文档需要重建';
  const failed = progress.failed ? ` · 失败 ${progress.failed}` : '';
  return `重建向量 ${progress.done}/${progress.total}${progress.filename ? ` · ${progress.filename}` : ''}${failed}`;
}

function formatDocumentStatus(doc: DocumentInfo): string {
  switch (doc.status) {
    case 'importing':
      return '导入中';
    case 'indexed':
      return '已索引';
    case 'index_failed':
      return '索引失败';
    case 'needs_rebuild':
      return '需要重建';
    case 'superseded':
      return '历史版本';
    default:
      return doc.status;
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
  const [embeddingTesting, setEmbeddingTesting] = useState(false);
  const [embeddingTestMessage, setEmbeddingTestMessage] = useState<string | null>(null);
  const [embeddingSaved, setEmbeddingSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexingDocId, setReindexingDocId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [reindexProgress, setReindexProgress] = useState<ReindexProgress | null>(null);
  const [embeddingMismatch, setEmbeddingMismatch] = useState(false);
  const [storedDimensions, setStoredDimensions] = useState<number[]>([]);
  const [indexMismatchReasons, setIndexMismatchReasons] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.documents.list();
    setDocuments(list);
    const mismatch = await window.shorekeeper.documents.embeddingMismatch();
    setEmbeddingMismatch(mismatch.hasMismatch);
    setStoredDimensions(mismatch.storedDimensions);
    const reasons: string[] = [];
    if (mismatch.modelMismatch) {
      reasons.push(`模型记录：${mismatch.storedModels.join('、') || '缺失'}`);
    }
    if (mismatch.dimensionMismatch) {
      reasons.push(`向量维度：${mismatch.storedDimensions.join('、') || '缺失'}`);
    }
    if (mismatch.chunkConfigMismatch) {
      reasons.push(
        `分块配置：${mismatch.storedChunkConfigs.map((item) => `${item.size}/${item.overlap}`).join('、')}`,
      );
    }
    setIndexMismatchReasons(reasons);
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

  useEffect(() => {
    const unsub = window.shorekeeper.documents.onReindexProgress((p) => {
      setReindexProgress(p);
    });
    return unsub;
  }, []);

  const handleTestEmbedding = async () => {
    setEmbeddingTesting(true);
    setEmbeddingTestMessage(null);
    setError(null);
    try {
      if (!embeddingForm.useChatApi) {
        await window.shorekeeper.embedding.setSettings({
          useChatApi: false,
          baseUrl: embeddingForm.baseUrl.trim() || undefined,
          model: embeddingForm.model.trim() || undefined,
          apiKey: embeddingForm.apiKey.trim() || undefined,
        });
      }
      const result = await window.shorekeeper.embedding.test();
      setEmbeddingTestMessage(result.message);
      if (!result.ok) setError(result.message);
      await loadEmbedding();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setEmbeddingTestMessage(message);
      setError(message);
    } finally {
      setEmbeddingTesting(false);
    }
  };

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
      await refresh();
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

  const handleReindex = async () => {
    if (!confirm('将使用当前 Embedding 模型重建全部文档向量，是否继续？')) return;
    setError(null);
    setReindexing(true);
    setReindexProgress(null);
    try {
      const result = await window.shorekeeper.documents.reindex();
      await refresh();
      if (result.failed > 0) {
        setError(`重建完成，但有 ${result.failed} 个文档失败，可在文档列表中单独重试。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReindexing(false);
    }
  };

  const handleDelete = async (id: string) => {
    await window.shorekeeper.documents.delete(id);
    await refresh();
  };

  const handleReindexOne = async (id: string) => {
    setError(null);
    setReindexingDocId(id);
    try {
      await window.shorekeeper.documents.reindexOne(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
    } finally {
      setReindexingDocId(null);
    }
  };

  if (loading || !embedding) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        导入 MD、TXT、DOCX 或 PDF 后，对话将按性能设置中的 RAG 模式检索相关内容。第三方 Claude
        代理通常<strong className="text-keeper-ice/90">不支持</strong>{' '}
        向量接口，请在下方向量 API 单独配置百炼等 Embedding 接入；对话仍可在 API 设置里使用 Claude。
      </SettingsIntro>

      {embeddingMismatch && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
          知识库索引配置与当前设置不一致
          {indexMismatchReasons.length
            ? `（${indexMismatchReasons.join('；')}）`
            : storedDimensions.length ? `（维度 ${storedDimensions.join('、')}）` : ''}
          ，检索可能失效。请确认 Embedding 模型配置后点击「重建全部向量」。
        </p>
      )}

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
              hint="推荐 https://dashscope.aliyuncs.com/compatible-mode/v1（注意含 /v1）"
            >
              <input
                value={embeddingForm.baseUrl}
                onChange={(e) => {
                  setEmbeddingForm((f) => ({ ...f, baseUrl: e.target.value }));
                  setEmbeddingSaved(false);
                  setEmbeddingTestMessage(null);
                }}
                placeholder="https://llm-你的ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
                className={`${SETTINGS_INPUT_CLASS} font-mono text-[13px]`}
              />
            </SettingsField>
            {(hasPlaceholderUrl(embeddingForm.baseUrl) ||
              hasPlaceholderUrl(embedding.baseUrl)) && (
              <p className="rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
                当前 URL 含有占位符 <code>xxxx</code>，百炼会报 Workspace access denied。
                请从控制台复制真实地址（可与「API 设置」里 qwen 配置的 Base URL 相同）。
              </p>
            )}

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

        <div className="flex gap-2">
          <SettingsPrimaryButton
            className="flex-1"
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
          <SettingsPrimaryButton
            className="shrink-0 px-4"
            disabled={embeddingTesting}
            onClick={() => void handleTestEmbedding()}
          >
            {embeddingTesting ? '测试中…' : '测试连接'}
          </SettingsPrimaryButton>
        </div>
        {embeddingTestMessage && (
          <p
            className={`text-center text-xs ${
              embeddingTestMessage.includes('成功') ? 'text-emerald-300/90' : 'text-keeper-cyan/80'
            }`}
          >
            {embeddingTestMessage}
          </p>
        )}
      </SettingsPanel>

      <SettingsPanel title="导入文档" icon="📥">
        <SettingsPrimaryButton
          className="w-full"
          disabled={importing || reindexing}
          onClick={() => void handleImport()}
        >
          {importing ? '导入中…' : '选择文件导入'}
        </SettingsPrimaryButton>
        {documents.length > 0 && (
          <SettingsPrimaryButton
            className="w-full"
            disabled={importing || reindexing}
            onClick={() => void handleReindex()}
          >
            {reindexing ? '重建中…' : '重建全部向量'}
          </SettingsPrimaryButton>
        )}
        {progress && (
          <p className="text-center text-xs text-keeper-cyan/80">{formatProgress(progress)}</p>
        )}
        {reindexProgress && (
          <p className="text-center text-xs text-keeper-cyan/80">
            {formatReindexProgress(reindexProgress)}
          </p>
        )}
        {error && <p className="text-xs text-red-300/80">{error}</p>}
      </SettingsPanel>

      <SettingsSection title="知识库" hint={`${documents.length} 个文档`}>
        {documents.length === 0 ? (
          <SettingsEmpty title="暂无导入文档" hint="点击上方按钮导入 MD / TXT / DOCX / PDF" />
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <SettingsListCard
                key={doc.id}
                title={`${doc.title} · v${doc.version}`}
                meta={`${doc.filename} · ${formatDocumentStatus(doc)} · ${doc.chunkCount} 块 · ${formatDate(doc.importedAt)}${doc.statusError ? ` · ${doc.statusError}` : ''}`}
                actions={
                  <>
                    {doc.status !== 'indexed' && (
                      <SettingsActionLink
                        onClick={() => void handleReindexOne(doc.id)}
                        disabled={reindexingDocId === doc.id || reindexing}
                      >
                        {reindexingDocId === doc.id ? '重建中…' : '重试索引'}
                      </SettingsActionLink>
                    )}
                    <SettingsActionLink onClick={() => void handleDelete(doc.id)} danger>
                      删除
                    </SettingsActionLink>
                  </>
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
