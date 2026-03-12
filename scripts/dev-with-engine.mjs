#!/usr/bin/env node

import { spawn } from 'node:child_process';

const cwd = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

let viteProcess = null;
let engineProcess = null;
let shuttingDown = false;
const RESTART_DELAY_MS = 1000;

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  if (engineProcess && !engineProcess.killed) {
    engineProcess.kill('SIGTERM');
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill('SIGTERM');
  }

  setTimeout(() => process.exit(code), 200);
};

const startTrackerEngine = () => {
  engineProcess = spawn(nodeCmd, ['./scripts/tracker-engine.mjs'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  engineProcess.on('exit', (code, signal) => {
    engineProcess = null;
    if (shuttingDown) return;
    console.error(`[tracker-engine] exited (code=${code ?? 'null'} signal=${signal ?? 'none'}), restarting...`);
    setTimeout(() => {
      if (!shuttingDown) startTrackerEngine();
    }, RESTART_DELAY_MS);
  });
};

const startVite = () => {
  viteProcess = spawn(npmCmd, ['run', 'dev:vite'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  viteProcess.on('exit', (code, signal) => {
    viteProcess = null;
    if (shuttingDown) return;
    console.error(`[vite] exited (code=${code ?? 'null'} signal=${signal ?? 'none'}), restarting...`);
    setTimeout(() => {
      if (!shuttingDown) startVite();
    }, RESTART_DELAY_MS);
  });
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startTrackerEngine();
startVite();
