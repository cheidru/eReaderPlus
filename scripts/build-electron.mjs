// Bundles the Electron main process and preload script.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};
const configs = [
  { ...common, entryPoints: ['electron/main.ts'], outfile: 'dist/electron/main.cjs' },
  // Sandboxed preload: everything bundled, only `electron` is required at runtime.
  { ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist/electron/preload.cjs' },
];
if (watch) {
  for (const config of configs) await (await context(config)).watch();
} else {
  await Promise.all(configs.map((config) => build(config)));
}
