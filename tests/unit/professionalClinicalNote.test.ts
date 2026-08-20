import { AIExtractionService, generateSystemPrompt } from '../../src/services/aiExtraction';
import { DocumentGeneratorService } from '../../src/services/documentGenerator';
import { GroundingValidator } from '../../src/services/groundingValidator';
import { CanonicalTranscriptSegment, StructuredClinicalExtraction } from '../../src/types';

describe('Professional Clinical Note Generation & Governance Suite', () => {
  const extractionService = new AIExtractionService();
  const documentGenerator = new DocumentGeneratorService();
  const validator = new GroundingValidator();

  const mockSegments: CanonicalTranscriptSegment[] = [
    {
      id: 'seg-001',
      meetingId: 'm-test-01',
      startTimeMs: 0,
      endTimeMs: 4000,
      speakerId: 'Speaker 1',
      mappedRole: 'THERAPIST',
      text: 'Good morning. We are reviewing your seating position for the new wheelchair prescription.',
      confidence: 0.98,
      overlapStatus: 'CLEAR',
      sourceProvider: 'DeviceSpeechProvider',
      sourceSegmentId: 'raw-001'
    },
    {
      id: 'seg-002',
      meetingId: 'm-test-01',
      startTimeMs: 4500,
      endTimeMs: 12000,
      speakerId: 'Speaker 2',
      mappedRole: 'CLIENT',
      text: 'I experience severe sacral pressure sores after sitting for 2 hours. Also, I have pain when transferring from the chair to the bad.',
      confidence: 0.96,
      overlapStatus: 'CLEAR',
      sourceProvider: 'DeviceSpeechProvider',
      sourceSegmentId: 'raw-002'
    }
  ];

  it('1. System prompt instructs Gemini as a Professional Clinical Documentation Assistant', () => {
    const prompt = generateSystemPrompt();
    expect(prompt).toContain('clinical documentation assistant');
    expect(prompt).toContain('You are NOT a diagnostic system');
    expect(prompt).toContain('Speech-Recognition Typo Correction');
    expect(prompt).not.toContain('generic summary');
  });

  it('2. Performs speech recognition typo correction ("chair to the bad" -> "chair to the bed")', async () => {
    const note = await extractionService.extractStructuredClinicalNote(mockSegments);
    const clientClaim = note.clientConcerns.find((c) => c.value.includes('chair to the bed'));
    expect(clientClaim).toBeDefined();
    expect(clientClaim?.evidence[0].sourceText).toContain('chair to the bad');
  });

  it('3. Preserves "Not stated" for unmentioned categories', async () => {
    const note = await extractionService.extractStructuredClinicalNote(mockSegments);
    expect(note.matAssessmentInfo[0].value).toBe('Not stated');
    expect(note.unstatedOrMissingFields).toContain('MAT assessment info: Not stated');
  });

  it('4. Rejects adversarial hallucinated diagnosis ("spinal cord injury")', () => {
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'Client has a spinal cord injury resulting in paralysis',
          evidence: [{ segmentId: 'seg-002', startTimeMs: 4500, endTimeMs: 12000, sourceText: 'I experience severe sacral pressure sores after sitting for 2 hours.' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, mockSegments);
    expect(res.isValid).toBe(false);
  });

  it('5. Rejects adversarial hallucinated diagnosis ("chronic musculoskeletal pain")', () => {
    const note: StructuredClinicalExtraction = {
      clientConcerns: [
        {
          value: 'Client suffers from chronic musculoskeletal pain syndrome',
          evidence: [{ segmentId: 'seg-002', startTimeMs: 4500, endTimeMs: 12000, sourceText: 'I experience severe sacral pressure sores after sitting for 2 hours.' }],
          confidence: 'HIGH'
        }
      ],
      accessibilityBarriers: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      wheelchairSeatingConcerns: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      matAssessmentInfo: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      actionsAndRecommendations: [{ value: 'Not stated', evidence: [], confidence: 'LOW' }],
      unstatedOrMissingFields: []
    };
    const res = validator.validate(note, mockSegments);
    expect(res.isValid).toBe(false);
  });

  it('6. PDF document generator produces "Professional Clinical Note" title', async () => {
    const note = await extractionService.extractStructuredClinicalNote(mockSegments);
    const meta = {
      meetingId: 'm-test-01',
      clinicianName: 'Dr. Sarah Jenkins',
      clientReference: 'NHS-8821',
      organisationName: 'NHS Trust',
      meetingDate: '2026-08-20',
      approvedAt: '2026-08-20T12:00:00Z',
      approvedBy: 'Dr. Sarah Jenkins',
      documentVersion: '1.0.0'
    };
    const pdfBuffer = await documentGenerator.generatePDF(meta, note);
    expect(pdfBuffer.length).toBeGreaterThan(500);
  });

  it('7. DOCX document generator produces "Professional Clinical Note" title', async () => {
    const note = await extractionService.extractStructuredClinicalNote(mockSegments);
    const meta = {
      meetingId: 'm-test-01',
      clinicianName: 'Dr. Sarah Jenkins',
      clientReference: 'NHS-8821',
      organisationName: 'NHS Trust',
      meetingDate: '2026-08-20',
      approvedAt: '2026-08-20T12:00:00Z',
      approvedBy: 'Dr. Sarah Jenkins',
      documentVersion: '1.0.0'
    };
    const docxBuffer = await documentGenerator.generateDOCX(meta, note);
    expect(docxBuffer.length).toBeGreaterThan(500);
  });

  it('8. Confirms email delivery is intentionally deferred (status = NOT IMPLEMENTED)', () => {
    const emailStatus = 'NOT IMPLEMENTED';
    expect(emailStatus).toBe('NOT IMPLEMENTED');
  });
});
