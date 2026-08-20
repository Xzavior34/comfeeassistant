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

router.get('/download/:filename', async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const isPdf = filename.endsWith('.pdf');
    const isDocx = filename.endsWith('.docx');

    if (!isPdf && !isDocx) {
      return res.status(400).send('Unsupported format');
    }

    const meetingId = filename.replace(/\.(pdf|docx)$/, '');
    const note = await prisma.clinicalNote.findFirst({
      where: { meetingId },
      orderBy: { generatedAt: 'desc' }
    });

    const structuredData = note?.structuredJson ? (note.structuredJson as any) : null;
    
    // Format document as clean clinical text
    let reportText = `CLINICAL WHEELCHAIR & SEATING ASSESSMENT REPORT\n`;
    reportText += `==============================================\n\n`;
    reportText += `Meeting ID: ${meetingId}\n`;
    reportText += `Generated Date: ${new Date().toLocaleDateString('en-GB')}\n\n`;

    if (structuredData && structuredData.sessionInfo) {
      reportText += `--- SESSION INFORMATION ---\n`;
      reportText += `Client Reference: ${structuredData.sessionInfo.clientReference || 'N/A'}\n`;
      reportText += `Clinician Name: ${structuredData.sessionInfo.clinicianName || 'N/A'}\n`;
      reportText += `Template Type: ${structuredData.sessionInfo.templateType || 'INITIAL_ASSESSMENT'}\n`;
      reportText += `Session Format: ${structuredData.sessionInfo.sessionFormat || 'FACE_TO_FACE'}\n\n`;
    }

    if (structuredData) {
      reportText += `--- CLINICAL EXTRACTION & FINDINGS ---\n`;
      reportText += JSON.stringify(structuredData, null, 2);
    } else {
      reportText += `Clinical assessment document for meeting ${meetingId}.\n`;
    }

    if (isPdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Clinical_Report_${meetingId}.pdf"`);
      res.send(Buffer.from(reportText));
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="Clinical_Report_${meetingId}.docx"`);
      res.send(Buffer.from(reportText));
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Error generating document download');
  }
});

export default router;
