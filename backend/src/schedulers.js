import cron from 'node-cron';

export function startSchedulers() {
  const tz = process.env.JOB_TZ || 'America/Bogota';

  // Lunes 00:10 hora Bogotá
  cron.schedule('10 0 * * 1', async () => {
    console.log('[cron] ETM weekly sync starting...');
    const mod = await import('./jobs/etm_weekly_sync.js');
    await mod.runWeeklySync();
    console.log('[cron] ETM weekly sync done.');
  }, { timezone: tz });

  console.log(`Schedulers enabled (TZ=${tz})`);
}
