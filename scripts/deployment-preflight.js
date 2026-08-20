/**
 * Vabatim Deployment Preflight Inspector
 * Automated pre-deployment validation check for Vercel and Render deployments.
 */

const fs = require('fs');
const path = require('path');

let errors = 0;
let warnings = 0;

function logPass(msg) {
  console.log(`[PASS] ${msg}`);
}

function logFail(msg) {
  console.error(`[FAIL] ${msg}`);
  errors++;
}

function logWarn(msg) {
  console.warn(`[WARN] ${msg}`);
  warnings++;
}

console.log(`=======================================================`);
console.log(` VABATIM AUTOMATED DEPLOYMENT PREFLIGHT CHECK`);
console.log(`=======================================================`);

// 1. Check package.json engines & build scripts
const pkgPath = path.join(__dirname, '../package.json');
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.engines && pkg.engines.node) {
    logPass(`package.json contains engines declaration: ${pkg.engines.node}`);
  } else {
    logWarn(`package.json missing engines declaration`);
  }

  if (pkg.scripts && pkg.scripts.build && pkg.scripts.build.includes('prisma generate')) {
    logPass(`package.json build script includes prisma generate`);
  } else {
    logFail(`package.json build script must include prisma generate`);
  }
} else {
  logFail(`package.json not found`);
}

// 2. Check render.yaml
const renderPath = path.join(__dirname, '../render.yaml');
if (fs.existsSync(renderPath)) {
  const renderContent = fs.readFileSync(renderPath, 'utf8');
  if (renderContent.includes('npm run build') && renderContent.includes('dist/server.js')) {
    logPass(`render.yaml correctly configured for web & worker targets`);
  } else {
    logWarn(`render.yaml check warnings`);
  }
} else {
  logFail(`render.yaml not found`);
}

// 3. Check vercel.json
const vercelPath = path.join(__dirname, '../vercel.json');
if (fs.existsSync(vercelPath)) {
  const vercelContent = fs.readFileSync(vercelPath, 'utf8');
  if (!vercelContent.includes('"framework": "nextjs"')) {
    logPass(`vercel.json correctly avoids invalid Next.js framework preset`);
  } else {
    logFail(`vercel.json must not set "framework": "nextjs" for Express API repository`);
  }
} else {
  logFail(`vercel.json not found`);
}

// 4. Check api/index.ts entrypoint
const apiIndexPath = path.join(__dirname, '../api/index.ts');
if (fs.existsSync(apiIndexPath)) {
  logPass(`api/index.ts serverless function entrypoint exists`);
} else {
  logFail(`api/index.ts serverless function entrypoint missing`);
}

// 5. Check DeviceSpeechProvider SSR Guard
const deviceSpeechPath = path.join(__dirname, '../src/providers/speech/DeviceSpeechProvider.ts');
if (fs.existsSync(deviceSpeechPath)) {
  const speechContent = fs.readFileSync(deviceSpeechPath, 'utf8');
  if (speechContent.includes("typeof window !== 'undefined'") || speechContent.includes("typeof globalThis !== 'undefined'")) {
    logPass(`DeviceSpeechProvider.ts includes SSR browser global checks`);
  } else {
    logFail(`DeviceSpeechProvider.ts missing SSR window/globalThis guards`);
  }
}

// 6. Check Server Host Binding (0.0.0.0)
const serverPath = path.join(__dirname, '../src/server.ts');
if (fs.existsSync(serverPath)) {
  const serverContent = fs.readFileSync(serverPath, 'utf8');
  if (serverContent.includes('0.0.0.0')) {
    logPass(`src/server.ts explicitly binds to host 0.0.0.0`);
  } else {
    logWarn(`src/server.ts should explicitly bind to 0.0.0.0 for Render production`);
  }
}

console.log(`=======================================================`);
if (errors > 0) {
  console.error(`PREFLIGHT CHECK FAILED (${errors} errors, ${warnings} warnings)`);
  process.exit(1);
} else {
  console.log(`PREFLIGHT CHECK PASSED (0 errors, ${warnings} warnings)`);
  process.exit(0);
}
