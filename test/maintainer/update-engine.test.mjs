import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { enginePlan, nextAppVersion } from '../../scripts/engine-update-plan.mjs';
import { parseOptions, runCommand, updateEngine } from '../../scripts/update-engine.mjs';
import { checkEnginePrs } from '../../scripts/check-engine-prs.mjs';

const feed = [
  { version: '44.5.1', chrome: '152.0.7977.130' },
  { version: '44.5.2', chrome: '152.0.7977.130' },
  { version: '45.0.0-beta.1', chrome: '156.0.0.0' },
];

// Real Git repositories and real child processes, with a tiny offline npm stand-in.
// This exercises branch/worktree handling and failure paths without downloading or upgrading anything.
async function fixture(t, failAt = '') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ereader-engine-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const cwd = path.join(root, 'repo');
  await mkdir(cwd);
  const pkg = { name: 'fixture', version: '0.1.21', devDependencies: { electron: '^44.5.1' } };
  const lock = { version: pkg.version, packages: { '': structuredClone(pkg), 'node_modules/electron': { version: '44.5.1' } } };
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify(pkg));
  await writeFile(path.join(cwd, 'package-lock.json'), JSON.stringify(lock));
  const git = (...args) => runCommand('git', args, { cwd, capture: true });
  await git('init', '-b', 'main');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'user.name', 'Engine test');
  await git('config', 'commit.gpgsign', 'false');
  await git('add', 'package.json', 'package-lock.json');
  await git('commit', '-m', 'fixture');
  await git('tag', 'v0.1.22');
  await git('remote', 'add', 'origin', cwd);
  const npmPath = path.join(root, 'npm.mjs');
  await writeFile(npmPath, `
    import fs from 'node:fs';
    const args = process.argv.slice(2);
    fs.appendFileSync('.git/npm-calls', JSON.stringify(args) + '\\n');
    if (args.join(' ') === ${JSON.stringify(failAt)}) process.exit(42);
    const pkg = JSON.parse(fs.readFileSync('package.json'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json'));
    if (args[0] === 'install') {
      const version = args.at(-1).slice('electron@'.length);
      pkg.devDependencies.electron = version;
      lock.packages[''].devDependencies.electron = version;
      lock.packages['node_modules/electron'].version = version;
    }
    if (args[0] === 'version') pkg.version = lock.version = lock.packages[''].version = args[1];
    fs.writeFileSync('package.json', JSON.stringify(pkg));
    fs.writeFileSync('package-lock.json', JSON.stringify(lock));
  `);
  const env = { npm_execpath: npmPath };
  const run = (options = {}) => updateEngine({ cwd, env, fetchFeed: async () => feed, platform: 'win32', ...options });
  const calls = async () => (await readFile(path.join(cwd, '.git/npm-calls'), 'utf8')).trim().split('\n').map(JSON.parse);
  return { cwd, env, git, run, calls };
}

test('recognizes a patch with unchanged Chromium and rejects invalid feeds', () => {
  const lock = { packages: { 'node_modules/electron': { version: '44.5.1' } } };
  assert.equal(enginePlan(lock, feed).update.electron, '44.5.2');
  assert.throws(() => enginePlan({}, feed), /No Electron/);
  assert.throws(() => enginePlan(lock, {}), /not in the release feed/);
  assert.equal(enginePlan(lock, [feed[0]]).update, null);
  assert.equal(nextAppVersion('0.1.21', ['v0.1.22', 'v0.1.24-beta.1', 'v0.2.99']), '0.1.25');
  assert.throws(() => nextAppVersion('0.1.21-beta.1', []), /stable app version/);
  assert.throws(() => parseOptions(['--version=evil']), /Usage/);
  assert.throws(() => parseOptions(['--check', '--prepare-only']), /Usage/);
});

