"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clinicalDocumentService = exports.ClinicalDocumentService = void 0;
const pdfkit_1 = __importDefault(require("pdfkit"));
const docx_1 = require("docx");
const ATTESTATION = 'This clinical note was generated with the assistance of an AI-enabled ambient documentation ' +
    'system from a recording of the assessment, and reviewed by the responsible health or care ' +
    'professional named above. The clinician remains responsible for the accuracy and ' +
    'appropriateness of the final clinical record.';
const DRAFT_BANNER = 'DRAFT — NOT A CLINICAL RECORD. This document has not been reviewed and approved by a ' +
    'clinician and must not be entered into the patient record.';
const APPROVED_BANNER = 'CLINICIAN-APPROVED CLINICAL RECORD — CONFIDENTIAL';
function isApproved(meta) {
    return Boolean(meta.approvedBy && meta.approvedAt);
}
function title(meta) {
    return meta.assessmentType === 'REVIEW'
        ? 'WHEELCHAIR AND SEATING ASSESSMENT — REVIEW APPOINTMENT'
        : 'WHEELCHAIR AND SEATING ASSESSMENT';
}
class ClinicalDocumentService {
    async generatePDF(meta, narrative) {
        return new Promise((resolve, reject) => {
            const doc = new pdfkit_1.default({ margin: 56, bufferPages: true });
            const chunks = [];
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            const approved = isApproved(meta);
            doc.fontSize(9).fillColor('#555555').text('Vabatim', { align: 'right' });
            doc.moveDown(0.4);
            doc.fontSize(16).fillColor('#1F3864').text(title(meta), { align: 'center' });
            doc.moveDown(0.3);
            doc
                .fontSize(9)
                .fillColor(approved ? '#166534' : '#B02418')
                .text(approved ? APPROVED_BANNER : DRAFT_BANNER, { align: 'center' });
            doc.moveDown(0.8);
            doc.fillColor('#000000').fontSize(10);
            doc.text(`Client reference: ${meta.clientReference}`);
            doc.text(`Assessing clinician: ${meta.clinicianName}`);
            doc.text(`Assessment date: ${meta.assessmentDate}`);
            doc.text(`Assessment mode: ${meta.assessmentMode === 'REMOTE' ? 'Remote' : 'In person'}`);
            doc.text(`Organisation: ${meta.organisationName}`);
            if (approved) {
                doc.text(`Approved by: ${meta.approvedBy} on ${meta.approvedAt}`);
            }
            doc.moveDown(0.5);
            doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor('#D0D5DD').stroke();
            doc.moveDown(0.8);
            for (const section of narrative.sections) {
                // Keep a heading with at least its first line rather than orphaning it at a page
                // break, which makes a long clinical document much harder to read.
                if (doc.y > 690)
                    doc.addPage();
                doc.fontSize(11).fillColor('#1F3864').text(section.title);
                doc.moveDown(0.25);
                doc.fontSize(10).fillColor('#000000');
                if (section.entries.length === 0) {
                    doc.fillColor('#555555').text(section.notEstablished ?? 'Not discussed during this assessment.');
                    doc.fillColor('#000000');
                }
                else {
                    for (const entry of section.entries) {
                        doc.text(entry.text, { align: 'left' });
                        doc.moveDown(0.2);
                    }
                }
                doc.moveDown(0.6);
            }
            // Outstanding review items travel with the document only while it is a draft; once
            // approved, the clinician has resolved them by approving.
            if (!approved && narrative.reviewFlags.length > 0) {
                doc.addPage();
                doc.fontSize(11).fillColor('#1F3864').text('Items requiring clinician review');
                doc.moveDown(0.3).fontSize(10).fillColor('#000000');
                for (const flag of narrative.reviewFlags) {
                    doc.text(`• ${flag.description}`);
                    doc.moveDown(0.15);
                }
                doc.moveDown(0.6);
            }
            if (doc.y > 620)
                doc.addPage();
            doc.fontSize(11).fillColor('#1F3864').text('Attestation');
            doc.moveDown(0.3).fontSize(9).fillColor('#000000').text(ATTESTATION, { align: 'left' });
            doc.moveDown(0.8);
            doc.fontSize(9).text(approved
                ? `Approved by ${meta.approvedBy} on ${meta.approvedAt}.`
                : 'Signature: ______________________________    Date: ______________');
            const range = doc.bufferedPageRange();
            for (let i = 0; i < range.count; i++) {
                doc.switchToPage(range.start + i);
                doc
                    .fontSize(8)
                    .fillColor('#777777')
                    .text(`${meta.clientReference}  ·  ${meta.assessmentDate}  ·  page ${i + 1} of ${range.count}`, 56, doc.page.height - 40, { align: 'center', width: doc.page.width - 112 });
            }
            doc.end();
        });
    }
    async generateDOCX(meta, narrative) {
        const approved = isApproved(meta);
        const children = [];
        children.push(new docx_1.Paragraph({
            alignment: docx_1.AlignmentType.RIGHT,
            children: [new docx_1.TextRun({ text: 'Vabatim', size: 18, color: '555555' })]
        }), new docx_1.Paragraph({ text: title(meta), heading: docx_1.HeadingLevel.HEADING_1 }), new docx_1.Paragraph({
            children: [
                new docx_1.TextRun({
                    text: approved ? APPROVED_BANNER : DRAFT_BANNER,
                    bold: true,
                    color: approved ? '166534' : 'B02418',
                    size: 18
                })
            ]
        }), 
        // Each metadata item is its own paragraph: "\n" inside a TextRun is not a line break
        // in OOXML and collapses the whole header onto one line.
        new docx_1.Paragraph({ text: `Client reference: ${meta.clientReference}` }), new docx_1.Paragraph({ text: `Assessing clinician: ${meta.clinicianName}` }), new docx_1.Paragraph({ text: `Assessment date: ${meta.assessmentDate}` }), new docx_1.Paragraph({ text: `Assessment mode: ${meta.assessmentMode === 'REMOTE' ? 'Remote' : 'In person'}` }), new docx_1.Paragraph({ text: `Organisation: ${meta.organisationName}` }));
        if (approved) {
            children.push(new docx_1.Paragraph({ text: `Approved by: ${meta.approvedBy} on ${meta.approvedAt}` }));
        }
        for (const section of narrative.sections) {
            children.push(new docx_1.Paragraph({ text: section.title, heading: docx_1.HeadingLevel.HEADING_2 }));
            if (section.entries.length === 0) {
                children.push(new docx_1.Paragraph({
                    children: [
                        new docx_1.TextRun({
                            text: section.notEstablished ?? 'Not discussed during this assessment.',
                            italics: true,
                            color: '555555'
                        })
                    ]
                }));
            }
            else {
                for (const entry of section.entries) {
                    children.push(new docx_1.Paragraph({ text: entry.text }));
                }
            }
        }
        if (!approved && narrative.reviewFlags.length > 0) {
            children.push(new docx_1.Paragraph({ text: 'Items requiring clinician review', heading: docx_1.HeadingLevel.HEADING_2 }));
            for (const flag of narrative.reviewFlags) {
                children.push(new docx_1.Paragraph({ text: flag.description, bullet: { level: 0 } }));
            }
        }
        children.push(new docx_1.Paragraph({ text: 'Attestation', heading: docx_1.HeadingLevel.HEADING_2 }));
        children.push(new docx_1.Paragraph({ text: ATTESTATION }));
        children.push(new docx_1.Paragraph({ text: '' }));
        children.push(new docx_1.Paragraph({
            text: approved
                ? `Approved by ${meta.approvedBy} on ${meta.approvedAt}.`
                : 'Signature: ______________________________    Date: ______________'
        }));
        const doc = new docx_1.Document({
            creator: 'Vabatim',
            title: `${title(meta)} — ${meta.clientReference}`,
            description: 'Wheelchair and seating assessment record',
            sections: [{ children }]
        });
        return docx_1.Packer.toBuffer(doc);
    }
}
exports.ClinicalDocumentService = ClinicalDocumentService;
exports.clinicalDocumentService = new ClinicalDocumentService();
