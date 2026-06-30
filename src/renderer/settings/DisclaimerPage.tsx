import { SettingsPageShell, SettingsPanel } from './components/settings-ui';

export function DisclaimerPage() {
  return (
    <SettingsPageShell>
      <SettingsPanel title="免责声明" subtitle="使用前请知悉" icon="⚠️">
        <div className="space-y-4 text-xs leading-relaxed text-keeper-ice/70">
          <p>
            The Shorekeeper（守岸人）为个人自用桌面 AI Agent，仅供学习与私人辅助使用。
            请勿将本软件用于违法、侵权或危害他人权益的行为。
          </p>
          <p>
            Agent 生成的内容、工具执行结果（含文件写入、网络请求、记账数据等）由用户自行判断与承担风险。
            联网搜索、网页抓取、MCP 第三方工具可能访问外部服务，请注意数据与 API Key 安全。
          </p>
          <p>
            本软件按「现状」提供，不提供任何明示或暗示的保证。使用即表示您理解并接受上述限制。
          </p>
        </div>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
