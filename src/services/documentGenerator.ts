import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { StructuredClinicalExtraction, EvidenceLinkedClaim } from '../types';
import { CLINICAL_ATTESTATION } from './clinicalPrompt';

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

const NOT_DOCUMENTED = 'Not documented during this session.';

interface RenderSection {
  title: string;
  claims: EvidenceLinkedClaim[];
}

/**
 * Builds the document's section list from the note.
 *
 * Two output defects are fixed here. The renderer previously fed the same claim array into
 * several headings (the MAT bucket appeared under Objective Findings, Seating & Postural
 * Assessment and Clinical Reasoning), so notes read as the same transcript lines repeated.
 * A seen-set now suppresses a claim after its first appearance. It also emitted internal
 * provenance tags such as "[PATIENT_REPORTED]" into the clinician-facing note, which the
 * clinical template explicitly reserves for the internal schema; those are dropped.
 */
export function buildSections(note: StructuredClinicalExtraction): RenderSection[] {
  const seen = new Set<string>();

  const dedupe = (claims?: EvidenceLinkedClaim[]): EvidenceLinkedClaim[] => {
    if (!claims || claims.length === 0) return [];
    const out: EvidenceLinkedClaim[] = [];
    for (const c of claims) {
      if (!c || !c.value) continue;
      if (c.value === NOT_DOCUMENTED) continue;
      const key = c.value.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  };

  const s = (title: string, claims?: EvidenceLinkedClaim[]): RenderSection => ({
    title,
    claims: dedupe(claims)
  });

  const n: any = note;

  return [
    s('1. Reason for Referral and Presenting Concern', [
      ...(n.sessionInfo?.reasonForReferral ?? []),
      ...(n.subjectiveInfo?.presentingConcerns ?? [])
    ]),
    s("2. Person's Goals and Intended Wheelchair Use", n.subjectiveInfo?.clientGoals),
    s('3. Relevant Medical and Health Background', n.subjectiveInfo?.clientCarerHistory),
    s('4. Mobility, Walking and Falls', n.functionalAssessment?.mobilityStatus),
    s('5. Transfers and Assistance', [
      ...(n.functionalAssessment?.transferCapability ?? []),
      ...(n.functionalAssessment?.assistanceRequired ?? [])
    ]),
    s('6. Activities of Daily Living and Participation', [
      ...(n.functionalAssessment?.activitiesOfDailyLiving ?? []),
      ...(n.functionalAssessment?.communityParticipation ?? []),
      ...(n.functionalAssessment?.fatigueAndEndurance ?? [])
    ]),
    s('7. Objective Physical and Postural Assessment', [
      ...(n.objectiveFindings?.clinicianObservations ?? []),
      ...(n.objectiveFindings?.assessmentFindings ?? []),
      ...(n.seatingPosturalAssessment?.pelvicPositioning ?? []),
      ...(n.seatingPosturalAssessment?.trunkPositioning ?? []),
      ...(n.seatingPosturalAssessment?.headAndNeckPositioning ?? []),
      ...(n.seatingPosturalAssessment?.lowerLimbPositioning ?? []),
      ...(n.seatingPosturalAssessment?.posturalAsymmetry ?? []),
      ...(n.seatingPosturalAssessment?.posturalStabilityAndTolerance ?? [])
    ]),
    s('8. Range of Movement and Motor/Sensory Findings', [
      ...(n.objectiveFindings?.rangeOfMovement ?? []),
      ...(n.objectiveFindings?.muscleStrength ?? [])
    ]),
    s('9. Wheelchair Measurements', n.objectiveFindings?.measurementsPreserved),
    s('10. Skin Integrity and Pressure Management', [
      ...(n.pressureManagement?.skinIntegrityConcerns ?? []),
      ...(n.pressureManagement?.pressureConcerns ?? []),
      ...(n.pressureManagement?.pressureReliefMethods ?? []),
      ...(n.pressureManagement?.pressureReliefFrequency ?? []),
      ...(n.pressureManagement?.riskFactorNotes ?? [])
    ]),
    s('11. Current Wheelchair and Seating Equipment', [
      ...(n.equipmentAssessment?.currentWheelchair ?? []),
      ...(n.equipmentAssessment?.currentCushion ?? []),
      ...(n.pressureManagement?.cushionInformation ?? []),
      ...(n.equipmentAssessment?.currentBackSupport ?? []),
      ...(n.equipmentAssessment?.footAndArmSupports ?? []),
      ...(n.equipmentAssessment?.accessoriesAndPads ?? []),
      ...(n.seatingPosturalAssessment?.supportsAndPosturalPillows ?? []),
      ...(n.equipmentAssessment?.equipmentSuitabilityAndProblems ?? [])
    ]),
    s('12. Home, Community and Transport Environment', n.environmentAndTransport),
    s('13. Wheelchair Trial, Selection and Justification', n.trialAndSelection),
    s('14. Clinical Reasoning and Priorities', n.clinicalReasoning),
    s('15. Recommendations and Agreed Actions', [
      ...(n.recommendationsAndActions ?? []),
      ...(n.actionsAndRecommendations ?? [])
    ]),
    s('16. Follow-up and Review Plan', n.followUpPlan),
    s('17. Agreement, Reservations and Sign-off', n.agreementAndSignOff),
    s('18. Outstanding Concerns and Missing Information', n.outstandingConcerns)
  ];
}

function reviewFlagLines(note: StructuredClinicalExtraction): string[] {
  const flags: any[] = (note as any).clinicianReviewFlags ?? [];
  if (flags.length === 0) return ['No automated review flags were raised for this draft.'];
  return flags.map((f) => `[${f.flagType}] ${f.description}`);
}

function warningLines(note: StructuredClinicalExtraction): string[] {
  return note.warnings?.warningMessages ?? [];
}

/**
 * How each voice in the recording was attributed to a clinical role.
 *
 * Printed in the note because attribution is an inference the clinician is responsible for
 * confirming, and they can only confirm what they can see. Stating the evidence lets them
 * check it in seconds instead of replaying the recording.
 */
function attributionLines(note: StructuredClinicalExtraction): string[] {
  const attribution = (note as any).voiceAttribution as
    | Array<{ speakerId: string; role: string | null; confidence: string; rationale: string[]; speakingShare: number }>
    | undefined;

  if (!attribution || attribution.length === 0) {
    return ['Speaker attribution was not available for this recording; statements are unattributed.'];
  }

  return attribution.map((a) => {
    const who = a.role ? a.role.toLowerCase() : 'not attributed';
    const share = Math.round((a.speakingShare ?? 0) * 100);
    return `${a.speakerId}: ${who} — ${a.confidence.toLowerCase()} confidence, ${share}% of speech (${a.rationale.join('; ')})`;
  });
}

export class DocumentGeneratorService {
  async generatePDF(
    meta: ClinicalDocumentMetadata,
    noteData: StructuredClinicalExtraction
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (c: any) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const titleText =
        noteData.templateType === 'REVIEW'
          ? 'WHEELCHAIR ASSESSMENT — REVIEW APPOINTMENT'
          : 'WHEELCHAIR ASSESSMENT — INITIAL ASSESSMENT';

      doc.fontSize(16).text(titleText, { align: 'center' });
      doc.fontSize(10).text('Evidence-Grounded Wheelchair and Seating Documentation', { align: 'center' });
      doc.moveDown();

      const approved = meta.approvedBy && meta.approvedBy !== 'Unapproved Draft';
      doc
        .fontSize(9)
        .fillColor(approved ? '#166534' : '#b45309')
        .text(
          approved
            ? 'CLINICIAN-APPROVED CLINICAL RECORD — CONFIDENTIAL'
            : 'AI-GENERATED DRAFT — NOT A CLINICAL RECORD UNTIL REVIEWED AND APPROVED BY THE RESPONSIBLE CLINICIAN',
          { align: 'center' }
        );
      doc.fillColor('black').moveDown();

      doc.fontSize(11);
      doc.text(`Client Reference: ${meta.clientReference}`);
      doc.text(`Clinician: ${meta.clinicianName}`);
      doc.text(`Session Date: ${meta.meetingDate}`);
      doc.text(`Appointment Type: ${noteData.templateType}`);
      doc.text(`Session Format: ${noteData.sessionFormat}`);
      doc.text(`Approved By: ${meta.approvedBy} on ${meta.approvedAt}`);
      doc.moveDown();
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      const warnings = warningLines(noteData);
      if (warnings.length > 0) {
        doc.fontSize(11).fillColor('#b45309').text('Transcription and processing warnings', { underline: true });
        doc.fontSize(9);
        warnings.forEach((w) => doc.text(`• ${w}`));
        doc.fillColor('black').moveDown();
      }

      for (const section of buildSections(noteData)) {
        doc.fontSize(12).text(section.title, { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(9);
        if (section.claims.length === 0) {
          doc.text(`• ${NOT_DOCUMENTED}`);
        } else {
          section.claims.forEach((c) => {
            const uncertain = c.sourceClassification === 'UNCERTAIN' || c.confidence === 'LOW';
            doc.text(`• ${c.value}${uncertain ? '  [requires clinician verification]' : ''}`);
          });
        }
        doc.moveDown(0.8);
      }

      doc.addPage();
      doc.fontSize(12).text('Speaker attribution', { underline: true });
      doc.moveDown(0.3).fontSize(9);
      attributionLines(noteData).forEach((l) => doc.text(`• ${l}`));
      doc.moveDown();

      doc.fontSize(12).text('Clinician review flags', { underline: true });
      doc.moveDown(0.3).fontSize(9);
      reviewFlagLines(noteData).forEach((l) => doc.text(`☐ ${l}`));
      doc.moveDown();

      doc.fontSize(12).text('Attestation', { underline: true });
      doc.moveDown(0.3).fontSize(9).text(CLINICAL_ATTESTATION);
      doc.moveDown();
      doc.fontSize(9).text('Reviewed and approved by: ______________________   Date: ____________');

      doc.end();
    });
  }

  async generateDOCX(
    meta: ClinicalDocumentMetadata,
    noteData: StructuredClinicalExtraction
  ): Promise<Buffer> {
    const titleText =
      noteData.templateType === 'REVIEW'
        ? 'WHEELCHAIR ASSESSMENT — REVIEW APPOINTMENT'
        : 'WHEELCHAIR ASSESSMENT — INITIAL ASSESSMENT';

    const approved = meta.approvedBy && meta.approvedBy !== 'Unapproved Draft';
    const children: Paragraph[] = [
      new Paragraph({ text: titleText, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [
          new TextRun({
            text: approved
              ? 'CLINICIAN-APPROVED CLINICAL RECORD — CONFIDENTIAL'
              : 'AI-GENERATED DRAFT — NOT A CLINICAL RECORD UNTIL REVIEWED AND APPROVED',
            bold: true
          })
        ]
      }),
      // Each metadata item is its own paragraph. "\n" inside a TextRun does not break a
      // line in OOXML, so the previous version collapsed all of these onto one line.
      new Paragraph({ text: `Client Reference: ${meta.clientReference}` }),
      new Paragraph({ text: `Clinician: ${meta.clinicianName}` }),
      new Paragraph({ text: `Session Date: ${meta.meetingDate}` }),
      new Paragraph({ text: `Appointment Type: ${noteData.templateType}` }),
      new Paragraph({ text: `Session Format: ${noteData.sessionFormat}` }),
      new Paragraph({ text: `Approved By: ${meta.approvedBy} (${meta.approvedAt})` }),
      new Paragraph({ text: `Document Version: ${meta.documentVersion}` })
    ];

    const warnings = warningLines(noteData);
    if (warnings.length > 0) {
      children.push(
        new Paragraph({ text: 'Transcription and processing warnings', heading: HeadingLevel.HEADING_2 })
      );
      warnings.forEach((w) => children.push(new Paragraph({ text: w, bullet: { level: 0 } })));
    }

    for (const section of buildSections(noteData)) {
      children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }));
      if (section.claims.length === 0) {
        children.push(new Paragraph({ text: NOT_DOCUMENTED, bullet: { level: 0 } }));
      } else {
        section.claims.forEach((c) => {
          const uncertain = c.sourceClassification === 'UNCERTAIN' || c.confidence === 'LOW';
          children.push(
            new Paragraph({
              text: `${c.value}${uncertain ? '  [requires clinician verification]' : ''}`,
              bullet: { level: 0 }
            })
          );
        });
      }
    }

    children.push(new Paragraph({ text: 'Speaker attribution', heading: HeadingLevel.HEADING_2 }));
    attributionLines(noteData).forEach((l) =>
      children.push(new Paragraph({ text: l, bullet: { level: 0 } }))
    );

    children.push(new Paragraph({ text: 'Clinician review flags', heading: HeadingLevel.HEADING_2 }));
    reviewFlagLines(noteData).forEach((l) =>
      children.push(new Paragraph({ text: l, bullet: { level: 0 } }))
    );

    children.push(new Paragraph({ text: 'Attestation', heading: HeadingLevel.HEADING_2 }));
    children.push(new Paragraph({ text: CLINICAL_ATTESTATION }));
    children.push(new Paragraph({ text: '' }));
    children.push(new Paragraph({ text: 'Reviewed and approved by: ______________________   Date: ____________' }));

    const doc = new Document({ sections: [{ children }] });
    return await Packer.toBuffer(doc);
  }
}
