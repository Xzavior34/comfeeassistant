import React, { useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, TouchableOpacity } from 'react-native';
import { ConsentScreen } from './src/screens/ConsentScreen';
import { RecordingScreen } from './src/screens/RecordingScreen';
import { ReviewScreen } from './src/screens/ReviewScreen';
import { DiagnosticScreen } from './src/screens/DiagnosticScreen';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'HOME' | 'DIAGNOSTICS' | 'CONSENT' | 'RECORDING' | 'PROCESSING' | 'REVIEW' | 'COMPLETED'>('HOME');

  return (
    <SafeAreaView style={styles.container}>
      {currentScreen === 'HOME' && (
        <View style={styles.homeBox}>
          <Text style={styles.title}>Vabatim</Text>
          <Text style={styles.subtitle}>UK Seating & Mobility Accessibility Documentation Assistant</Text>
          <TouchableOpacity style={styles.startButton} onPress={() => setCurrentScreen('CONSENT')}>
            <Text style={styles.buttonText}>Start New Assessment Meeting</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.diagButton} onPress={() => setCurrentScreen('DIAGNOSTICS')}>
            <Text style={styles.diagButtonText}>⚙️ Audio Hardware Diagnostics</Text>
          </TouchableOpacity>
        </View>
      )}

      {currentScreen === 'DIAGNOSTICS' && (
        <DiagnosticScreen onBack={() => setCurrentScreen('HOME')} />
      )}

      {currentScreen === 'CONSENT' && (
        <ConsentScreen
          onConsentGranted={() => setCurrentScreen('RECORDING')}
          onConsentDenied={() => setCurrentScreen('HOME')}
        />
      )}

      {currentScreen === 'RECORDING' && (
        <RecordingScreen
          onFinishRecording={() => {
            setCurrentScreen('PROCESSING');
            setTimeout(() => setCurrentScreen('REVIEW'), 1500);
          }}
        />
      )}

      {currentScreen === 'PROCESSING' && (
        <View style={styles.homeBox}>
          <Text style={styles.title}>Processing Meeting Audio...</Text>
          <Text style={styles.subtitle}>Performing Speech Recognition, Diarization, and Evidence Grounding</Text>
        </View>
      )}

      {currentScreen === 'REVIEW' && (
        <ReviewScreen onApprove={() => setCurrentScreen('COMPLETED')} />
      )}

      {currentScreen === 'COMPLETED' && (
        <View style={styles.homeBox}>
          <Text style={styles.title}>✅ Assessment Approved</Text>
          <Text style={styles.subtitle}>PDF & DOCX clinical documents generated and available via secure link.</Text>
          <TouchableOpacity style={styles.startButton} onPress={() => setCurrentScreen('HOME')}>
            <Text style={styles.buttonText}>Return to Home</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  homeBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#f8fafc', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginBottom: 30 },
  startButton: { backgroundColor: '#2563eb', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 10, marginBottom: 16 },
  diagButton: { backgroundColor: '#334155', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
  diagButtonText: { color: '#cbd5e1', fontWeight: '600', fontSize: 14 }
});
