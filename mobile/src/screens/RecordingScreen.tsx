import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert } from 'react-native';

export function RecordingScreen({ onFinishRecording }: { onFinishRecording: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [audioQuality, setAudioQuality] = useState<'GOOD' | 'LOW_LEVEL' | 'NOISY'>('GOOD');
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (!isPaused) {
      interval = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }

    // Dynamic audio quality inspection simulation
    if (seconds > 10 && seconds < 20) {
      setAudioQuality('LOW_LEVEL');
      setWarningMessage('Audio level is low. Move the device closer to the participants.');
    } else {
      setAudioQuality('GOOD');
      setWarningMessage(null);
    }

    return () => clearInterval(interval);
  }, [isPaused, seconds]);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Explicit Non-Covert Recording Indicator */}
      <View style={styles.banner}>
        <View style={[styles.dot, isPaused ? styles.dotPaused : styles.dotActive]} />
        <Text style={styles.bannerText}>{isPaused ? 'PAUSED' : '● RECORDING IN PROGRESS'}</Text>
      </View>

      <Text style={styles.timer}>{formatTime(seconds)}</Text>

      <View style={styles.metaBox}>
        <Text style={styles.metaText}>Participants: 2 (Therapist + Client)</Text>
        <Text style={styles.metaText}>Microphone: Active (16 kHz PCM Mono Target)</Text>
        <Text style={[styles.metaText, audioQuality === 'GOOD' ? styles.qualityGood : styles.qualityWarn]}>
          Audio Quality: {audioQuality}
        </Text>
      </View>

      {warningMessage && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>⚠️ {warningMessage}</Text>
        </View>
      )}

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.button, styles.pauseButton]}
          onPress={() => setIsPaused(!isPaused)}
        >
          <Text style={styles.buttonText}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.stopButton]}
          onPress={() => {
            Alert.alert('Finish Recording', 'Are you sure you want to complete audio capture?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Stop & Upload', onPress: onFinishRecording }
            ]);
          }}
        >
          <Text style={styles.buttonText}>Stop & Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', padding: 24, justifyContent: 'center', alignItems: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e293b', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginBottom: 30 },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  dotActive: { backgroundColor: '#ef4444' },
  dotPaused: { backgroundColor: '#f59e0b' },
  bannerText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 },
  timer: { fontSize: 56, fontWeight: 'bold', color: '#f8fafc', marginVertical: 20 },
  metaBox: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, width: '100%', marginBottom: 20 },
  metaText: { color: '#94a3b8', fontSize: 14, marginVertical: 4 },
  qualityGood: { color: '#22c55e', fontWeight: 'bold' },
  qualityWarn: { color: '#f59e0b', fontWeight: 'bold' },
  warningBox: { backgroundColor: '#451a03', padding: 12, borderRadius: 8, width: '100%', marginBottom: 20 },
  warningText: { color: '#fcd34d', fontSize: 13, textAlign: 'center' },
  controlsRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 20 },
  button: { flex: 1, paddingVertical: 16, borderRadius: 10, alignItems: 'center', marginHorizontal: 6 },
  pauseButton: { backgroundColor: '#334155' },
  stopButton: { backgroundColor: '#dc2626' },
  buttonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 16 }
});
