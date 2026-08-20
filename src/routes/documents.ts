import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { prisma } from '../db';

const router = Router();

router.post('/deliver/:meetingId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { meetingId } = req.params;
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    
    if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

    res.json({
      message: 'Secure document link generated and notification dispatched.',
      meetingId,
      expiresInMinutes: 15,
      signedUrl: 'https://fake-signed-url.com'
    });
  } catch (error) {
    res.status(500).json({ error: 'Delivery failed' });
  }
});

router.get('/secure-access', async (req: Request, res: Response) => {
  const { token, key } = req.query;

  if (!token || !key || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid document access link.' });
  }

  try {
    const decodedStr = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decodedStr.split(':');
    
    if (parts.length !== 2) {
      return res.status(400).json({ error: 'Invalid document access link.' });
    }

    const [docKey, expiryStr] = parts;
    const expiry = parseInt(expiryStr, 10);

    if (isNaN(expiry) || Date.now() > expiry) {
      return res.status(410).json({ error: 'Secure document link has expired.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Vabatim_Clinical_Report_${docKey}.pdf"`);
    res.send(Buffer.from('Fake PDF content'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid document access link.' });
  }
});

export default router;
