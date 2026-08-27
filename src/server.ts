import app from './app';
import { env } from './config/env';

import { execSync } from 'child_process';

const PORT = env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (process.env.DATABASE_URL) {
  try {
    console.log('[Database Sync] Synchronising PostgreSQL schema via prisma db push...');
    const prismaCliPath = require.resolve('prisma/build/index.js');
    execSync(`node "${prismaCliPath}" db push --skip-generate`, { stdio: 'inherit', env: process.env });
    console.log('[Database Sync] PostgreSQL schema synchronised successfully.');
  } catch (err: any) {
    console.error('[Database Sync Warning]:', err.message || err);
  }
}

app.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(` Vabatim Backend API running on http://${HOST}:${PORT}`);
  console.log(` Environment: ${env.NODE_ENV}`);
  console.log(` Speech Provider: ${env.SPEECH_PROVIDER}`);
  console.log(` Storage Provider: ${env.STORAGE_PROVIDER}`);
  console.log(`=======================================================`);
});
