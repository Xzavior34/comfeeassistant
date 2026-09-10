import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { auditLogger } from '../services/auditLogger';
import { prisma } from '../db';

const router = Router();

/**
 * `/login` used to silently create an account for any email address it didn't recognise,
 * logging the caller straight in as that identity ("auto-registration"). That is an account
 * takeover waiting to happen: anyone could POST a real clinician's email with a password of
 * their own choosing before that clinician ever logged in, and would then hold a valid
 * session for that email — the real clinician locked out with "Invalid credentials" instead.
 * Login now only ever authenticates an existing account. Creating one is its own explicit
 * endpoint below.
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Same error for "no such account" and "wrong password" so a login attempt can never be
    // used to discover whether an email address has an account.
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId
      },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    auditLogger.log({
      organisationId: user.organisationId,
      actorId: user.id,
      eventType: 'AUTH_LOGIN',
      resourceType: 'User',
      resourceId: user.id,
      clientIp: req.ip
    });

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
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

/**
 * Explicit account creation, replacing the auto-registration that used to happen inside
 * /login. New accounts land in a shared default organisation, same as before; a clinician who
 * should belong to a real NHS trust's organisation still needs that assigned deliberately
 * (by an admin, or a future invite flow), not by whichever value auto-registration guessed.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const defaultOrg = await prisma.organisation.upsert({
      where: { code: 'DEFAULT-ORG' },
      update: {},
      create: { name: 'Default Organisation', code: 'DEFAULT-ORG' }
    });

    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: fullName || email.split('@')[0],
          organisationId: defaultOrg.id
        }
      });
    } catch (err: any) {
      // Unique constraint: someone registered the same email a moment earlier.
      if (err?.code === 'P2002') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      throw err;
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        organisationId: user.organisationId
      },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    auditLogger.log({
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
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

export default router;
