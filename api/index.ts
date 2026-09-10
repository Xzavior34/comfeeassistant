// NOT the live entry point. vercel.json rewrites /api/* and /health straight to the Render
// service (https://comfeeassistant.onrender.com/...), so this Vercel serverless function is
// never actually invoked by the deployed frontend. Left in place only because removing it is
// a bigger decision than fixing it silently; it has already drifted from src/server.ts (no
// db-push-on-boot step, a fresh in-memory rate limiter per cold start) and would behave
// differently from the real API the moment anyone assumes it's live or changes the rewrite
// rule above. Delete this file, or make it the real entry point and delete src/server.ts, but
// don't leave both quietly diverging.
import app from '../src/app';

export default app;
