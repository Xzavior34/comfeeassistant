"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageProvider = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../../config/env");
const signedLinks_1 = require("../../services/signedLinks");
class LocalStorageProvider {
    name = 'LocalStorageProvider';
    storageDir;
    constructor() {
        this.storageDir = path_1.default.resolve(env_1.env.STORAGE_LOCAL_DIR);
        if (!fs_1.default.existsSync(this.storageDir)) {
            fs_1.default.mkdirSync(this.storageDir, { recursive: true });
        }
    }
    async upload(key, data, contentType) {
        const filePath = path_1.default.join(this.storageDir, key);
        const dir = path_1.default.dirname(filePath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(filePath, data);
        return `file://${filePath}`;
    }
    async retrieve(key) {
        const filePath = path_1.default.join(this.storageDir, key.replace(/^file:\/\//, ''));
        if (!fs_1.default.existsSync(filePath)) {
            throw new Error(`[LocalStorageProvider] Object not found: ${key}`);
        }
        return fs_1.default.readFileSync(filePath);
    }
    async getSignedUrl(key, expiresInSeconds) {
        // HMAC-signed: the old unsigned token could be minted by anyone for any document.
        const token = (0, signedLinks_1.createSignedLinkToken)(key, expiresInSeconds);
        return `${env_1.env.APP_BASE_URL}/api/documents/secure-access?token=${encodeURIComponent(token)}`;
    }
    async delete(key) {
        // upload() returns keys as `file://<absolute path>`, and retrieve() strips that prefix
        // before joining — delete() didn't, so a key round-tripped from upload() produced a
        // bogus nested path, existsSync was false, and this silently no-op'd. RetentionService
        // then logged "Deleted resource ... per retention policy" and counted it as deleted while
        // the file stayed on disk indefinitely.
        const filePath = path_1.default.join(this.storageDir, key.replace(/^file:\/\//, ''));
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
    }
}
exports.LocalStorageProvider = LocalStorageProvider;
