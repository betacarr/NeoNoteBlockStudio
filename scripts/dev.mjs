import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import './build-electron.mjs';

const server = await createServer();
await server.listen();
server.printUrls();
const launchEnvironment = { ...process.env, NBSX_DEV_URL: server.resolvedUrls.local[0] };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;
const desktop = spawn(electron, ['.'], { env: launchEnvironment, stdio: 'inherit', windowsHide: true });
desktop.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => { desktop.kill(); });
