import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { getAppearanceDir } from '../../src/config/paths';
import {
  APPEARANCE_ASSET_SCHEME,
  parseAppearanceAssetFilename,
} from '../../src/shared/appearance-asset-url';

export function registerAppearanceAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APPEARANCE_ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerAppearanceAssetProtocol(): void {
  protocol.handle(APPEARANCE_ASSET_SCHEME, async (request) => {
    const filename = parseAppearanceAssetFilename(request.url);
    if (!filename) {
      return new Response('Forbidden', { status: 403 });
    }

    const base = path.resolve(getAppearanceDir());
    const abs = path.resolve(base, filename);

    if (!abs.startsWith(base + path.sep) && abs !== base) {
      return new Response('Forbidden', { status: 403 });
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return new Response('Not Found', { status: 404 });
    }

    return net.fetch(pathToFileURL(abs).href);
  });
}
