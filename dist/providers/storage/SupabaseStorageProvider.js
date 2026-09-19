"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseStorageProvider = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const env_1 = require("../../config/env");
const signedLinks_1 = require("../../services/signedLinks");
class SupabaseStorageProvider {
    name = 'SupabaseStorageProvider';
    supabase = null;
    bucketName;
    constructor() {
        this.bucketName = process.env.SUPABASE_BUCKET_NAME || 'vabatim-clinical-storage';
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceRoleKey) {
            this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, serviceRoleKey);
        }
    }
    async upload(key, data, contentType) {
        if (!this.supabase) {
            throw new Error('Supabase storage not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in environment.');
        }
        const { data: result, error } = await this.supabase.storage
            .from(this.bucketName)
            .upload(key, data, { contentType, upsert: true });
        if (error) {
            throw new Error(`Supabase upload failed: ${error.message}`);
        }
        return `supabase://${this.bucketName}/${result.path}`;
    }
    async retrieve(key) {
        if (!this.supabase) {
            throw new Error('[SupabaseStorageProvider] Storage not configured; cannot retrieve object.');
        }
        const { data, error } = await this.supabase.storage.from(this.bucketName).download(key);
        if (error || !data) {
            throw new Error(`[SupabaseStorageProvider] Download failed for ${key}: ${error?.message}`);
        }
        return Buffer.from(await data.arrayBuffer());
    }
    async getSignedUrl(key, expiresInSeconds) {
        if (!this.supabase) {
            const token = (0, signedLinks_1.createSignedLinkToken)(key, expiresInSeconds);
            return `${env_1.env.APP_BASE_URL}/api/documents/secure-access?token=${encodeURIComponent(token)}`;
        }
        const { data, error } = await this.supabase.storage
            .from(this.bucketName)
            .createSignedUrl(key, expiresInSeconds);
        if (error || !data) {
            throw new Error(`Supabase signed URL generation failed: ${error?.message}`);
        }
        return data.signedUrl;
    }
    async delete(key) {
        if (!this.supabase)
            return;
        const { error } = await this.supabase.storage
            .from(this.bucketName)
            .remove([key]);
        if (error) {
            console.error(`Supabase deletion error for key ${key}: ${error.message}`);
        }
    }
}
exports.SupabaseStorageProvider = SupabaseStorageProvider;
