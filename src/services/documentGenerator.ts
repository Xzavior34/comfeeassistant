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

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // PDF Header
      doc.fontSize(20).text('Vabatim Clinical Documentation', { align: 'center' });
      doc.fontSize(12).text('UK NHS Seating & Accessibility Assessment Report', { align: 'center' });
      doc.moveDown();

      // Governance Disclaimer Banner
      doc.fontSize(9).fillColor('red').text('REQUIRES ORGANISATIONAL / LEGAL / DPO REVIEW - CONFIDENTIAL CLINICAL DRAFT', { align: 'center' });
      doc.fillColor('black').moveDown();

      // Metadata Section
      doc.fontSize(11).text(`Document Version: ${meta.documentVersion}`);
      doc.text(`Clinician: ${meta.clinicianName}`);
      doc.text(`Client Reference: ${meta.clientReference}`);
      doc.text(`Organisation: ${meta.organisationName}`);
      doc.text(`Date of Assessment: ${meta.meetingDate}`);
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

      renderSection('Client Reported Concerns & Symptoms', noteData.clientConcerns);
      renderSection('Environmental Accessibility Barriers', noteData.accessibilityBarriers);
      renderSection('Wheelchair & Seating Requirements', noteData.wheelchairSeatingConcerns);
      renderSection('Mechanical Assessment Tool (MAT) Findings', noteData.matAssessmentInfo);
      renderSection('Recommendations & Action Plan', noteData.actionsAndRecommendations);

      doc.end();
    });
  }

  async generateDOCX(meta: ClinicalDocumentMetadata, noteData: StructuredClinicalExtraction): Promise<Buffer> {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: 'Vabatim Clinical Accessibility Report',
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
            new Paragraph({ text: 'Client Reported Concerns', heading: HeadingLevel.HEADING_3 }),
            ...noteData.clientConcerns.map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Environmental Accessibility Barriers', heading: HeadingLevel.HEADING_3 }),
            ...noteData.accessibilityBarriers.map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Wheelchair & Seating Requirements', heading: HeadingLevel.HEADING_3 }),
            ...noteData.wheelchairSeatingConcerns.map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'MAT Physical Assessment Findings', heading: HeadingLevel.HEADING_3 }),
            ...noteData.matAssessmentInfo.map((c) => new Paragraph({ text: `• ${c.value}` })),

            new Paragraph({ text: 'Clinical Actions & Recommendations', heading: HeadingLevel.HEADING_3 }),
            ...noteData.actionsAndRecommendations.map((c) => new Paragraph({ text: `• ${c.value}` }))
          ]
        }
      ]
    });

    return await Packer.toBuffer(doc);
  }
}
