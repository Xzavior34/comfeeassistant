import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { authenticateToken } from '../middleware/auth';
import { DEMO_MEETINGS } from './meetings';
import { DeliveryService } from '../services/deliveryService';
import { DocumentGeneratorService } from '../services/documentGenerator';
import { auditLogger } from '../services/auditLogger';

const router = Router();
const deliveryService = new DeliveryService();
const docGen = new DocumentGeneratorService();

// Authenticated route to request a signed secure delivery link
router.post('/deliver/:meetingId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { meetingId } = req.params;
  const { recipientEmail, recipientName } = req.body;

  const meeting = DEMO_MEETINGS[meetingId];
  if (!meeting) return res.status(404).json({ error: 'Meeting not found.' });

  const signedUrl = await deliveryService.deliverSecureDocumentLink(
    recipientEmail || req.user!.email,
    recipientName || 'Clinician',
    `documents/${meetingId}.pdf`,
    15
  );

  auditLogger.log({
    organisationId: req.user!.organisationId,
    actorId: req.user!.id,
    eventType: 'DOCUMENT_DELIVERY_SENT',
    resourceType: 'Document',
    resourceId: meetingId,
    details: { recipientEmail }
  });

  res.json({
    message: 'Secure document link generated and notification dispatched.',
    meetingId,
    expiresInMinutes: 15,
    signedUrl
  });
});

// Secure Access Endpoint (Validates token parameter for document download)
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

    // Return rendered PDF document for demo
    const sampleMeta = {
      meetingId: 'demo-meeting-101',
      clinicianName: 'Dr. Sarah Jenkins',
      clientReference: 'CLIENT-REF-8842',
      organisationName: 'UK NHS Seating & Mobility Trust',
      meetingDate: new Date().toLocaleDateString('en-GB'),
      approvedAt: new Date().toISOString(),
      approvedBy: 'Dr. Sarah Jenkins',
      documentVersion: 'Approved v1.0'
    };

    const sampleNote = {
      clientConcerns: [{ value: 'Sacrum pressure sore after 2 hours sitting', evidence: [], confidence: 'HIGH' as const }],
      accessibilityBarriers: [{ value: '2 entrance steps; 680mm bathroom doorway', evidence: [], confidence: 'HIGH' as const }],
      wheelchairSeatingConcerns: [{ value: 'Current cushion worn out; no lateral trunk support', evidence: [], confidence: 'HIGH' as const }],
      matAssessmentInfo: [{ value: '15 deg posterior pelvic tilt; 10 deg pelvic obliquity', evidence: [], confidence: 'HIGH' as const }],
      actionsAndRecommendations: [{ value: 'Trial contoured pressure redistributing foam cushion', evidence: [], confidence: 'HIGH' as const }],
      unstatedOrMissingFields: []
    };

    const pdfBuffer = await docGen.generatePDF(sampleMeta, sampleNote as any);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Vabatim_Clinical_Report_${docKey}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid document access link.' });
  }
});

export default router;
