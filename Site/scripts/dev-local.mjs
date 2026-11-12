import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const local = join(project, '.eduid-local');
const exportPath = '.eduid-local/firebase';

async function localIdKey() {
  await mkdir(local, { recursive: true, mode: 0o700 });
  const path = join(local, 'student-id-key');
  try {
    await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const key = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Не удалось прочитать ключ локальных аккаунтов EduID.');
  return key;
}

function run(args, env = process.env) {
  const runner = spawn(process.execPath, args, { cwd: project, env, stdio: 'inherit', windowsHide: true });
  runner.once('error', error => { console.error(error.message); process.exitCode = 1; });
  runner.once('exit', code => { process.exitCode = code ?? 1; });
}

async function startWeb() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('Эмуляторы Firebase не запущены. Используйте npm run dev:local.');
  }
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o',
    'ConnectTimeout=8', 'oci', 'sudo -n cat /etc/grade-api-ingress/api-key'], {
    encoding: 'utf8', timeout: 12_000, windowsHide: true,
  });
  const gradeKey = result.stdout?.trim();
  if (result.status !== 0 || !/^[a-f0-9]{64}$/.test(gradeKey ?? '')) {
    throw new Error('Не удалось получить доступ к Grade API. Проверьте подключение по SSH: ssh oci.');
  }

  const gradeCA = await readFile(join(project, 'certs', 'grade-api-ca.pem'), 'utf8');
  run(['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3000'], {
    ...process.env,
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
    EDUID_ID_HMAC_KEY: await localIdKey(),
    GRADE_API_URL: 'https://158.180.63.46:5091/v1/grades',
    GRADE_API_KEY: gradeKey,
    GRADE_API_CA_PEM: gradeCA,
  });
}

async function start() {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Запустите EduID командой npm run dev:local.');
  await mkdir(local, { recursive: true, mode: 0o700 });
  const saved = await stat(join(project, exportPath, 'firebase-export-metadata.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const flags = [`--export-on-exit=${exportPath}`];
  if (saved) flags.push(`--import=${exportPath}`);
  const cli = process.env.EDUID_FIREBASE_CLI_PATH;
  const executable = cli ? [cli] : [npm, 'exec', '--prefer-offline', '--yes', '--', 'firebase-tools'];
  run([...executable, 'emulators:exec', '--project', 'demo-eduid', '--only', 'auth,database,storage', ...flags,
    'node scripts/dev-local.mjs --web']);
}

(process.argv[2] === '--web' ? startWeb() : start())
  .catch(error => { console.error(error.message); process.exitCode = 1; });
