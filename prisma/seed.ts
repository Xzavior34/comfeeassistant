import { PrismaClient, UserRole, MeetingState, ParticipantRole } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding Vabatim database...');

  const org = await prisma.organisation.upsert({
    where: { code: 'NHS-UK-TRUST-01' },
    update: {},
    create: {
      name: 'UK NHS Seating & Mobility Trust',
      code: 'NHS-UK-TRUST-01'
    }
  });

  const passwordHash = await bcrypt.hash('ClinicianSecure123!', 10);

  const clinician = await prisma.user.upsert({
    where: { email: 'sarah.jenkins@nhs.uk' },
    update: {},
    create: {
      email: 'sarah.jenkins@nhs.uk',
      passwordHash,
      fullName: 'Dr. Sarah Jenkins (Senior Wheelchair Therapist)',
      role: UserRole.CLINICIAN,
      organisationId: org.id
    }
  });

  const meeting = await prisma.meeting.create({
    data: {
      organisationId: org.id,
      clinicianId: clinician.id,
      clientReference: 'CLIENT-REF-8842',
      meetingType: 'PHYSICAL_SEATING_ASSESSMENT',
      status: MeetingState.TRANSCRIPT_READY,
      expectedSpeakerCount: 2,
      retentionPolicy: 'UK_NHS_STANDARD_8Y',
      consentStatus: true,
      participants: {
        create: [
          { speakerId: 'Speaker 1', role: ParticipantRole.THERAPIST, displayName: 'Dr. Sarah Jenkins' },
          { speakerId: 'Speaker 2', role: ParticipantRole.CLIENT, displayName: 'John Doe (Client)' }
        ]
      },
      consentRecords: {
        create: [
          {
            consentVersion: 'v1.2-UK-GDPR',
            consentStatus: 'GRANTED',
            policyVersion: '2026-PRIVACY-POLICY-V2',
            participantRef: 'CLIENT-REF-8842',
            actorId: clinician.id,
            metadata: { method: 'DIGITAL_SIGNATURE_TABLET' }
          }
        ]
      }
    }
  });

  console.log(`Database seeded successfully! Demo meeting created with ID: ${meeting.id}`);
}

seed()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
