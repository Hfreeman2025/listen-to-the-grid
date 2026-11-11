// npm run deploy: the piece, built, gated and deployed to its Cloudflare Pages project, production branch.
//   1. installs the pinned wrangler (tools/deploy, its own lockfile) if it is not there;
//   2. refuses a working tree with uncommitted changes, so what goes out is a commit;
//   3. builds (npm run build) and runs the gate (npm run check:predeploy);
//   4. asks wrangler who it is logged in as, and refuses unless the email is exactly hosting.config.json's
//      account and it has exactly one Cloudflare account, which it prints;
//   5. refuses unless the Pages project in hosting.config.json exists. It never creates one: the project was
//      created once as a classic Pages project, and wrangler hands a new one to Workers unless forced;
//   6. deploys dist/ to it on branch main (production) and prints the URLs.
// wrangler's telemetry is off for every call.
//
//   npm run deploy               all of it
//   npm run deploy -- --check    1 to 5; deploys nothing
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadHosting, root } from './hosting/load.mjs';

const check = process.argv.includes('--check');
const tools = join(root, 'tools/deploy');
const wranglerBin = join(tools, 'node_modules/.bin/wrangler');
let env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

const stop = (message) => {
  console.error(`deploy: ${message}`);
  process.exit(1);
};
const npm = (...args) => {
  if (spawnSync('npm', args, { cwd: root, stdio: 'inherit' }).status !== 0) stop(`npm ${args.join(' ')} failed; nothing was deployed`);
};
const wrangler = (args, { inherit = false } = {}) => {
  const r = spawnSync(wranglerBin, args, { cwd: root, env, encoding: 'utf8', stdio: inherit ? ['ignore', 'pipe', 'inherit'] : 'pipe' });
  if (inherit && r.stdout) process.stdout.write(r.stdout);
  return r;
};
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

if (!existsSync(wranglerBin)) {
  console.log('deploy: installing the pinned wrangler into tools/deploy');
  if (spawnSync('npm', ['ci', '--ignore-scripts', '--no-fund', '--no-audit'], { cwd: tools, stdio: 'inherit' }).status !== 0)
    stop('could not install wrangler');
}
console.log(`deploy: wrangler ${wrangler(['--version']).stdout?.trim()}`);

const dirty = git('status', '--porcelain');
if (dirty && !check) stop('the working tree has uncommitted changes; commit them first, so what is deployed is a commit');
if (dirty) console.log('deploy: (the working tree has uncommitted changes; a real deploy would refuse)');
const commit = git('rev-parse', 'HEAD');

npm('run', 'build');
npm('run', 'check:predeploy');

const { hosting, wrangler: rules } = await loadHosting();
let account;
try {
  account = rules.allowedAccount(wrangler(['whoami', '--json']).stdout ?? '', hosting.account);
} catch (error) {
  stop(error instanceof Error ? error.message : String(error));
}
console.log(`deploy: Cloudflare account “${account.name}” (${account.id}), logged in as ${account.email}`);
env = { ...env, CLOUDFLARE_ACCOUNT_ID: account.id };

const list = wrangler(['pages', 'project', 'list', '--json']);
if (list.status !== 0) stop(`could not list Pages projects: ${list.stderr}`);
if (!rules.projectNames(list.stdout).includes(hosting.project))
  stop(`the Pages project ${hosting.project} does not exist; this script never creates one (README, Hosting)`);
console.log(`deploy: Pages project ${hosting.project} exists`);
if (check) {
  console.log('deploy: --check: built, gated, the account and the project checked; nothing was deployed');
  process.exit(0);
}

const deployed = wrangler(
  [
    'pages',
    'deploy',
    'dist',
    '--project-name',
    hosting.project,
    '--branch',
    hosting.branch,
    '--commit-hash',
    commit,
    '--commit-message',
    git('log', '-1', '--format=%s'),
    '--commit-dirty=false',
  ],
  { inherit: true },
);
if (deployed.status !== 0) stop('wrangler pages deploy failed');
console.log(`deploy: ${commit.slice(0, 7)} is live on production`);
console.log(`  this deployment: ${rules.deploymentUrl(deployed.stdout ?? '') ?? '(see wrangler’s output above)'}`);
console.log(`  production:      https://${hosting.project}.pages.dev`);
console.log(`  custom domain:   ${hosting.origin} (once attached: Pages → ${hosting.project} → Custom domains)`);
console.log(`  indexing:        ${hosting.SITE_INDEXABLE ? 'on' : 'off (noindex, nofollow; robots.txt disallows all)'}`);
