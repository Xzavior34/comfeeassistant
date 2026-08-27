import app from './app';
import { env } from './config/env';
import { execSync } from 'child_process';

const PORT = env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(` Vabatim Backend API running on http://${HOST}:${PORT}`);
  console.log(` Environment: ${env.NODE_ENV}`);
  console.log(` Speech Provider: ${env.SPEECH_PROVIDER}`);
  console.log(` Storage Provider: ${env.STORAGE_PROVIDER}`);
  console.log(`=======================================================`);

  if (process.env.DATABASE_URL) {
    const rawDbUrl = process.env.DATABASE_URL;
    setTimeout(() => {
      try {
        let directUrl = process.env.DIRECT_URL || rawDbUrl;
        if (directUrl.includes(':6543')) {
          directUrl = directUrl.replace(':6543', ':5432').replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');
        }
        console.log('[Database Async Sync] Running prisma db push on direct port...');
        const prismaPath = require.resolve('prisma/build/index.js');
        execSync(`node "${prismaPath}" db push --skip-generate`, {
          stdio: 'inherit',
          env: { ...process.env, DIRECT_URL: directUrl, DATABASE_URL: directUrl }
        });
        console.log('[Database Async Sync] PostgreSQL schema pushed successfully.');
      } catch (err: any) {
        console.error('[Database Async Sync Warning]:', err?.message || err);
      }
    }, 1000);
  }
});
