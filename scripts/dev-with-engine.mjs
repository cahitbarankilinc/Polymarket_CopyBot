#!/usr/bin/env node

import { spawn } from 'node:child_process';

const cwd = process.cwd();
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

let viteProcess = null;
let engineProcess = null;
let shuttingDown = false;

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
  engineProcess.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown(code);
    }
  });
};

const startVite = () => {
  viteProcess = spawn(npmCmd, ['run', 'dev:vite'], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  viteProcess.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0);
    }
  });
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

startTrackerEngine();
startVite();
