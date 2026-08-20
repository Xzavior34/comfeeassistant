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

    const user = await prisma.user.findUnique({
      where: { email }
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!bcrypt.compareSync(password, user.passwordHash)) {
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
    return res.status(500).json({ error: 'Internal server error during authentication.', details: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
