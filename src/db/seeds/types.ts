/** Worldbook 种子条目（与 worldbook_entries 表对应） */
export interface WorldbookSeedEntry {
  id: string;
  keys: string;
  content: string;
  priority: number;
  enabled: boolean;
}

/** app_settings 人设种子 */
export interface PersonaSeed {
  systemPrompt: string;
  version: string;
}
