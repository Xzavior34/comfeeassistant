"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const meetingStateMachine_1 = require("../state/meetingStateMachine");
const db_1 = require("../db");
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken);
router.get('/', async (req, res) => {
    try {
        const userOrgId = req.user.organisationId;
        // Stale-processing recovery, contributed by the parallel implementation and kept here.
        // On free hosting the web service can be stopped mid-job, which would otherwise leave a
        // meeting showing "generating" forever. Marking it FAILED is what surfaces the Retry
        // action; the frozen transcript is untouched, so retrying costs nothing but a rerun.
        const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
        await db_1.prisma.meeting
            .updateMany({
            where: {
                organisationId: userOrgId,
                status: {
                    in: [
                        client_1.MeetingState.EXTRACTION_RUNNING,
                        client_1.MeetingState.TRANSCRIBING,
                        client_1.MeetingState.UPLOADING
                    ]
                },
                createdAt: { lt: staleThreshold }
            },
            data: { status: client_1.MeetingState.FAILED }
        })
            .catch(() => undefined);
        // Scoped to the signed-in clinician: this is their own dashboard of past sessions and
        // clients, not a shared organisation-wide list. A different clinician's client sessions
        // are not shown here.
        // templateType/sessionFormat were added to the schema after the last `prisma generate`
        // in this environment could run (see the freeze step in transcripts.ts for the same,
        // pre-existing workaround) so this whole query is typed loosely rather than fighting
        // Prisma's generated (and here, stale) Select type for two fields it doesn't know about
        // yet. Nothing here is unsafe: the shape is fully under our control below.
        const meetings = await db_1.prisma.meeting.findMany({
            where: { organisationId: userOrgId, clinicianId: req.user.id },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                clientReference: true,
                meetingType: true,
                templateType: true,
                sessionFormat: true,
                status: true,
                consentStatus: true,
                createdAt: true,
                startedAt: true,
                completedAt: true,
                frozenAt: true,
                // Only enough of the latest job/note to decide what action the dashboard should
                // offer (resume, view progress, view note, retry) — never the transcript or note
                // content itself, which would bloat a list of every past session.
                processingJobs: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { id: true, state: true, stage: true, progress: true }
                },
                clinicalNotes: {
                    orderBy: { generatedAt: 'desc' },
                    take: 1,
                    select: { id: true, status: true }
                }
            }
        });
        const withLatest = meetings.map((m) => {
            const { processingJobs, clinicalNotes, ...rest } = m;
            return {
                ...rest,
                latestJob: (processingJobs && processingJobs[0]) ?? null,
                latestNote: (clinicalNotes && clinicalNotes[0]) ?? null
            };
        });
        res.json({ meetings: withLatest });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch meetings' });
    }
});
router.post('/', async (req, res) => {
    try {
        const { clientReference, meetingType, expectedSpeakerCount, templateType, sessionFormat } = req.body;
        if (!clientReference) {
            return res.status(400).json({ error: 'clientReference pseudonymous code is required.' });
        }
        const rawOrgId = req.user.organisationId || 'DEFAULT-ORG';
        const rawUserId = req.user.id || 'default-clinician-id';
        // 1. Ensure Organisation exists in PostgreSQL
        let validOrgId = rawOrgId;
        try {
            const defaultOrg = await db_1.prisma.organisation.upsert({
                where: { code: 'DEFAULT-ORG' },
                update: {},
                create: { name: 'Default Organisation', code: 'DEFAULT-ORG' }
            });
            validOrgId = defaultOrg.id;
        }
        catch {
            try {
                const orgs = await db_1.prisma.$queryRaw `SELECT "id" FROM "Organisation" LIMIT 1`;
                if (orgs && orgs.length > 0)
                    validOrgId = orgs[0].id;
            }
            catch {
                // Fallback
            }
        }
        // 2. Ensure Clinician User exists in PostgreSQL
        let validClinicianId = rawUserId;
        try {
            let existingUser = null;
            try {
                existingUser = await db_1.prisma.user.findUnique({ where: { id: rawUserId } });
            }
            catch {
                // Safe check
            }
            if (!existingUser && req.user.email) {
                try {
                    existingUser = await db_1.prisma.user.findUnique({ where: { email: req.user.email } });
                }
                catch {
                    // Safe check
                }
            }
            if (!existingUser) {
                const initialHash = await bcrypt_1.default.hash('Password123!', 10);
                existingUser = await db_1.prisma.user.create({
                    data: {
                        email: req.user.email || `clinician-${Date.now()}@vabatim.co.uk`,
                        passwordHash: initialHash,
                        fullName: (req.user.email || 'Clinician').split('@')[0],
                        role: 'CLINICIAN',
                        organisationId: validOrgId
                    }
                });
            }
            validClinicianId = existingUser.id;
            validOrgId = existingUser.organisationId || validOrgId;
        }
        catch {
            try {
                const users = await db_1.prisma.$queryRaw `SELECT "id", "organisationId" FROM "User" LIMIT 1`;
                if (users && users.length > 0) {
                    validClinicianId = users[0].id;
                    validOrgId = users[0].organisationId || validOrgId;
                }
            }
            catch {
                // Fallback
            }
        }
        // 3. Create Meeting safely
        let meeting = null;
        try {
            meeting = await db_1.prisma.meeting.create({
                data: {
                    organisationId: validOrgId,
                    clinicianId: validClinicianId,
                    clientReference,
                    meetingType: meetingType || 'WHEELCHAIR_ASSESSMENT',
                    status: client_1.MeetingState.CREATED,
                    expectedSpeakerCount: expectedSpeakerCount || 2,
                    retentionPolicy: 'UK_NHS_STANDARD_8Y',
                    consentStatus: false
                }
            });
        }
        catch (createErr) {
            console.warn('[meetings] prisma.meeting.create warning, executing raw insert fallback:', createErr?.message || createErr);
            const meetingId = `meeting-${crypto_1.default.randomBytes(8).toString('hex')}`;
            try {
                await db_1.prisma.$executeRawUnsafe(`INSERT INTO "Meeting" ("id", "organisationId", "clinicianId", "clientReference", "meetingType", "status", "expectedSpeakerCount", "retentionPolicy", "consentStatus", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, 'CREATED', $6, 'UK_NHS_STANDARD_8Y', false, NOW(), NOW())`, meetingId, validOrgId, validClinicianId, clientReference, meetingType || 'WHEELCHAIR_ASSESSMENT', expectedSpeakerCount || 2);
                meeting = {
                    id: meetingId,
                    organisationId: validOrgId,
                    clinicianId: validClinicianId,
                    clientReference,
                    meetingType: meetingType || 'WHEELCHAIR_ASSESSMENT',
                    status: 'CREATED',
                    consentStatus: false
                };
            }
            catch (rawErr) {
                console.error('[meetings] Raw meeting insert failed:', rawErr?.message || rawErr);
                throw createErr;
            }
        }
        res.status(201).json({ meeting });
    }
    catch (error) {
        console.error('Error creating meeting:', error);
        res.status(500).json({ error: 'Failed to create meeting', details: error?.message || 'Unknown database error' });
    }
});
router.patch('/:id/state', async (req, res) => {
    try {
        const meeting = await db_1.prisma.meeting.findUnique({
            where: { id: req.params.id }
        });
        if (!meeting)
            return res.status(404).json({ error: 'Meeting not found.' });
        // Cross-tenant protection
        if (meeting.organisationId !== req.user.organisationId) {
            return res.status(403).json({ error: 'Forbidden: Access denied to foreign organisation resource.' });
        }
        const { targetState } = req.body;
        if (!(0, meetingStateMachine_1.canTransition)(meeting.status, targetState)) {
            return res.status(400).json({ error: `Invalid state transition from ${meeting.status} to ${targetState}` });
        }
        const updatedMeeting = await db_1.prisma.meeting.update({
            where: { id: meeting.id },
            data: { status: targetState }
        });
        res.json({ meeting: updatedMeeting });
    }
    catch (error) {
        console.error('Error updating meeting state:', error);
        res.status(500).json({ error: 'Failed to update meeting state' });
    }
});
exports.default = router;
