"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attributeVoices = attributeVoices;
exports.describeAttribution = describeAttribution;
const client_1 = require("@prisma/client");
const clinicalLexicon_1 = require("./clinicalLexicon");
// --------------------------------------------------------------------------- signals
/** Clinician register: directing the assessment, examining, deciding, planning. */
const CLINICIAN_MARKERS = [
    /\b(can you|could you|would you|are you able to|let'?s|I'?m going to|I'?ll|shall we)\b/i,
    /\b(I'?d like to (?:measure|check|look at|assess|try))\b/i,
    /\b(we'?ll (?:order|arrange|refer|review|book))\b/i,
    /\b(I recommend|my recommendation|clinically|on examination|assessment shows)\b/i,
    /\b(does that (?:hurt|feel|help)|how does that feel|any pain when)\b/i,
    /\b(refer(?:ral)? to|follow[- ]?up|review in|next appointment)\b/i,
    /\b(just going to|pop your|lean forward for me|hold still)\b/i
];
/** First-person symptom and experience language: the person being assessed. */
const PATIENT_MARKERS = [
    /\b(I (?:feel|felt|get|got|can'?t|cannot|struggle|find it|need|want|used to))\b/i,
    /\b(my (?:hip|back|legs?|arms?|shoulder|neck|skin|pain|chair|cushion|wife|husband|carer))\b/i,
    /\b(it (?:hurts|aches|feels|gets)|hurts when|painful when)\b/i,
    /\b(I'?m (?:worried|struggling|tired|sore|in pain|not able))\b/i,
    /\b(for me|to me personally|in my case)\b/i
];
/** Third-person report about the patient: a carer, relative or advocate. */
const CARER_MARKERS = [
    /\b(he|she|they) (?:can'?t|cannot|struggles|needs|usually|tends to|gets|has been)\b/i,
    /\b(I help (?:him|her|them)|when I transfer (?:him|her|them)|I look after)\b/i,
    /\b(as (?:his|her|their) carer|I'?m (?:his|her|their) (?:wife|husband|daughter|son|carer))\b/i
];
const INTERPRETER_MARKERS = [
    /\b(he says|she says|they say|he'?s saying|she'?s saying)\b/i,
    /\b(interpret(?:er|ing)|translat(?:e|ing))\b/i
];
const CLINICAL_TERMS = new Set(clinicalLexicon_1.CLINICAL_PHRASES.flatMap((p) => p.toLowerCase().split(/[\s-]+/)).filter((w) => w.length > 4));
function countMatches(text, markers) {
    return markers.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}
function countQuestions(text) {
    return (text.match(/\?/g) || []).length;
}
function countClinicalTerms(text) {
    let n = 0;
    for (const token of text.toLowerCase().split(/[^a-z0-9']+/)) {
        if (token.length > 4 && CLINICAL_TERMS.has(token))
            n++;
    }
    return n;
}
function countMeasurements(text) {
    return (text.match(/\d+(?:\.\d+)?\s*(?:cm|mm|inches|degrees|kg)\b/gi) || []).length;
}
function profileVoice(speakerId, segments) {
    const mine = segments.filter((s) => s.speakerId === speakerId);
    const text = mine.map((s) => s.text).join(' ');
    const durationMs = mine.reduce((n, s) => n + Math.max(0, s.endTimeMs - s.startTimeMs), 0);
    const questions = countQuestions(text);
    const clinicalTerms = countClinicalTerms(text);
    const measurements = countMeasurements(text);
    const clinicianLang = countMatches(text, CLINICIAN_MARKERS);
    const patientLang = countMatches(text, PATIENT_MARKERS);
    const carerLang = countMatches(text, CARER_MARKERS);
    const interpreterLang = countMatches(text, INTERPRETER_MARKERS);
    const rationale = [];
    // Clinician evidence. Asking questions and stating measurements are the two strongest
    // signals: a patient rarely does either.
    let clinicianScore = 0;
    if (questions > 0) {
        clinicianScore += Math.min(questions * 2, 12);
        rationale.push(`asked ${questions} question${questions === 1 ? '' : 's'}`);
    }
    if (measurements > 0) {
        clinicianScore += Math.min(measurements * 3, 12);
        rationale.push(`stated ${measurements} measurement${measurements === 1 ? '' : 's'}`);
    }
    if (clinicalTerms > 0) {
        clinicianScore += Math.min(clinicalTerms, 10);
        rationale.push(`used ${clinicalTerms} clinical term${clinicalTerms === 1 ? '' : 's'}`);
    }
    if (clinicianLang > 0) {
        clinicianScore += clinicianLang * 3;
        rationale.push(`used assessment-directing language`);
    }
    // Patient evidence.
    let patientScore = 0;
    if (patientLang > 0) {
        patientScore += patientLang * 4;
        rationale.push(`used first-person symptom language`);
    }
    // Carer and interpreter evidence: third-person report about the person being assessed.
    const carerScore = carerLang * 5;
    if (carerLang > 0)
        rationale.push('spoke about the person in the third person');
    const interpreterScore = interpreterLang * 5;
    if (interpreterLang > 0)
        rationale.push('relayed another speaker');
    return {
        speakerId,
        text,
        turns: mine.length,
        durationMs,
        firstSpeechMs: mine.length > 0 ? Math.min(...mine.map((s) => s.startTimeMs)) : Number.MAX_SAFE_INTEGER,
        clinicianScore,
        patientScore,
        carerScore,
        interpreterScore,
        rationale
    };
}
function confidenceFor(margin, best) {
    if (best === 0)
        return 'NONE';
    if (margin >= 8 && best >= 10)
        return 'HIGH';
    if (margin >= 4)
        return 'MEDIUM';
    return 'LOW';
}
/**
 * Attributes each diarised voice to a clinical role.
 *
 * The result always states its own confidence. A LOW or NONE confidence assignment is
 * returned as `role: null` so nothing downstream can mistake a weak inference for a fact.
 */
function attributeVoices(segments, options = {}) {
    const speakerIds = Array.from(new Set(segments.map((s) => s.speakerId))).filter((id) => id && id.toUpperCase() !== 'UNKNOWN');
    if (speakerIds.length === 0) {
        return {
            assignments: [],
            map: {},
            requiresClinicianConfirmation: true,
            speakerCount: 0
        };
    }
    const profiles = speakerIds.map((id) => profileVoice(id, segments));
    const totalDuration = profiles.reduce((n, p) => n + p.durationMs, 0) || 1;
    // The clinician normally opens the consultation. Worth a nudge, never a decision.
    if (options.clinicianSpeaksFirst !== false) {
        const opener = profiles.reduce((a, b) => (a.firstSpeechMs <= b.firstSpeechMs ? a : b));
        opener.clinicianScore += 3;
        opener.rationale.push('spoke first in the session');
    }
    const assignments = [];
    const claimed = new Set();
    // Assign the most confident voices first, so a strong clinician signal is not stolen by a
    // weaker competing claim on the same role.
    const ordered = [...profiles].sort((a, b) => Math.max(b.clinicianScore, b.patientScore, b.carerScore, b.interpreterScore) -
        Math.max(a.clinicianScore, a.patientScore, a.carerScore, a.interpreterScore));
    for (const profile of ordered) {
        const known = options.knownAssignments?.[profile.speakerId];
        if (known) {
            claimed.add(known);
            assignments.push({
                speakerId: profile.speakerId,
                role: known,
                confidence: 'HIGH',
                rationale: ['identified by the clinician'],
                speakingShare: profile.durationMs / totalDuration
            });
            continue;
        }
        const candidates = [
            { role: client_1.ParticipantRole.THERAPIST, score: profile.clinicianScore },
            { role: client_1.ParticipantRole.CLIENT, score: profile.patientScore },
            { role: client_1.ParticipantRole.CARER, score: profile.carerScore },
            { role: client_1.ParticipantRole.INTERPRETER, score: profile.interpreterScore }
        ]
            .filter((c) => !claimed.has(c.role))
            .sort((a, b) => b.score - a.score);
        const bestRole = candidates[0]?.role ?? null;
        const bestScore = candidates[0]?.score ?? 0;
        const runnerUp = candidates[1]?.score ?? 0;
        const confidence = confidenceFor(bestScore - runnerUp, bestScore);
        // LOW and NONE are not good enough to write into a clinical record unreviewed.
        const accepted = confidence === 'HIGH' || confidence === 'MEDIUM';
        if (accepted && bestRole)
            claimed.add(bestRole);
        assignments.push({
            speakerId: profile.speakerId,
            role: accepted ? bestRole : null,
            confidence,
            rationale: profile.rationale.length > 0 ? profile.rationale : ['no distinguishing language observed'],
            speakingShare: profile.durationMs / totalDuration
        });
    }
    // Two voices, one confidently attributed: the remaining voice is the other party by
    // elimination in a two-person consultation. This is inference from structure, not from
    // language, so it is reported as MEDIUM and still offered for confirmation.
    if (assignments.length === 2) {
        const resolved = assignments.filter((a) => a.role);
        const unresolved = assignments.filter((a) => !a.role);
        if (resolved.length === 1 && unresolved.length === 1) {
            const other = resolved[0].role === client_1.ParticipantRole.THERAPIST
                ? client_1.ParticipantRole.CLIENT
                : resolved[0].role === client_1.ParticipantRole.CLIENT
                    ? client_1.ParticipantRole.THERAPIST
                    : null;
            if (other) {
                unresolved[0].role = other;
                unresolved[0].confidence = 'MEDIUM';
                unresolved[0].rationale.push(`assigned by elimination: the only other voice in a two-person session, ` +
                    `the first being the ${resolved[0].role?.toLowerCase()}`);
            }
        }
    }
    const map = {};
    for (const a of assignments) {
        if (a.role)
            map[a.speakerId] = a.role;
    }
    return {
        assignments: assignments.sort((a, b) => b.speakingShare - a.speakingShare),
        map,
        requiresClinicianConfirmation: assignments.some((a) => !a.role || a.confidence !== 'HIGH'),
        speakerCount: speakerIds.length
    };
}
/** One-line summary of attribution for the clinician-facing note. */
function describeAttribution(result) {
    if (result.speakerCount === 0) {
        return 'No speaker separation was available for this recording; statements are unattributed.';
    }
    if (result.speakerCount === 1) {
        return 'Only one voice was distinguished in this recording; statements are unattributed.';
    }
    const parts = result.assignments.map((a) => {
        const who = a.role ? a.role.toLowerCase() : 'unattributed';
        const share = Math.round(a.speakingShare * 100);
        return `${a.speakerId} → ${who} (${a.confidence.toLowerCase()} confidence, ${share}% of speech: ${a.rationale.join('; ')})`;
    });
    return `${result.speakerCount} voices separated. ${parts.join('. ')}.`;
}
