// Desktop dev loop: Vite dev server for the UI + esbuild watch for main/preload/paginator + Electron.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';

const run = (args) => spawn(process.execPath, args, { stdio: 'inherit' });

run(['scripts/build-inject.mjs', '--watch']);
await new Promise((resolve) => run(['scripts/build-electron.mjs']).on('exit', resolve));
run(['scripts/build-electron.mjs', '--watch']);

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`UI dev server: ${url}`);

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: url },
});
electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
