// Maintainer command: prepare an exact Electron upgrade, then validate it locally.
// --check is read-only. --prepare-only is for the workflow's subsequent OS matrix.
import { spawn } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enginePlan, fetchEngineFeed, nextAppVersion } from './engine-update-plan.mjs';

export function runCommand(command, args, { cwd, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true });
    let output = '';
    let error = '';
    child.stdout?.on('data', (data) => { output += data; });
    child.stderr?.on('data', (data) => { error += data; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} ${args.join(' ')} failed (${code})${error ? `: ${error.trim()}` : ''}`)));
  });
}

export function parseOptions(args) {
  const allowed = new Set(['--check', '--prepare-only', '--help']);
  if (args.some((arg) => !allowed.has(arg)) || (args.includes('--check') && args.includes('--prepare-only'))) {
    throw new Error('Usage: npm run update:engine -- [--check | --prepare-only | --help]');
  }
  return { check: args.includes('--check'), prepareOnly: args.includes('--prepare-only'), help: args.includes('--help') };
}

export async function updateEngine({
  cwd = fileURLToPath(new URL('../', import.meta.url)), options = {},
  fetchFeed = fetchEngineFeed, run = runCommand, env = process.env, platform = process.platform,
} = {}) {
  const git = (...args) => run('git', args, { cwd, capture: true });
  // Refuse even unrelated local changes: the command switches branches and updates the dependency tree.
  if (!options.check && await git('status', '--porcelain')) {
    throw new Error('Working tree is not clean. Commit or stash your changes first, or use --check for a read-only preview.');
  }
  const packagePath = path.join(cwd, 'package.json');
  const lockPath = path.join(cwd, 'package-lock.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) throw new Error('App versions in package.json and package-lock.json differ');
  const plan = enginePlan(lock, await fetchFeed());
  console.log(`Current: Electron ${plan.current.electron}, Chromium ${plan.current.chrome}`);
  console.log(`Latest stable: Electron ${plan.latest.electron}, Chromium ${plan.latest.chrome}`);
  if (options.check) return plan;
  if (!plan.update) {
    console.log('No newer compatible stable engine. Nothing changed.');
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, 'changed=false\n');
    return plan;
  }
  if (!env.npm_execpath) throw new Error('Run this command through npm: npm run update:engine');
  const npm = (...args) => run(process.execPath, [env.npm_execpath, ...args], { cwd });
  const localTags = (await git('tag', '--list')).split('\n');
  const remoteTags = (await git('ls-remote', '--tags', 'origin')).split('\n').map((line) => line.split('refs/tags/')[1] ?? '');
  const version = nextAppVersion(pkg.version, [...localTags, ...remoteTags]);
  const electron = plan.update.electron;
  // Both values go into commands, branch names and workflow outputs: accept only plain numeric versions.
  if (!/^\d+\.\d+\.\d+$/.test(electron)) throw new Error(`Invalid stable Electron version: ${electron}`);
  const branch = `maintenance/electron-${electron}`;
  if (!options.prepareOnly) await git('switch', '-c', branch);
  console.log(`Preparing eReaderPlus ${version} with Electron ${electron}`);
  await npm('install', '--save-dev', '--save-exact', '--package-lock-only', '--ignore-scripts', `electron@${electron}`);
  await npm('version', version, '--no-git-tag-version', '--ignore-scripts');
  const updated = JSON.parse(await readFile(packagePath, 'utf8'));
  const updatedLock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (updated.devDependencies?.electron !== electron || updatedLock.packages?.['node_modules/electron']?.version !== electron ||
      updated.version !== version || updatedLock.version !== version || updatedLock.packages?.['']?.version !== version) {
    throw new Error('npm did not produce the requested engine and app versions; inspect package.json and package-lock.json');
  }
  if (!options.prepareOnly) {
    await npm('ci');
    await npm('run', 'install:electron');
    await npm('run', 'typecheck');
    await npm('test');
    if (platform === 'linux' && !env.DISPLAY) {
      await run('xvfb-run', ['-a', process.execPath, env.npm_execpath, 'run', 'test:e2e'], { cwd });
    } else {
      await npm('run', 'test:e2e');
    }
    console.log(`Validated on ${platform}. Review package.json and package-lock.json on ${branch}; nothing was committed, pushed, or published.`);
    console.log('To make a local test installer: npm run dist:win (or dist:mac / dist:linux).');
  }
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `changed=true\nelectron=${electron}\nchrome=${plan.update.chrome}\ncurrent_electron=${plan.current.electron}\ncurrent_chrome=${plan.current.chrome}\napp_version=${version}\n`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, `Prepared eReaderPlus **${version}**: Electron **${plan.current.electron} → ${electron}**, Chromium **${plan.current.chrome} → ${plan.update.chrome}**.\n`);
  }
  return { ...plan, version, branch };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('npm run update:engine: prepare and test on a new local branch.\n--check: read-only preview.\n--prepare-only: change only package files; validation must follow in CI.\nRequires Node 24+, npm, Git, origin, and a clean working tree.');
    else await updateEngine({ options });
  } catch (error) {
    console.error(`Engine update stopped: ${error.message}\nAny prepared changes are left for inspection; nothing was committed or pushed.`);
    process.exitCode = 1;
  }
}
