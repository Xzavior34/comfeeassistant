import { MobileAudioRecorderService } from '../../mobile/src/services/audioRecorder';

describe('Mobile Hardware Audio Pipeline Inspection', () => {
  const service = new MobileAudioRecorderService();

  it('should retrieve hardware audio recording diagnostics matching 16kHz PCM target specifications', async () => {
    const diag = await service.inspectCurrentRecordingDevice();
    expect(diag.permissionGranted).toBe(true);
    expect(diag.sampleRate).toBe(16000);
    expect(diag.channels).toBe(1);
    expect(diag.format).toBe('audio/wav');
    expect(diag.isTranscodingRequired).toBe(false);
  });
});
