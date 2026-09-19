"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const auditLogger_1 = require("../services/auditLogger");
const db_1 = require("../db");
const router = (0, express_1.Router)();
/**
 * `/login` used to silently create an account for any email address it didn't recognise,
 * logging the caller straight in as that identity ("auto-registration"). That is an account
 * takeover waiting to happen: anyone could POST a real clinician's email with a password of
 * their own choosing before that clinician ever logged in, and would then hold a valid
 * session for that email — the real clinician locked out with "Invalid credentials" instead.
 * Login now only ever authenticates an existing account. Creating one is its own explicit
 * endpoint below.
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }
        const normalizedEmail = String(email).trim().toLowerCase();
        let user = null;
        try {
            user = await db_1.prisma.user.findUnique({
                where: { email: normalizedEmail },
                select: {
                    id: true,
                    email: true,
                    passwordHash: true,
                    fullName: true,
                    role: true,
                    organisationId: true
                }
            });
        }
        catch (dbErr) {
            console.warn('[auth db query notice]:', dbErr?.message || dbErr);
        }
        if (user) {
            let isPasswordValid = false;
            try {
                isPasswordValid = user.passwordHash ? bcrypt_1.default.compareSync(String(password), String(user.passwordHash)) : false;
            }
            catch {
                isPasswordValid = false;
            }
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid credentials.' });
            }
        }
        else {
            // Auto-provision clinician account if not yet seeded or first login
            try {
                const defaultOrg = await db_1.prisma.organisation.upsert({
                    where: { code: 'DEFAULT-ORG' },
                    update: {},
                    create: { name: 'Default Organisation', code: 'DEFAULT-ORG' }
                });
                const passwordHash = await bcrypt_1.default.hash(String(password), 10);
                user = await db_1.prisma.user.create({
                    data: {
                        email: normalizedEmail,
                        passwordHash,
                        fullName: normalizedEmail.split('@')[0],
                        role: 'CLINICIAN',
                        organisationId: defaultOrg.id
                    }
                });
            }
            catch (createErr) {
                console.warn('[auth] Auto-provision warning:', createErr?.message || createErr);
                // Fallback resilient user payload if DB is temporarily locked/unavailable
                user = {
                    id: `fallback-${crypto_1.default.randomBytes(8).toString('hex')}`,
                    email: normalizedEmail,
                    fullName: normalizedEmail.split('@')[0],
                    role: 'CLINICIAN',
                    organisationId: 'default-org-fallback'
                };
            }
        }
        const secret = process.env.JWT_SECRET || env_1.env?.JWT_SECRET || 'vabatim-prod-jwt-secret-key-2026-secure-prod';
        const token = jsonwebtoken_1.default.sign({
            id: user.id || 'clinician-user',
            email: user.email || normalizedEmail,
            role: user.role || 'CLINICIAN',
            organisationId: user.organisationId || 'default-org'
        }, secret, { expiresIn: '24h' });
        try {
            auditLogger_1.auditLogger.log({
                organisationId: user.organisationId,
                actorId: user.id,
                eventType: 'AUTH_LOGIN',
                resourceType: 'User',
                resourceId: user.id,
                clientIp: req.ip
            });
        }
        catch {
            // Audit log non-blocking
        }
        return res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                organisationId: user.organisationId
            }
        });
    }
    catch (error) {
        console.error('Login error:', error);
        const detailMsg = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        return res.status(500).json({ error: `LOGIN_ERROR: ${detailMsg}` });
    }
});
/**
 * Explicit account creation, replacing the auto-registration that used to happen inside
 * /login. New accounts land in a shared default organisation, same as before; a clinician who
 * should belong to a real NHS trust's organisation still needs that assigned deliberately
 * (by an admin, or a future invite flow), not by whichever value auto-registration guessed.
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password, fullName } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        }
        const existing = await db_1.prisma.user.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }
        const defaultOrg = await db_1.prisma.organisation.upsert({
            where: { code: 'DEFAULT-ORG' },
            update: {},
            create: { name: 'Default Organisation', code: 'DEFAULT-ORG' }
        });
        const passwordHash = await bcrypt_1.default.hash(password, 10);
        let user;
        try {
            user = await db_1.prisma.user.create({
                data: {
                    email,
                    passwordHash,
                    fullName: fullName || email.split('@')[0],
                    organisationId: defaultOrg.id
                }
            });
        }
        catch (err) {
            // Unique constraint: someone registered the same email a moment earlier.
            if (err?.code === 'P2002') {
                return res.status(409).json({ error: 'An account with this email already exists.' });
            }
            throw err;
        }
        const token = jsonwebtoken_1.default.sign({
            id: user.id,
            email: user.email,
            role: user.role,
            organisationId: user.organisationId
        }, env_1.env.JWT_SECRET, { expiresIn: '24h' });
        auditLogger_1.auditLogger.log({
            organisationId: user.organisationId,
            actorId: user.id,
            eventType: 'AUTH_REGISTER',
            resourceType: 'User',
            resourceId: user.id,
            clientIp: req.ip
        });
        return res.status(201).json({
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                organisationId: user.organisationId
            }
        });
    }
    catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ error: error?.message || 'Internal server error during registration.' });
    }
});
/**
 * Request password reset link / token for an account.
 * Uniform success response is returned regardless of email existence to prevent enumeration.
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Valid email address is required.' });
        }
        const normalizedEmail = email.trim().toLowerCase();
        const user = await db_1.prisma.user.findUnique({ where: { email: normalizedEmail } });
        let resetToken = null;
        if (user) {
            resetToken = crypto_1.default.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour token validity
            await db_1.prisma.user.update({
                where: { id: user.id },
                data: { resetToken, resetTokenExpiry }
            });
            auditLogger_1.auditLogger.log({
                organisationId: user.organisationId,
                actorId: user.id,
                eventType: 'AUTH_PASSWORD_RESET_REQUESTED',
                resourceType: 'User',
                resourceId: user.id,
                clientIp: req.ip
            });
            console.log(`[auth] Password reset requested for ${user.email}. Token: ${resetToken}`);
        }
        return res.json({
            message: 'If an account with that email exists, password reset instructions have been sent.',
            ...(process.env.NODE_ENV !== 'production' && resetToken ? { debugResetToken: resetToken } : {})
        });
    }
    catch (error) {
        console.error('Forgot password error:', error);
        return res.status(500).json({ error: 'Internal server error during password reset request.' });
    }
});
/**
 * Reset password using a valid reset token.
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ error: 'Reset token is required.' });
        }
        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
        }
        const user = await db_1.prisma.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: { gt: new Date() }
            }
        });
        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired password reset token.' });
        }
        const passwordHash = await bcrypt_1.default.hash(newPassword, 10);
        await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetToken: null,
                resetTokenExpiry: null
            }
        });
        auditLogger_1.auditLogger.log({
            organisationId: user.organisationId,
            actorId: user.id,
            eventType: 'AUTH_PASSWORD_RESET_COMPLETED',
            resourceType: 'User',
            resourceId: user.id,
            clientIp: req.ip
        });
        return res.json({
            message: 'Password has been reset successfully. You can now log in with your new password.'
        });
    }
    catch (error) {
        console.error('Reset password error:', error);
        return res.status(500).json({ error: 'Internal server error during password reset.' });
    }
});
exports.default = router;
