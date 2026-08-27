import bcrypt from 'bcrypt';

let mockUsers: any[] = [];
let mockMeetings: any[] = [];
let mockConsents: any[] = [];
let mockNotes: any[] = [];
let mockJobs: any[] = [];

/** Attaches the relations the routes request via `include`. */
function withRelations(note: any) {
  const meeting = mockMeetings.find((m) => m.id === note.meetingId) ?? {
    id: note.meetingId,
    organisationId: 'NHS-UK-TRUST-01',
    clientReference: 'TEST-REF',
    createdAt: new Date()
  };
  return {
    ...note,
    meeting: { ...meeting, organisation: { name: 'Test Trust' }, clinician: { email: 'clinician@test.nhs.uk' } },
    approvedBy: note.approvedById ? { email: 'clinician@test.nhs.uk' } : null,
    versions: note.versions ?? []
  };
}

jest.mock('../src/db', () => {
  return {
    prisma: {
      user: {
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          if (where.email === 'sarah.jenkins@nhs.uk') {
            return {
              id: 'user-clinician-1',
              email: 'sarah.jenkins@nhs.uk',
              fullName: 'Dr. Sarah Jenkins',
              role: 'CLINICIAN',
              organisationId: 'NHS-UK-TRUST-01',
              passwordHash: bcrypt.hashSync('ClinicianSecure123!', 10)
            };
          }
          return mockUsers.find(u => Object.keys(where).every(k => u[k] === where[k]));
        }),
      },
      meeting: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const m = { id: `m-${Date.now()}`, ...data, createdAt: new Date() };
          mockMeetings.push(m);
          return m;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const idx = mockMeetings.findIndex(m => m.id === where.id);
          if (idx >= 0) {
            mockMeetings[idx] = { ...mockMeetings[idx], ...data };
            return mockMeetings[idx];
          }
          return null;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          return mockMeetings.find(m => m.id === where.id);
        }),
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          return mockMeetings.filter(m => m.organisationId === where.organisationId);
        })
      },
      consentRecord: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const c = { id: `c-${Date.now()}`, ...data };
          mockConsents.push(c);
          return c;
        })
      },
      // The clinical note now has a full lifecycle — generated, reviewed, edited, approved —
      // so the mock has to support reading and updating it, not only creating it.
      clinicalNote: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const n = {
            id: `n-${Date.now()}-${mockNotes.length}`,
            status: 'REVIEW_REQUIRED',
            generatedAt: new Date(),
            reviewedAt: null,
            approvedAt: null,
            versions: [],
            ...data
          };
          mockNotes.push(n);
          return n;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          const note = mockNotes.find((n) => n.id === where.id);
          return note ? withRelations(note) : null;
        }),
        findFirst: jest.fn().mockImplementation(async ({ where }) => {
          const matches = mockNotes.filter((n) =>
            Object.keys(where ?? {}).every((k) => n[k] === (where as any)[k])
          );
          const note = matches[matches.length - 1];
          return note ? withRelations(note) : null;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const idx = mockNotes.findIndex((n) => n.id === where.id);
          if (idx < 0) return null;
          const { versions, ...rest } = data ?? {};
          mockNotes[idx] = { ...mockNotes[idx], ...rest };
          return mockNotes[idx];
        })
      },
      processingJob: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const j = {
            id: `job-${Date.now()}-${mockJobs.length}`,
            state: 'PENDING',
            stage: 'Queued',
            progress: 0,
            attempts: 0,
            lastError: null,
            clinicalNoteId: null,
            createdAt: new Date(),
            startedAt: null,
            finishedAt: null,
            ...data
          };
          mockJobs.push(j);
          return j;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }) => mockJobs.find((j) => j.id === where.id) ?? null),
        findFirst: jest.fn().mockImplementation(async ({ where }) =>
          [...mockJobs].reverse().find((j) => j.meetingId === where?.meetingId) ?? null
        ),
        findMany: jest.fn().mockImplementation(async () => []),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const idx = mockJobs.findIndex((j) => j.id === where.id);
          if (idx < 0) return null;
          const next = { ...mockJobs[idx] };
          for (const [k, v] of Object.entries(data ?? {})) {
            next[k] = v && typeof v === 'object' && 'increment' in (v as any)
              ? (next[k] ?? 0) + (v as any).increment
              : v;
          }
          mockJobs[idx] = next;
          return next;
        })
      },
      // Health checks perform a real round trip, so the mock has to answer one.
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      $disconnect: jest.fn()
    }
  };
});

beforeEach(() => {
  mockUsers = [];
  mockMeetings = [];
  mockConsents = [];
  mockNotes = [];
  mockJobs = [];
});
