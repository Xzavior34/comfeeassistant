import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { StructuredClinicalExtraction, EvidenceLinkedClaim } from '../types';

export interface ClinicalDocumentMetadata {
  meetingId: string;
  clinicianName: string;
  clientReference: string;
  organisationName: string;
  meetingDate: string;
  approvedAt: string;
  approvedBy: string;
  documentVersion: string;
}

export class DocumentGeneratorService {
  async generatePDF(meta: ClinicalDocumentMetadata, noteData: StructuredClinicalExtraction): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: any) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: any) => reject(err));

      const titleText = noteData.templateType === 'REVIEW'
        ? 'PROFESSIONAL CLINICAL NOTE - REVIEW APPOINTMENT'
        : 'PROFESSIONAL CLINICAL NOTE - INITIAL ASSESSMENT';

      // PDF Header
      doc.fontSize(16).text(titleText, { align: 'center' });
      doc.fontSize(10).text('Evidence-Grounded Wheelchair Therapy Documentation', { align: 'center' });
      doc.moveDown();

      // Governance Banner
      doc.fontSize(8).fillColor('red').text('CLINICIAN-APPROVED MEDICAL RECORD - CONFIDENTIAL', { align: 'center' });
      doc.fillColor('black').moveDown();

      // 1. Session Information Table
      doc.fontSize(11).text(`Client Reference: ${meta.clientReference}`);
      doc.text(`Clinician: ${meta.clinicianName}`);
      doc.text(`Session Date: ${meta.meetingDate}`);
      doc.text(`Appointment Type: ${noteData.templateType || 'INITIAL_ASSESSMENT'}`);
      doc.text(`Session Format: ${noteData.sessionFormat || 'FACE_TO_FACE'}`);
      doc.text(`Approved By: ${meta.approvedBy} on ${meta.approvedAt}`);
      doc.moveDown();

      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      const renderSection = (title: string, items?: EvidenceLinkedClaim[]) => {
        doc.fontSize(12).text(title, { underline: true });
        doc.moveDown(0.3);
        if (!items || items.length === 0) {
          doc.fontSize(9).text('• Not documented during this session.');
        } else {
          items.forEach((item) => {
            const tag = item.sourceClassification ? `[${item.sourceClassification}] ` : '';
            doc.fontSize(9).text(`• ${tag}${item.value}`);
          });
        }
        doc.moveDown(0.8);
      };

      // 11 PRD Structured Sections
      if (noteData.sessionInfo) renderSection('1. Session & Referral Information', noteData.sessionInfo.reasonForReferral);
      if (noteData.subjectiveInfo) renderSection('2. Subjective Information & Client Concerns', noteData.subjectiveInfo.presentingConcerns || noteData.clientConcerns);
      if (noteData.functionalAssessment) renderSection('3. Functional Assessment', noteData.functionalAssessment.mobilityStatus || noteData.accessibilityBarriers);
      if (noteData.objectiveFindings) renderSection('4. Objective Clinical Findings & Measurements', noteData.objectiveFindings.assessmentFindings || noteData.matAssessmentInfo);
      if (noteData.seatingPosturalAssessment) renderSection('5. Seating & Postural Assessment', noteData.seatingPosturalAssessment.pelvicPositioning);
      if (noteData.pressureManagement) renderSection('6. Pressure Management & Cushion Evaluation', noteData.pressureManagement.pressureConcerns);
      if (noteData.equipmentAssessment) renderSection('7. Current Wheelchair & Seating Equipment', noteData.equipmentAssessment.currentWheelchair || noteData.wheelchairSeatingConcerns);
      renderSection('8. Clinical Reasoning', noteData.clinicalReasoning);
      renderSection('9. Recommendations & Clinical Actions', noteData.recommendationsAndActions || noteData.actionsAndRecommendations);
      renderSection('10. Follow-up & Review Plan', noteData.followUpPlan);

      doc.end();
    });
  }

  async generateDOCX(meta: ClinicalDocumentMetadata, noteData: StructuredClinicalExtraction): Promise<Buffer> {
    const titleText = noteData.templateType === 'REVIEW'
      ? 'PROFESSIONAL CLINICAL NOTE - REVIEW APPOINTMENT'
      : 'PROFESSIONAL CLINICAL NOTE - INITIAL ASSESSMENT';

    const renderDocxSection = (headingText: string, items?: EvidenceLinkedClaim[]) => {
      const paragraphs = [
        new Paragraph({ text: headingText, heading: HeadingLevel.HEADING_3 })
      ];
      if (!items || items.length === 0) {
        paragraphs.push(new Paragraph({ text: '• Not documented during this session.' }));
      } else {
        items.forEach((item: EvidenceLinkedClaim) => {
          const tag = item.sourceClassification ? `[${item.sourceClassification}] ` : '';
          paragraphs.push(new Paragraph({ text: `• ${tag}${item.value}` }));
        });
      }
      return paragraphs;
    };

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: titleText, heading: HeadingLevel.HEADING_1 }),
            new Paragraph({ text: `UK NHS Wheelchair Therapy Documentation - Version: ${meta.documentVersion}`, heading: HeadingLevel.HEADING_2 }),
            new Paragraph({
              children: [
                new TextRun({ text: `Clinician: ${meta.clinicianName}\n` }),
                new TextRun({ text: `Client Reference: ${meta.clientReference}\n` }),
                new TextRun({ text: `Session Date: ${meta.meetingDate}\n` }),
                new TextRun({ text: `Approved By: ${meta.approvedBy} (${meta.approvedAt})\n` })
              ]
            }),
            ...renderDocxSection('1. Subjective Information & Client Concerns', noteData.subjectiveInfo?.presentingConcerns || noteData.clientConcerns),
            ...renderDocxSection('2. Functional Assessment & Environmental Barriers', noteData.functionalAssessment?.mobilityStatus || noteData.accessibilityBarriers),
            ...renderDocxSection('3. Objective Findings & MAT Assessment', noteData.objectiveFindings?.assessmentFindings || noteData.matAssessmentInfo),
            ...renderDocxSection('4. Seating & Postural Assessment', noteData.seatingPosturalAssessment?.pelvicPositioning),
            ...renderDocxSection('5. Pressure Management & Cushion Notes', noteData.pressureManagement?.pressureConcerns),
            ...renderDocxSection('6. Current Wheelchair & Seating Equipment', noteData.equipmentAssessment?.currentWheelchair || noteData.wheelchairSeatingConcerns),
            ...renderDocxSection('7. Clinical Reasoning', noteData.clinicalReasoning),
            ...renderDocxSection('8. Recommendations & Clinical Actions', noteData.recommendationsAndActions || noteData.actionsAndRecommendations),
            ...renderDocxSection('9. Follow-up & Review Plan', noteData.followUpPlan)
          ]
        }
      ]
    });

    return await Packer.toBuffer(doc);
  }
}
