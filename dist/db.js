"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl && !dbUrl.includes('sslmode=') && dbUrl.startsWith('postgres')) {
    dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'sslmode=require';
}
if (dbUrl && dbUrl.includes('6543') && !dbUrl.includes('pgbouncer=true')) {
    dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connection_limit=3&pool_timeout=10';
}
else if (dbUrl && !dbUrl.includes('connection_limit') && dbUrl.startsWith('postgres')) {
    dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'connection_limit=3&pool_timeout=10';
}
exports.prisma = new client_1.PrismaClient({
    datasources: {
        db: {
            url: dbUrl
        }
    }
});
