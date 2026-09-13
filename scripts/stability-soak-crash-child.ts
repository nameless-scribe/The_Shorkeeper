import { openNativeDatabase } from '../src/db/native-adapter';
import { createSession } from '../src/db/repositories/sessions';
import { insertMessage } from '../src/db/repositories/messages';

const dbPath = process.argv[2];
if (!dbPath) throw new Error('缺少压测数据库路径');

const db = openNativeDatabase(dbPath, { allowExisting: true });
const session = createSession(db, 'crash-recovery-marker');
insertMessage(session.id, 'user', 'committed-before-crash', null, db);

// Intentionally bypass close/checkpoint to simulate forced process termination.
process.exit(23);
