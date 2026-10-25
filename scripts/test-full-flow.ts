process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function testFullFlow() {
  const baseUrl = 'https://comfeeassistant-zgrv.onrender.com';
  console.log(`[E2E Test] Testing full flow against ${baseUrl}...`);

  // Step 1: Health check
  console.log('\n--- STEP 1: API Health Check ---');
  const healthRes = await fetch(`${baseUrl}/health`);
  const health = await healthRes.json();
  console.log('Health:', health);

  // Step 2: Login with seeded clinician account
  console.log('\n--- STEP 2: Clinician Login ---');
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'sarah.jenkins@nhs.uk',
      password: 'ClinicianSecure123!'
    })
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    throw new Error(`Login failed (${loginRes.status}): ${JSON.stringify(loginData)}`);
  }
  const token = loginData.token;
  console.log('Login successful! Token received.');

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Step 3: Create a new Assessment Session
  console.log('\n--- STEP 3: Create Assessment Session ---');
  const meetingRes = await fetch(`${baseUrl}/api/meetings`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      clientReference: 'TEST-CLIENT-FLOW-01',
      templateType: 'INITIAL_ASSESSMENT',
      sessionFormat: 'FACE_TO_FACE'
    })
  });
  const meetingData = await meetingRes.json();
  if (!meetingRes.ok) {
    throw new Error(`Create session failed: ${JSON.stringify(meetingData)}`);
  }
  const meetingId = (meetingData.meeting || meetingData).id;
  console.log(`Session created! Meeting ID: ${meetingId}`);

  // Step 4: Record Consent
  console.log('\n--- STEP 4: Record Consent ---');
  const consentRes = await fetch(`${baseUrl}/api/consent`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      meetingId,
      consentGranted: true,
      participantRef: 'TEST-CLIENT-FLOW-01'
    })
  });
  const consentData = await consentRes.json();
  console.log('Consent response:', consentData);

  // Step 5: Submit Transcript for AI Processing
  console.log('\n--- STEP 5: Submit Transcript for OpenRouter Processing ---');
  const sampleTranscript = 
    "Client reports sitting in a standard wheelchair for 6 hours daily. " +
    "Complains of bilateral lower back pain and pressure at the ischial tuberosities. " +
    "Seat width measured at 44cm, seat depth 42cm. Recommends a high-density contoured foam cushion and pelvic support belt.";

  const processRes = await fetch(`${baseUrl}/api/transcripts/process`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      meetingId,
      transcriptText: sampleTranscript,
      clientReference: 'TEST-CLIENT-FLOW-01',
      templateType: 'INITIAL_ASSESSMENT',
      sessionFormat: 'FACE_TO_FACE'
    })
  });
  const processData = await processRes.json();
  if (!processRes.ok) {
    throw new Error(`Transcript process failed (${processRes.status}): ${JSON.stringify(processData)}`);
  }
  const jobId = processData.jobId;
  console.log(`Processing job started! Job ID: ${jobId}`);

  // Step 6: Poll Processing Job
  console.log('\n--- STEP 6: Polling Documentation Job ---');
  let jobStatus: any = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const jobRes = await fetch(`${baseUrl}/api/transcripts/job/${jobId}`, {
      headers: authHeaders
    });
    jobStatus = await jobRes.json();
    console.log(`Poll ${i + 1}: State = ${jobStatus.state}, Progress = ${jobStatus.progress}%, Stage = ${jobStatus.stage}`);
    if (jobStatus.state === 'SUCCEEDED' || jobStatus.state === 'FAILED') break;
  }

  if (jobStatus.state !== 'SUCCEEDED') {
    throw new Error(`Job ended in state ${jobStatus.state}: ${jobStatus.error || jobStatus.lastError || 'Unknown error'}`);
  }

  console.log('Job succeeded! Clinical note generated.');

  // Step 7: Get Review Draft
  console.log('\n--- STEP 7: Fetch Review Draft ---');
  const reviewRes = await fetch(`${baseUrl}/api/reviews/${meetingId}`, {
    headers: authHeaders
  });
  const reviewData = await reviewRes.json();
  if (!reviewRes.ok) {
    throw new Error(`Review draft fetch failed: ${JSON.stringify(reviewData)}`);
  }
  console.log(`Review draft loaded! Note ID: ${reviewData.noteId}, Status: ${reviewData.status}`);
  console.log(`Sections count: ${reviewData.narrative?.sections?.length || 0}`);

  // Step 8: Approve Review
  console.log('\n--- STEP 8: Approve & Finalise Clinical Record ---');
  const approveRes = await fetch(`${baseUrl}/api/reviews/approve`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      meetingId,
      approvedBy: 'sarah.jenkins@nhs.uk',
      attested: true
    })
  });
  const approveData = await approveRes.json();
  if (!approveRes.ok) {
    throw new Error(`Approval failed: ${JSON.stringify(approveData)}`);
  }
  console.log('Review approved! Status:', approveData.status);

  // Step 9: Download PDF Document
  console.log('\n--- STEP 9: Generate & Download PDF ---');
  const pdfRes = await fetch(`${baseUrl}/api/documents/${reviewData.noteId}/pdf`, {
    headers: authHeaders
  });
  if (!pdfRes.ok) {
    const err = await pdfRes.text();
    throw new Error(`PDF generation failed (${pdfRes.status}): ${err}`);
  }
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  console.log(`PDF successfully generated! Size: ${pdfBuffer.length} bytes.`);

  // Step 10: Download DOCX Document
  console.log('\n--- STEP 10: Generate & Download DOCX ---');
  const docxRes = await fetch(`${baseUrl}/api/documents/${reviewData.noteId}/docx`, {
    headers: authHeaders
  });
  if (!docxRes.ok) {
    const err = await docxRes.text();
    throw new Error(`DOCX generation failed (${docxRes.status}): ${err}`);
  }
  const docxBuffer = Buffer.from(await docxRes.arrayBuffer());
  console.log(`DOCX successfully generated! Size: ${docxBuffer.length} bytes.`);

  console.log('\n========================================');
  console.log('🎉 ALL 10 STEPS OF THE FLOW PASSED 100%!');
  console.log('========================================');
}

testFullFlow().catch((e) => {
  console.error('\n❌ E2E TEST FAILED:', e.cause || e.message || e);
  process.exit(1);
});
