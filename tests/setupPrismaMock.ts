import bcrypt from 'bcrypt';

let mockUsers: any[] = [];
let mockMeetings: any[] = [];
let mockConsents: any[] = [];
let mockNotes: any[] = [];

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
      clinicalNote: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          const n = { id: `n-${Date.now()}`, ...data };
          mockNotes.push(n);
          return n;
        })
      },
      $disconnect: jest.fn()
    }
  };
});

beforeEach(() => {
  mockUsers = [];
  mockMeetings = [];
  mockConsents = [];
  mockNotes = [];
});
