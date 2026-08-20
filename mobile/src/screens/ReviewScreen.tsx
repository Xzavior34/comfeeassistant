import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';

export function ReviewScreen({ onApprove }: { onApprove: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Clinician Review & Approval</Text>
      <Text style={styles.subHeader}>Canonical Transcript vs Evidence-Linked Structured Note</Text>

      {/* Side-by-Side Review Section */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Canonical Transcript (Authoritative Source)</Text>
        <Text style={styles.transcriptText}>
          <Text style={styles.speakerTag}>Speaker 1 (Therapist):</Text> Good morning, Mr. Davis...
        </Text>
        <Text style={styles.transcriptText}>
          <Text style={styles.speakerTag}>Speaker 2 (Client):</Text> Main concern is severe lower back pain and pressure sores...
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>2. AI Structured Note (Grounding Verified)</Text>
        <Text style={styles.noteItem}>• <Text style={styles.bold}>Client Concern:</Text> Sacral pressure sore after 2h sitting [Seg #2]</Text>
        <Text style={styles.noteItem}>• <Text style={styles.bold}>Accessibility Barrier:</Text> 2 entrance steps, 680mm bathroom door [Seg #4]</Text>
        <Text style={styles.noteItem}>• <Text style={styles.bold}>MAT Finding:</Text> 15° posterior pelvic tilt, 10° right pelvic obliquity [Seg #5]</Text>
        <Text style={styles.noteItem}>• <Text style={styles.bold}>Action:</Text> Trial high-spec pressure redistributing foam cushion [Seg #7]</Text>
      </View>

      <TouchableOpacity style={styles.approveButton} onPress={onApprove}>
        <Text style={styles.approveButtonText}>Approve & Sign Clinical Report</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0f172a', flexGrow: 1 },
  header: { fontSize: 22, fontWeight: 'bold', color: '#f8fafc', marginBottom: 4 },
  subHeader: { fontSize: 13, color: '#94a3b8', marginBottom: 20 },
  card: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#38bdf8', marginBottom: 10 },
  transcriptText: { color: '#cbd5e1', fontSize: 13, marginVertical: 4 },
  speakerTag: { fontWeight: 'bold', color: '#f1f5f9' },
  noteItem: { color: '#e2e8f0', fontSize: 13, marginVertical: 6 },
  bold: { fontWeight: 'bold', color: '#ffffff' },
  approveButton: { backgroundColor: '#16a34a', paddingVertical: 16, borderRadius: 10, alignItems: 'center', marginTop: 10 },
  approveButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 }
});
