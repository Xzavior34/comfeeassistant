import { isOriginAllowed, buildAllowedOrigins } from '../../src/config/cors';
import { resolveTranscriptText } from '../../src/routes/transcripts';
import { describeShape } from '../../src/middleware/requestDiagnostics';

/**
 * Regression tests for the two failures that took production down.
 *
 * Both were caused by tightening something without a compatible counterpart: an allowlist
 * that dropped the deployed frontend, and a schema that rejected payloads the shipped client
 * was already sending. These tests pin the corrected behaviour so neither can recur silently.
 */

describe('J/K. CORS allowlist', () => {
  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

  it('J. accepts the production Vercel origin even with no environment configuration', () => {
    // This is the exact regression: with CORS_ORIGIN and APP_BASE_URL unset, the allowlist
    // collapsed to localhost and every browser request was refused.
    expect(isOriginAllowed('https://comfeeassistant.vercel.app', prod)).toBe(true);
  });

  it('K. rejects an unapproved browser origin', () => {
    expect(isOriginAllowed('https://not-our-app.example.com', prod)).toBe(false);
    expect(isOriginAllowed('https://comfeeassistant.vercel.app.evil.com', prod)).toBe(false);
  });

  it('accepts additional origins from CORS_ORIGIN as a comma-separated list', () => {
    const env = { ...prod, CORS_ORIGIN: 'https://a.example.com, https://b.example.com' };
    expect(isOriginAllowed('https://a.example.com', env)).toBe(true);
    expect(isOriginAllowed('https://b.example.com', env)).toBe(true);
    // The built-in production origin is extended, never replaced.
    expect(isOriginAllowed('https://comfeeassistant.vercel.app', env)).toBe(true);
  });

  it('allows a request with no Origin header', () => {
    // Health checks and server-to-server calls are not cross-origin browser requests.
    expect(isOriginAllowed(undefined, prod)).toBe(true);
  });

  it('permits localhost only outside production', () => {
    expect(isOriginAllowed('http://localhost:5173', { NODE_ENV: 'development' } as any)).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', prod)).toBe(false);
  });

  it('tolerates a trailing slash on APP_BASE_URL', () => {
    const env = { ...prod, APP_BASE_URL: 'https://myapp.vercel.app/' };
    expect(isOriginAllowed('https://myapp.vercel.app', env)).toBe(true);
  });

  it('never silently permits everything', () => {
    expect(buildAllowedOrigins(prod)).not.toContain('*');
  });
});

describe('G/H/I. Transcript submission contract', () => {
  it('H. accepts the plain-text payload the client sends', () => {
    expect(resolveTranscriptText({ transcriptText: 'The seat width is 44 cm.' })).toBe(
      'The seat width is 44 cm.'
    );
  });

  it('accepts a structured segment array and joins it', () => {
    expect(
      resolveTranscriptText({ segments: [{ text: 'Hello there.' }, { text: 'Seat width 44 cm.' }] })
    ).toBe('Hello there. Seat width 44 cm.');
  });

  it('I. reports an empty transcript as empty rather than throwing', () => {
    expect(resolveTranscriptText({ segments: [] })).toBe('');
    expect(resolveTranscriptText({})).toBe('');
    expect(resolveTranscriptText({ transcriptText: '   ' })).toBe('');
  });

  it('ignores blank segments instead of producing ragged whitespace', () => {
    expect(resolveTranscriptText({ segments: [{ text: '  ' }, { text: 'Real content.' }] })).toBe(
      'Real content.'
    );
  });
});

describe('G. Diagnostic logging is safe', () => {
  it('never emits transcript or audio content', () => {
    const shape = describeShape({
      meetingId: 'm-1',
      transcriptText: 'The patient disclosed something highly sensitive about their family.',
      audioBase64: 'AAAABBBBCCCC',
      password: 'hunter2'
    }).join(' ');

    expect(shape).toContain('meetingId=m-1');
    expect(shape).not.toContain('highly sensitive');
    expect(shape).not.toContain('AAAABBBB');
    expect(shape).not.toContain('hunter2');
    // Length is still reported, because that is what makes the problem diagnosable.
    expect(shape).toMatch(/transcriptText:<\d+ chars>/);
  });

  it('describes array sizes without their contents', () => {
    const shape = describeShape({
      segments: [{ text: 'private clinical detail' }, { text: 'more private detail' }]
    }).join(' ');

    expect(shape).toContain('segments[2]');
    expect(shape).not.toContain('private clinical detail');
  });
});
