import { StructuredClinicalExtraction } from '../types';

export interface EditMetrics {
  editClassification: 'UNCHANGED' | 'MINOR_EDIT' | 'SUBSTANTIAL_EDIT' | 'ADDITION' | 'REMOVAL';
  sectionsChangedCount: number;
  totalAdditions: number;
  totalRemovals: number;
  speechCorrectionsProposed: number;
  speechCorrectionsAccepted: number;
  groundingViolations: number;
}

export class MetricsService {
  /**
   * Compares the original AI Draft JSON with the Clinician Approved JSON.
   */
  calculateEditDistance(original: StructuredClinicalExtraction, edited: StructuredClinicalExtraction): EditMetrics {
    let sectionsChangedCount = 0;
    let totalAdditions = 0;
    let totalRemovals = 0;
    let speechCorrectionsProposed = 0;
    let speechCorrectionsAccepted = 0;
    let groundingViolations = 0;

    // Helper to extract all values from a section
    const getValues = (note: any) => {
      const values: string[] = [];
      const traverse = (obj: any) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
          obj.forEach(item => {
            if (item.value) values.push(item.value);
            if (item.isCorrected) speechCorrectionsProposed++;
          });
        } else if (typeof obj === 'object') {
          Object.values(obj).forEach(traverse);
        }
      };
      traverse(note);
      return values;
    };

    const originalValues = getValues(original);
    
    // Reset proposed count because we only want to count it once
    const proposed = speechCorrectionsProposed;
    speechCorrectionsProposed = 0;
    
    getValues(original); // recount for the original
    speechCorrectionsProposed = proposed; // store the count
    
    const editedValues = getValues(edited);
    
    // Simple set difference to find additions and removals
    const origSet = new Set(originalValues);
    const editSet = new Set(editedValues);

    for (const val of editSet) {
      if (!origSet.has(val)) {
        totalAdditions++;
      }
    }
    for (const val of origSet) {
      if (!editSet.has(val)) {
        totalRemovals++;
      }
    }
    
    const totalChanges = totalAdditions + totalRemovals;
    sectionsChangedCount = totalChanges > 0 ? 1 : 0; // Simplified for MVP

    let editClassification: EditMetrics['editClassification'] = 'UNCHANGED';
    
    if (totalChanges === 0) {
      editClassification = 'UNCHANGED';
    } else if (totalChanges < 3) {
      editClassification = 'MINOR_EDIT';
    } else {
      editClassification = 'SUBSTANTIAL_EDIT';
    }

    if (totalAdditions > 0 && totalRemovals === 0) {
      editClassification = 'ADDITION';
    } else if (totalRemovals > 0 && totalAdditions === 0) {
      editClassification = 'REMOVAL';
    }
    
    if (totalChanges > 3) {
        editClassification = 'SUBSTANTIAL_EDIT';
    }

    // Since we don't track accepted/rejected corrections at a granular level yet, we'll estimate
    speechCorrectionsAccepted = Math.max(0, speechCorrectionsProposed - totalRemovals);
    
    // Grounding violations can be roughly checked by unsupported additions (which we can't definitively know without the transcript, so we use 0 as a default safe assumption for the MVP)
    groundingViolations = 0;

    return {
      editClassification,
      sectionsChangedCount,
      totalAdditions,
      totalRemovals,
      speechCorrectionsProposed,
      speechCorrectionsAccepted,
      groundingViolations
    };
  }
}

export const metricsService = new MetricsService();
