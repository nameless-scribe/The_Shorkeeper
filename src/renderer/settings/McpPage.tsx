import { useCallback, useEffect, useState } from 'react';
import type { McpServerInfo } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsField,
  SettingsInlineActions,
  SettingsIntro,
  SettingsListCard,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SETTINGS_INPUT_CLASS,
} from './components/settings-ui';

const EMPTY_FORM = {
  name: '',
  command: '',
  args: '',
  env: '',
};

export function McpPage() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const list = await window.shorekeeper.mcp.list();
    setServers(list);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.command.trim()) return;
    setSaving(true);
    try {
      let args: string[] = [];
      let env: Record<string, string> = {};
      if (form.args.trim()) args = JSON.parse(form.args) as string[];
      if (form.env.trim()) env = JSON.parse(form.env) as Record<string, string>;

      await window.shorekeeper.mcp.create({
        name: form.name.trim(),
        command: form.command.trim(),
        args,
        env,
        enabled: true,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (server: McpServerInfo) => {
    await window.shorekeeper.mcp.update(server.id, { enabled: !server.enabled });
    await load();
  };

  const remove = async (id: string) => {
    await window.shorekeeper.mcp.delete(id);
    await load();
  };

  const test = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await window.shorekeeper.mcp.test(id);
      if (result.ok) {
        setTestResult(
          `连接成功，发现 ${result.tools.length} 个工具：${result.tools.join(', ') || '无'}`,
        );
      } else {
        setTestResult(result.error ?? '连接失败');
      }
    } finally {
      setTestingId(null);
    }
  };

  return (
    <SettingsPageShell>
      <SettingsIntro>
        MCP Server 通过 stdio 启动，工具名以{' '}
        <code className="rounded bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-cyan/90">
          mcp__服务器__工具
        </code>{' '}
        注册到 Agent。
      </SettingsIntro>

      <SettingsPanel title="添加 MCP Server" icon="🔌">
        <SettingsField label="名称">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="filesystem"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>
        <SettingsField label="启动命令">
          <input
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            placeholder="npx"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>
        <SettingsField label="参数 JSON" hint='如 ["-y","@modelcontextprotocol/server-filesystem","D:\\workspace"]'>
          <input
            value={form.args}
            onChange={(e) => setForm({ ...form, args: e.target.value })}
            className={`${SETTINGS_INPUT_CLASS} font-mono text-[12px]`}
          />
        </SettingsField>
        <SettingsField label="环境变量 JSON（可选）">
          <input
            value={form.env}
            onChange={(e) => setForm({ ...form, env: e.target.value })}
            placeholder='{"KEY":"value"}'
            className={`${SETTINGS_INPUT_CLASS} font-mono text-[12px]`}
          />
        </SettingsField>
        <SettingsPrimaryButton
          className="w-full"
          disabled={saving}
          onClick={() => void handleCreate()}
        >
          {saving ? '添加中…' : '添加 Server'}
        </SettingsPrimaryButton>
      </SettingsPanel>

      {testResult && (
        <p className="rounded-xl border border-keeper-cyan/20 bg-keeper-cyan/5 px-3 py-2 text-xs text-keeper-ice/75">
          {testResult}
        </p>
      )}

      <SettingsPanel title="已注册 Server" subtitle={`${servers.length} 个`} icon="📡">
        {servers.length === 0 ? (
          <SettingsEmpty title="暂无 MCP Server" />
        ) : (
          <div className="space-y-2">
            {servers.map((server) => (
              <SettingsListCard
                key={server.id}
                title={server.name}
                subtitle={`${server.command} ${server.args.join(' ')}`}
                badge={
                  server.enabled ? (
                    <SettingsBadge tone="green">已启用</SettingsBadge>
                  ) : (
                    <SettingsBadge tone="muted">已禁用</SettingsBadge>
                  )
                }
                actions={
                  <SettingsInlineActions>
                    <SettingsActionLink onClick={() => void toggleEnabled(server)}>
                      {server.enabled ? '禁用' : '启用'}
                    </SettingsActionLink>
                    <SettingsActionLink
                      onClick={() => void test(server.id)}
                    >
                      {testingId === server.id ? '测试中…' : '测试'}
                    </SettingsActionLink>
                    <SettingsActionLink onClick={() => void remove(server.id)} danger>
                      删除
                    </SettingsActionLink>
                  </SettingsInlineActions>
                }
              />
            ))}
          </div>
        )}
      </SettingsPanel>
    </SettingsPageShell>
  );
}
