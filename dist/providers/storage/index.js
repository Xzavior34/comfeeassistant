"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStorageProvider = getStorageProvider;
const LocalStorageProvider_1 = require("./LocalStorageProvider");
const SupabaseStorageProvider_1 = require("./SupabaseStorageProvider");
const env_1 = require("../../config/env");
function getStorageProvider() {
    if (env_1.env.STORAGE_PROVIDER === 'supabase') {
        return new SupabaseStorageProvider_1.SupabaseStorageProvider();
    }
    return new LocalStorageProvider_1.LocalStorageProvider();
}