test('preview works with local edits; updating refuses them without switching branches', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.cwd, 'notes.txt'), 'keep this');
  assert.equal((await f.run({ options: { check: true } })).update.electron, '44.5.2');
  await assert.rejects(f.run(), /Working tree is not clean/);
  assert.equal(await f.git('branch', '--show-current'), 'main');
  assert.equal(await readFile(path.join(f.cwd, 'notes.txt'), 'utf8'), 'keep this');
  assert.equal((JSON.parse(await readFile(path.join(f.cwd, 'package.json'), 'utf8'))).version, '0.1.21');
});

test('local upgrade pins versions on a new branch, validates, and leaves changes uncommitted', async (t) => {
  const f = await fixture(t);
  const head = await f.git('rev-parse', 'HEAD');
  const result = await f.run();
  assert.equal(result.version, '0.1.23');
  assert.equal(await f.git('branch', '--show-current'), 'maintenance/electron-44.5.2');
  assert.equal(await f.git('rev-parse', 'HEAD'), head);
  assert.equal(await f.git('diff', '--cached', '--name-only'), '');
  assert.deepEqual((await f.git('diff', '--name-only')).split('\n').sort(), ['package-lock.json', 'package.json']);
  const calls = await f.calls();
  assert.deepEqual(calls[0], ['install', '--save-dev', '--save-exact', '--package-lock-only', '--ignore-scripts', 'electron@44.5.2']);
  assert.deepEqual(calls.slice(2), [['ci'], ['run', 'install:electron'], ['run', 'typecheck'], ['test'], ['run', 'test:e2e']]);
});

test('prepare-only creates package files and outputs for CI, without switching branches or running tests', async (t) => {
  const f = await fixture(t);
  const output = path.join(f.cwd, '.git/output');
  await f.run({ options: { prepareOnly: true }, env: { ...f.env, GITHUB_OUTPUT: output } });
  assert.equal(await f.git('branch', '--show-current'), 'main');
  assert.equal((await f.calls()).length, 2);
  assert.match(await readFile(output, 'utf8'), /changed=true\nelectron=44.5.2\nchrome=152.0.7977.130/);
  const lock = JSON.parse(await readFile(path.join(f.cwd, 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '0.1.23');
  assert.equal(lock.packages[''].devDependencies.electron, '44.5.2');
});

test('failed validation stops before E2E and leaves the update available for inspection', async (t) => {
  const f = await fixture(t, 'test');
  await assert.rejects(f.run(), /failed \(42\)/);
  assert.deepEqual((await f.calls()).at(-1), ['test']);
  assert.equal(await f.git('branch', '--show-current'), 'maintenance/electron-44.5.2');
  assert.equal(await f.git('log', '-1', '--format=%s'), 'fixture');
});

test('current engine is a no-op and emits changed=false', async (t) => {
  const f = await fixture(t);
  const output = path.join(f.cwd, '.git/output');
  await f.run({ fetchFeed: async () => [feed[0]], env: { ...f.env, GITHUB_OUTPUT: output } });
  assert.equal(await f.git('status', '--porcelain'), '');
  assert.equal(await f.git('branch', '--show-current'), 'main');
  assert.equal(await readFile(output, 'utf8'), 'changed=false\n');
});

test('duplicate guard detects lockfile-only Electron upgrades but allows unrelated Dependabot PRs', async () => {
  let headVersion = '44.5.1';
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => url.includes('/pulls?') ? [
      { user: { login: 'dependabot[bot]' }, base: { sha: 'base' }, head: { sha: 'head' }, html_url: 'https://github.com/example/repo/pull/1' },
    ] : { content: Buffer.from(JSON.stringify({ packages: { 'node_modules/electron': { version: url.endsWith('ref=head') ? headVersion : '44.5.1' } } })).toString('base64') },
  });
  await checkEnginePrs({ repo: 'example/repo', token: 'test', fetchImpl });
  headVersion = '44.5.2';
  await assert.rejects(checkEnginePrs({ repo: 'example/repo', token: 'test', fetchImpl }), /existing Dependabot PR.*pull\/1/);
});
