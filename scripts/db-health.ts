import path from 'node:path';
import { config } from 'dotenv';
import { getDatabasePath } from '../src/config/paths.js';
import { formatDatabaseHealthReport, inspectDatabaseHealth } from '../src/db/health.js';

config({ path: path.join(process.cwd(), '.env') });

const report = await inspectDatabaseHealth(getDatabasePath());
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatDatabaseHealthReport(report));
}

if (report.status === 'critical') {
  process.exitCode = 1;
}
