"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.composeEntryText = composeEntryText;
exports.buildNarrative = buildNarrative;
exports.narrativeToText = narrativeToText;
const provenance_1 = require("./provenance");
/** Human-readable prefix conveying how a fact is known, where that is not already obvious. */
const SOURCE_PREFIX = {
    SERVICE_USER_REPORTED: 'Reports',
    CARER_REPORTED: 'Carer reports',
    CLINICIAN_OBSERVED: 'Observed',
    OBJECTIVE_MEASURE: 'Measured',
    RECORD_SOURCE: 'From records',
    CLINICAL_REASONING: '',
    AGREED_PLAN: 'Agreed',
    UNRESOLVED: 'Unresolved',
    UNKNOWN: ''
};
const LATERALITY_WORD = {
    LEFT: 'Left',
    RIGHT: 'Right',
    BILATERAL: 'Bilateral',
    MIDLINE: 'Midline',
    NOT_APPLICABLE: '',
    UNSPECIFIED: ''
};
function startsWithSourceContext(value) {
    return /^(reports?|reported|states?|describes?|observed|measured|the (person|patient|client)|agreed|carer)/i.test(value.trim());
}
/**
 * Composes the sentence for one fact.
 *
 * Laterality, measurement context and time course are appended only when they are not
 * already in the value, so the model writing a complete sentence does not produce
 * "Left pelvic obliquity of 15 degrees. Left. 15 degrees."
 */
function composeEntryText(fact) {
    const parts = [];
    const prefix = SOURCE_PREFIX[fact.source_type] ?? '';
    const lateralWord = LATERALITY_WORD[fact.laterality] ?? '';
    let value = fact.value.trim();
    // Add laterality only when the statement does not already carry it.
    if (lateralWord && !new RegExp(`\\b${lateralWord}\\b`, 'i').test(value)) {
        value = `${lateralWord.toLowerCase()} ${value.charAt(0).toLowerCase()}${value.slice(1)}`;
        value = value.charAt(0).toUpperCase() + value.slice(1);
    }
    if (prefix && !startsWithSourceContext(value)) {
        parts.push(`${prefix}: ${value}`);
    }
    else {
        parts.push(value);
    }
    let text = parts.join(' ').trim();
    if (!/[.!?]$/.test(text))
        text += '.';
    // A measurement is only appended when its digits are not already in the sentence; its
    // context is always worth adding, because a measurement without context is not
    // interpretable.
    if (fact.measurement) {
        const m = fact.measurement;
        const already = new RegExp(`\\b${m.value}\\s*${m.unit}\\b`, 'i').test(text);
        if (!already) {
            text += ` Measured ${m.value} ${m.unit}`;
            text += m.context ? ` (${m.context}).` : '.';
        }
        else if (m.context && !text.toLowerCase().includes(m.context.toLowerCase().slice(0, 20))) {
            text += ` Measured in ${m.context}.`;
        }
    }
    if (fact.time_reference && !text.toLowerCase().includes(fact.time_reference.toLowerCase().slice(0, 15))) {
        text += ` ${fact.time_reference.charAt(0).toUpperCase()}${fact.time_reference.slice(1)}`;
        if (!/[.!?]$/.test(text))
            text += '.';
    }
    if (fact.certainty === 'CONTRADICTORY') {
        text += ' [Conflicting account recorded — requires clinician clarification.]';
    }
    else if (fact.certainty === 'UNCERTAIN') {
        text += ' [Uncertain — requires clinician confirmation.]';
    }
    else if (fact.certainty === 'PENDING') {
        text += ' [Pending.]';
    }
    return text.replace(/\s+/g, ' ').trim();
}
/**
 * Wording for a section with nothing in it.
 *
 * The distinction matters clinically: a safety-relevant section that was never assessed is
 * not the same as one that simply did not come up, and neither is the same as a normal
 * finding. The template's own phrasing is used.
 */
function notEstablishedWording(section) {
    return section.safetyRelevant
        ? 'Not assessed during this assessment. Absence of assessment is not evidence that this is not a concern.'
        : 'Not discussed during this assessment.';
}
function buildNarrative(extraction) {
    const bySection = new Map();
    for (const fact of extraction.facts) {
        const list = bySection.get(fact.section_id) ?? [];
        list.push(fact);
        bySection.set(fact.section_id, list);
    }
    const sections = provenance_1.SECTIONS.map((section) => {
        const facts = bySection.get(section.id) ?? [];
        if (facts.length === 0) {
            return {
                id: section.id,
                title: section.title,
                entries: [],
                notEstablished: notEstablishedWording(section)
            };
        }
        // Objective and measured findings lead; items needing review are kept with their
        // subject rather than being swept to the end, so the section still reads as one account.
        const ordered = [...facts].sort((a, b) => {
            const rank = (f) => f.certainty === 'MEASURED' ? 0 : f.certainty === 'OBSERVED' ? 1 : f.certainty === 'CONTRADICTORY' ? 3 : 2;
            return rank(a) - rank(b);
        });
        return {
            id: section.id,
            title: section.title,
            entries: ordered.map((f) => ({
                text: composeEntryText(f),
                requiresReview: f.requires_review || f.certainty === 'CONTRADICTORY' || f.certainty === 'UNCERTAIN',
                reviewReason: f.review_reason ?? null,
                sourceType: f.source_type,
                certainty: f.certainty,
                sourceQuote: f.source_quote,
                fieldId: f.field_id
            }))
        };
    });
    const populated = sections.filter((s) => s.entries.length > 0);
    return {
        sections,
        reviewFlags: extraction.review_flags,
        stats: {
            totalFacts: extraction.facts.length,
            sectionsPopulated: populated.length,
            sectionsNotDiscussed: sections.length - populated.length,
            factsRequiringReview: extraction.facts.filter((f) => f.requires_review).length,
            contradictions: extraction.facts.filter((f) => f.certainty === 'CONTRADICTORY').length
        }
    };
}
/** Plain-text rendering, used for previews and for tests that assert on content. */
function narrativeToText(narrative) {
    const lines = [];
    for (const section of narrative.sections) {
        lines.push(section.title.toUpperCase());
        if (section.entries.length === 0) {
            lines.push(`  ${section.notEstablished}`);
        }
        else {
            for (const entry of section.entries)
                lines.push(`  ${entry.text}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
