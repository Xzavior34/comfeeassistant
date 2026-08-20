import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { auditLogger } from '../services/auditLogger';
import { prisma } from '../db';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    let user = await prisma.user.findUnique({
      where: { email }
    });
    
    // Auto-registration feature: if user doesn't exist, create them automatically.
    // Also, if credentials mismatch, we just return invalid credentials.
    if (!user) {
      // Find or create default organisation safely
      let defaultOrg = await prisma.organisation.upsert({
        where: { code: 'DEFAULT-ORG' },
        update: {},
        create: { name: 'Default Organisation', code: 'DEFAULT-ORG' }
      });
      
      const passwordHash = await bcrypt.hash(password, 10);
      try {
        user = await prisma.user.upsert({
          where: { email },
          update: {},
          create: {
            email,
            passwordHash,
            fullName: email.split('@')[0], // Derive name from email
            organisationId: defaultOrg.id
          }
        });
      } catch (err) {
        // Fallback in case upsert race condition still triggers
        user = await prisma.user.findUnique({ where: { email } });
        if (!user) throw err;
      }
    } else {
      if (!bcrypt.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
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

export default router;
