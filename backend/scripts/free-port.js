'use strict';

// Runs automatically before `npm run dev` (see package.json's "predev").
// nodemon on Windows can leave the old `node server.js` child running after
// a crash/kill — it isn't in the same process group, so it survives and
// keeps the port held, making the next `npm run dev` fail with
// "Port XXXX is already in use" every single time until someone manually
// finds and kills the PID. This finds and kills whatever (if anything) is
// already listening on our own PORT before nodemon ever tries to bind it,
// so that never happens again.
require('dotenv').config();
const { execSync } = require('child_process');

const PORT = process.env.PORT || 5010;

function freeWindowsPort(port) {
  let out;
  try {
    out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
  } catch (_) {
    return; // nothing listening — normal case, nothing to do
  }
  const pids = new Set();
  for (const line of out.trim().split('\n')) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && pid !== '0') pids.add(pid);
  }
  for (const pid of pids) {
    // Never kill ourselves, however unlikely.
    if (Number(pid) === process.pid) continue;
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      console.log(`[free-port] Killed stale process ${pid} that was holding port ${port}.`);
    } catch (_) {
      // Already gone, or no permission — either way, let nodemon's own
      // "port already in use" error surface normally if it still fails.
    }
  }
}

if (process.platform === 'win32') {
  freeWindowsPort(PORT);
}
