/**
 * 对一个真实 MySQL 库走一遍 P7.1 连接层：ping（含时区探测）、写权限探测、骨架抓取、取值表抓取。
 * 走的是生产同一条码路（createMysqlConnector + mysql2 驱动），不是另写一套。
 *
 * 刻意的安全设计：
 *   - 不打印密码、不打印任何行数据；样例值与取值表只输出**数量**（计划 §8：样例值不进日志）。
 *   - 不落盘。
 *
 * 用法：在 .env 或环境变量里给出
 *   P7_MYSQL_HOST=192.168.1.10  P7_MYSQL_PORT=3306  P7_MYSQL_DATABASE=erp
 *   P7_MYSQL_USER=reader        P7_MYSQL_PASSWORD=...
 *   可选：P7_MYSQL_SSL=1  P7_MYSQL_TIMEZONE=+08:00  P7_MYSQL_SAMPLES=0（不抓样例）
 * 然后 pnpm p7:probe
 */
import { config } from 'dotenv';
import { connectionConfigFrom, createMysqlConnector } from '../src/datasources/mysql-connector';
import { describeMysqlError, sslWarning } from '../src/datasources/mysql-helpers';

config();

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  console.error(`[p7:probe] 缺少环境变量 ${name}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const host = env('P7_MYSQL_HOST');
  const port = Number(env('P7_MYSQL_PORT', '3306'));
  const database = env('P7_MYSQL_DATABASE');
  const user = env('P7_MYSQL_USER');
  const password = env('P7_MYSQL_PASSWORD', '');
  const ssl = /^(1|true|yes)$/i.test(env('P7_MYSQL_SSL', '0'));
  const timeZone = process.env.P7_MYSQL_TIMEZONE?.trim() || undefined;
  const sampleValues = !/^(0|false|no)$/i.test(env('P7_MYSQL_SAMPLES', '1'));

  console.info(`[p7:probe] ${user}@${host}:${port}/${database} ssl=${ssl ? 'on' : 'off'} timeZone=${timeZone ?? '（跟随服务器）'}`);
  const warning = sslWarning(host, ssl);
  if (warning) console.warn(`[p7:probe] 提醒：${warning}`);

  const connector = createMysqlConnector(connectionConfigFrom({ host, port, database, user, password, options: { ssl, timeZone } }));
  const started = Date.now();
  try {
    const ping = await connector.ping();
    console.info(`[p7:probe] ping OK：MySQL ${ping.serverVersion}，${ping.tableCount} 张表，${ping.latencyMs} ms`);
    console.info(`[p7:probe] 时区：${ping.timeZone.summary}`);
    console.info(`[p7:probe]   NOW()=${ping.timeZone.serverNow}  UTC_TIMESTAMP()=${ping.timeZone.serverUtcNow}  global=${ping.timeZone.globalTimeZone} session=${ping.timeZone.sessionTimeZone} system=${ping.timeZone.systemTimeZone}`);

    const writable = await connector.probeWritable();
    if (writable.writable) console.warn(`[p7:probe] 账号有写权限：${writable.evidence}`);
    else if (writable.hasRoles) console.warn('[p7:probe] 账号通过角色授权，写权限看不出来');
    else console.info('[p7:probe] 账号只读');

    const schema = await connector.fetchSchema({ sampleValues });
    const columns = schema.tables.reduce((sum, table) => sum + table.columns.length, 0);
    const sampled = schema.tables.reduce((sum, table) => sum + table.columns.filter((column) => column.samples.length).length, 0);
    const commented = schema.tables.filter((table) => table.comment).length;
    console.info(`[p7:probe] 骨架：${schema.tables.length} 张表、${columns} 列、${commented} 张表有注释；${sampled} 列拿到样例，${schema.skippedSamples} 张表跳过`);

    const values = await connector.fetchValues(schema.tables);
    const built = Object.values(values.values).filter((list) => list && list.length).length;
    const highCardinality = Object.values(values.values).filter((list) => list === null).length;
    console.info(`[p7:probe] 取值表：扫了 ${values.scannedColumns} 列，建了 ${built} 列，${highCardinality} 列高基数或超时`);

    const probeQuery = await connector.query('SELECT 1 AS ok', [], { maxRows: 1 });
    console.info(`[p7:probe] 流式查询 OK：${probeQuery.columns.join(',')}，${probeQuery.rows.length} 行，${probeQuery.durationMs} ms`);
    console.info(`[p7:probe] 全部完成，${Date.now() - started} ms`);
  } catch (error) {
    console.error(`[p7:probe] 失败：${describeMysqlError(error)}（code=${(error as { code?: string })?.code ?? '?'}）`);
    process.exitCode = 1;
  } finally {
    await connector.close();
  }
}

void main();
