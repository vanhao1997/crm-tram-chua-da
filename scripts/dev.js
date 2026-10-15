import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const serverProc = spawn(npmCmd, ['run', 'dev:server'], {
  stdio: 'inherit',
  shell: isWin,
});

const clientProc = spawn(npmCmd, ['run', 'dev:client'], {
  stdio: 'inherit',
  shell: isWin,
});

function cleanup() {
  if (!serverProc.killed) serverProc.kill();
  if (!clientProc.killed) clientProc.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
