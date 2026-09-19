"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const env_1 = require("./config/env");
const child_process_1 = require("child_process");
const PORT = env_1.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app_1.default.listen(PORT, HOST, () => {
    console.log(`=======================================================`);
    console.log(` Vabatim Backend API running on http://${HOST}:${PORT}`);
    console.log(` Environment: ${env_1.env.NODE_ENV}`);
    console.log(` Speech Provider: ${env_1.env.SPEECH_PROVIDER}`);
    console.log(` Storage Provider: ${env_1.env.STORAGE_PROVIDER}`);
    console.log(`=======================================================`);
    if (process.env.DATABASE_URL) {
        if (!process.env.DIRECT_URL) {
            process.env.DIRECT_URL = process.env.DATABASE_URL;
        }
        const rawDbUrl = process.env.DATABASE_URL;
        setTimeout(() => {
            try {
                let directUrl = process.env.DIRECT_URL || rawDbUrl;
                if (directUrl.includes(':6543')) {
                    directUrl = directUrl.replace(':6543', ':5432').replace('?pgbouncer=true', '').replace('&pgbouncer=true', '');
                }
                console.log('[Database Async Sync] Running prisma db push...');
                (0, child_process_1.execSync)(`npx prisma db push --skip-generate`, {
                    stdio: 'inherit',
                    env: { ...process.env, DIRECT_URL: directUrl, DATABASE_URL: directUrl }
                });
                console.log('[Database Async Sync] PostgreSQL schema pushed successfully.');
                console.log('[Database Async Sync] Running seed check...');
                (0, child_process_1.execSync)(`npx ts-node prisma/seed.ts`, {
                    stdio: 'inherit',
                    env: { ...process.env, DIRECT_URL: directUrl, DATABASE_URL: directUrl }
                });
                console.log('[Database Async Sync] Seed check finished.');
            }
            catch (err) {
                console.error('[Database Async Sync Warning]:', err?.message || err);
            }
        }, 1000);
    }
});
