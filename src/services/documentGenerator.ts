import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { StructuredClinicalExtraction } from '../types';

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

      // PDF Header - Professional Clinical Note Title
      doc.fontSize(20).text('Professional Clinical Note', { align: 'center' });
      doc.fontSize(12).text('Evidence-Grounded UK NHS Seating & Mobility Documentation', { align: 'center' });
      doc.moveDown();

      // Governance Disclaimer Banner
      doc.fontSize(9).fillColor('red').text('CLINICIAN-VERIFIED DOCUMENTATION - CONFIDENTIAL MEDICAL RECORD', { align: 'center' });
      doc.fillColor('black').moveDown();

      // Metadata Section
      doc.fontSize(11).text(`Document Version: ${meta.documentVersion}`);
      doc.text(`Clinician: ${meta.clinicianName}`);
      doc.text(`Client Reference: ${meta.clientReference}`);
      doc.text(`Organisation: ${meta.organisationName}`);
      doc.text(`Date of Contact: ${meta.meetingDate}`);
      doc.text(`Approved By: ${meta.approvedBy} on ${meta.approvedAt}`);
      doc.moveDown();

      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Section Helper
      const renderSection = (title: string, items: { value: string }[]) => {
        doc.fontSize(14).text(title, { underline: true });
        doc.moveDown(0.5);
        if (!items || items.length === 0) {
          doc.fontSize(10).text('• Not stated');
        } else {
          items.forEach((item) => {
            doc.fontSize(10).text(`• ${item.value}`);
          });
        }
        doc.moveDown();
      };

      renderSection('Client Reported Information & Concerns', noteData.clientReportedInformation || noteData.clientConcerns);
      renderSection('Environmental & Equipment Factors', noteData.equipmentAndEnvironment || noteData.accessibilityBarriers);
      renderSection('Wheelchair & Seating Requirements', noteData.wheelchairSeatingConcerns);
      renderSection('Assessment Findings & Physical Evaluation', noteData.assessmentFindings || noteData.matAssessmentInfo);
      renderSection('Plan & Clinical Next Steps', noteData.planAndNextSteps || noteData.actionsAndRecommendations);

      doc.end();
    });
  }

  async generateDOCX(meta: ClinicalDocumentMetadata, noteData: StructuredClinicalExtraction): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: 'Professional Clinical Note',
              heading: HeadingLevel.HEADING_1
            }),
            new Paragraph({
              text: `UK NHS Seating & Mobility Assessment - Doc Version: ${meta.documentVersion}`,
              heading: HeadingLevel.HEADING_2
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Clinician: ${meta.clinicianName}\n` }),
                new TextRun({ text: `Client Reference: ${meta.clientReference}\n` }),
                new TextRun({ text: `Approved By: ${meta.approvedBy} (${meta.approvedAt})\n` })
              ]
            }),
            new Paragraph({ text: 'Client Reported Information', heading: HeadingLevel.HEADING_3 }),
            ...(noteData.clientReportedInformation || noteData.clientConcerns).map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Environmental & Equipment Factors', heading: HeadingLevel.HEADING_3 }),
            ...(noteData.equipmentAndEnvironment || noteData.accessibilityBarriers).map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Wheelchair & Seating Requirements', heading: HeadingLevel.HEADING_3 }),
            ...noteData.wheelchairSeatingConcerns.map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Assessment Findings & Physical Evaluation', heading: HeadingLevel.HEADING_3 }),
            ...(noteData.assessmentFindings || noteData.matAssessmentInfo).map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Plan & Clinical Next Steps', heading: HeadingLevel.HEADING_3 }),
            ...(noteData.planAndNextSteps || noteData.actionsAndRecommendations).map((c) => new Paragraph({ text: `• ${c.value}` }))
          ]
        }
      ]
    });

    return await Packer.toBuffer(doc);
  }
}
