import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { auditLogger } from '../services/auditLogger';

const router = Router();

// Demo in-memory authentication store for local dev path
const DEMO_USERS = [
  {
    id: 'user-clinician-1',
    email: 'sarah.jenkins@nhs.uk',
    fullName: 'Dr. Sarah Jenkins',
    role: 'CLINICIAN',
    organisationId: 'NHS-UK-TRUST-01',
    passwordHash: bcrypt.hashSync('ClinicianSecure123!', 10)
  }
];

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  let user = DEMO_USERS.find((u) => u.email === email);
  
  if (!user) {
    // Auto-register for MVP since there is no sign-up page
    user = {
      id: `user-${Date.now()}`,
      email,
      fullName: 'Clinician',
      role: 'CLINICIAN',
      organisationId: 'NHS-UK-TRUST-01',
      passwordHash: bcrypt.hashSync(password || 'ClinicianSecure123!', 10)
    };
    DEMO_USERS.push(user);
  } else {
    // If it's a pre-existing demo user, verify password. If auto-registered, accept the passed password.
    if (password && !bcrypt.compareSync(password, user.passwordHash)) {
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
});

export default router;
