"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
exports.requireRole = requireRole;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    // A token in a query string is written to server access logs, browser history and the
    // Referer header. It is accepted only for document downloads, where a browser navigation
    // cannot carry a header, and never for the rest of the API.
    // originalUrl, not path: this middleware runs inside a mounted router, where req.path is
    // relative to the mount point and would never match the full route.
    const requestPath = (req.originalUrl ?? '').split('?')[0];
    const isDocumentDownload = /^\/api\/documents\/[^/]+\/(pdf|docx)$/.test(requestPath);
    if (!token && isDocumentDownload && typeof req.query.token === 'string' && req.query.token) {
        token = req.query.token;
    }
    if (!token) {
        return res.status(401).json({ error: 'Authentication required. No token provided.' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: `Forbidden. Role ${req.user.role} does not have required permissions.` });
        }
        next();
    };
}
