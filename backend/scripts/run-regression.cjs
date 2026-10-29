const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const backend = path.resolve(__dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ims-synthetic-'));
fs.chmodSync(folder, 0o700);
const url = 'postgresql://ims_test@127.0.0.1:55439/ims_synthetic_test';
let started = false;
function run(command, args, options = {}) {
  const result = cp.spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed. No existing database will be used as a fallback.`);
}
try {
  console.log(`Creating a new synthetic PostgreSQL cluster at ${folder}; no production connection is used.`);
  run('initdb', ['-D', folder + '/data', '-A', 'trust', '-U', 'ims_test', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', folder + '/data', '-l', folder + '/postgres.log', '-o', `-p 55439 -h 127.0.0.1 -k ${folder}`, '-w', 'start']);
  started = true;
  run('createdb', ['-h', '127.0.0.1', '-p', '55439', '-U', 'ims_test', 'ims_synthetic_test']);
  // Copy only the schema so Prisma cannot discover repository .env files.
  fs.copyFileSync(backend + '/prisma/schema.prisma', folder + '/schema.prisma');
  run(process.execPath, [backend + '/node_modules/prisma/build/index.js', 'db', 'push', '--schema', folder + '/schema.prisma', '--skip-generate'], {
    cwd: folder, env: { ...process.env, DATABASE_URL: url },
  });
  const tests = fs.readdirSync(backend + '/tests').filter(file => file.endsWith('.test.cjs')).map(file => backend + '/tests/' + file);
  run(process.execPath, ['--test', ...tests], { cwd: backend, env: { ...process.env,
    IMS_TEST_DATABASE_URL: url, DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/no_production_access',
  } });
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (started) {
    const stopped = cp.spawnSync('pg_ctl', ['-D', folder + '/data', '-m', 'fast', '-w', 'stop'], { encoding: 'utf8' });
    if (stopped.status !== 0) { console.error(`Synthetic cluster needs manual shutdown: ${folder}`); process.exitCode = 1; }
  }
  console.log(`Synthetic files retained for inspection at ${folder}. No existing database or environment file was modified.`);
}
