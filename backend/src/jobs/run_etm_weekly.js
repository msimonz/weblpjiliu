import 'dotenv/config';
import { runWeeklySync } from './etm_weekly_sync.js';

console.log('[RUNNER] starting ETM weekly sync...');
runWeeklySync()
  .then(() => {
    console.log('[RUNNER] done.');
  })
  .catch((err) => {
    console.error('[RUNNER] failed:', err?.stack || err);
    process.exit(1);
  });
