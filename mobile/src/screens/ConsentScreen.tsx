import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';

export function ConsentScreen({ onConsentGranted, onConsentDenied }: { onConsentGranted: () => void; onConsentDenied: () => void }) {
  const [agreed, setAgreed] = useState(false);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Participant Consent & Privacy Notice</Text>
      <Text style={styles.subtitle}>UK GDPR & Data Protection Act 2018 Compliance Notice</Text>

      <View style={styles.card}>
        <Text style={styles.bodyText}>
          Vabatim records and processes audio during this meeting to produce an evidence-linked clinical documentation draft for wheelchair, seating, and mobility assessment.
        </Text>
        <Text style={styles.bodyText}>
          • <Text style={styles.bold}>Purpose:</Text> Clinical documentation drafting for seating and mobility care.
        </Text>
        <Text style={styles.bodyText}>
          • <Text style={styles.bold}>Data Handling:</Text> Audio is encrypted in transit and at rest.
        </Text>
        <Text style={styles.bodyText}>
          • <Text style={styles.bold}>Retention Policy:</Text> Raw audio deleted per NHS trust policy; approved notes stored securely.
        </Text>
        <Text style={styles.bodyText}>
          • <Text style={styles.bold}>Withdrawal:</Text> You may withdraw consent at any time prior to clinician approval.
        </Text>
        <Text style={styles.legalNotice}>
          REQUIRES ORGANISATIONAL / LEGAL / DPO REVIEW
        </Text>
      </View>

      <TouchableOpacity style={styles.checkboxRow} onPress={() => setAgreed(!agreed)}>
        <View style={[styles.checkbox, agreed && styles.checkboxChecked]} />
        <Text style={styles.checkboxLabel}>Participant has read, understood, and consented to recording.</Text>
      </TouchableOpacity>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.denyButton]} onPress={onConsentDenied}>
          <Text style={styles.buttonText}>Decline / Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.grantButton, !agreed && styles.buttonDisabled]}
          disabled={!agreed}
          onPress={onConsentGranted}
        >
          <Text style={styles.buttonText}>Grant Consent</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#0f172a', flexGrow: 1, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#f8fafc', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  card: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 20 },
  bodyText: { color: '#cbd5e1', fontSize: 14, marginVertical: 6, lineHeight: 20 },
  bold: { fontWeight: 'bold', color: '#ffffff' },
  legalNotice: { color: '#ef4444', fontSize: 11, fontWeight: 'bold', marginTop: 10, textAlign: 'center' },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  checkbox: { width: 22, height: 22, borderBottomWidth: 2, borderColor: '#38bdf8', borderRadius: 4, marginRight: 10 },
  checkboxChecked: { backgroundColor: '#38bdf8' },
  checkboxLabel: { color: '#f8fafc', fontSize: 14, flex: 1 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  button: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginHorizontal: 6 },
  denyButton: { backgroundColor: '#475569' },
  grantButton: { backgroundColor: '#2563eb' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 15 }
});
