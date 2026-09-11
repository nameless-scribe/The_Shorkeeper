import path from 'node:path';
import { config } from 'dotenv';
import { getDatabasePath } from '../src/config/paths.js';
import { formatDatabaseHealthReport, inspectDatabaseHealth } from '../src/db/health.js';
import { inspectNativeDatabaseHealth } from '../src/db/health-native.js';
import { resolveDatabaseRuntime } from '../src/db/engine-state.js';

config({ path: path.join(process.cwd(), '.env') });

const runtime = resolveDatabaseRuntime(getDatabasePath());
const report = runtime.engine === 'better-sqlite3'
  ? inspectNativeDatabaseHealth(runtime.databasePath, {
    backupPaths: [runtime.databasePath, runtime.baseDatabasePath],
  })
  : await inspectDatabaseHealth(runtime.databasePath);
report.engine = runtime.engine;
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatDatabaseHealthReport(report));
}

if (report.status === 'critical') {
  process.exitCode = 1;
}
