import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron IPC registration boundary', () => {
  it('does not allow feature modules to register unguarded ipcMain handlers', () => {
    const ipcDir = path.join(process.cwd(), 'electron', 'ipc');
    const offenders = fs.readdirSync(ipcDir)
      .filter((name) => name.endsWith('.ts') && name !== 'trusted-ipc.ts')
      .filter((name) => {
        const source = fs.readFileSync(path.join(ipcDir, name), 'utf8');
        return /import\s*\{[^}]*\bipcMain\b[^}]*\}\s*from\s*['"]electron['"]/.test(source);
      });

    expect(offenders).toEqual([]);
  });
});
