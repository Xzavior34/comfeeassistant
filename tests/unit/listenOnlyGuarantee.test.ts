import fs from 'fs';
import path from 'path';

describe('Phase 18: Listen-Only Guarantee Audit', () => {
  it('Verifies zero text-to-speech / SpeechSynthesis dependencies exist in src/', () => {
    const srcDir = path.join(__dirname, '../../src');
    const files = getFilesRecursive(srcDir);

    const forbiddenTerms = ['SpeechSynthesis', 'speechSynthesis', 'expo-speech', 'TextToSpeech'];
    let forbiddenCount = 0;

    for (const file of files) {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const term of forbiddenTerms) {
          if (content.includes(term)) {
            forbiddenCount++;
          }
        }
      }
    }

    expect(forbiddenCount).toBe(0);
  });
});

function getFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursive(filePath));
    } else {
      results.push(filePath);
    }
  });
  return results;
}
