import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { importBilimClass } from './bilimclass.mjs';
import { openConsole } from './terminal.mjs';

async function saveGrades(data) {
  const folder = fileURLToPath(new URL('./exports/', import.meta.url));
  await mkdir(folder, { recursive: true });
  const className = data.class.replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 64);
  const year = data.academicYear.replace(/[^\d-]/g, '-');
  const timestamp = data.exportedAt.replace(/[:.]/g, '-');
  const path = join(folder, `bilimclass_${year}_${className}_q${data.quarter}_${timestamp}.json`);
  const temp = join(folder, `${randomUUID()}.tmp`);
  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  return path;
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Запустите утилиту в интерактивной консоли.');
  const ui = openConsole();
  let browser;
  try {
    stdout.write('BilimClass Importer\n\n');
    const username = (await ui.ask('Логин BilimClass: ')).trim();
    const password = await ui.askPassword();
    if (!username || !password) throw new Error('Введите логин и пароль BilimClass.');
    stdout.write('Подключаюсь к BilimClass…\n');
    const account = { login: username, password };
    const profile = await importBilimClass({ ...account, mode: 'profile' });
    const years = profile.years.map(year => year + '–' + (Number(year) + 1));
    const year = (await ui.choose('Учебный год', years)).slice(0, 4);
    const options = await importBilimClass({ ...account, year, mode: 'options' });
    const className = await ui.choose('Класс', options.classes, options.currentClass);
    const quarter = Number(await ui.choose('Четверть', options.quarters.map(String), String(options.currentQuarter)));
    const data = await importBilimClass({ ...account, year, class: className, quarter });
    const path = await saveGrades(data);
    stdout.write(`\nПредметов: ${data.subjects.length}\nФайл JSON: ${path}\n`);
  } finally {
    ui.close();
    await browser?.close();
  }
}

try {
  await main();
} catch (error) {
  if (error.name === 'AbortError') {
    console.error('\nВыгрузка отменена.');
  } else {
    const message = error.message.split('\n')[0];
    console.error(`\nОшибка: ${message}`);
  }
  process.exitCode = 1;
}
