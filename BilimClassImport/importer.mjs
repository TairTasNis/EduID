import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { BilimClass, launchBrowser } from './bilimclass.mjs';

function openConsole() {
  let hideInput = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (hideInput) callback();
      else stdout.write(chunk, encoding, callback);
    },
  });
  const reader = createInterface({ input: stdin, output, terminal: true });
  const cancellation = new AbortController();
  reader.once('close', () => cancellation.abort());
  const ask = prompt => reader.question(prompt, { signal: cancellation.signal });

  return {
    ask,
    async askPassword() {
      stdout.write('Пароль (ввод скрыт): ');
      hideInput = true;
      try {
        return await ask('');
      } finally {
        hideInput = false;
        stdout.write('\n');
      }
    },
    async choose(prompt, labels, current) {
      if (!labels.length) throw new Error(`Список «${prompt}» пуст.`);
      const defaultIndex = Math.max(0, labels.indexOf(current));
      stdout.write(`\n${prompt}\n`);
      labels.forEach((label, index) => stdout.write(`  ${index + 1}. ${label}\n`));
      while (true) {
        const answer = (await ask(`Выберите номер [${defaultIndex + 1}]: `)).trim();
        if (!answer) return labels[defaultIndex];
        const index = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
        if (index >= 0 && index < labels.length) return labels[index];
        stdout.write(`Введите номер от 1 до ${labels.length}.\n`);
      }
    },
    close: () => reader.close(),
  };
}

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
    browser = await launchBrowser(process.argv.includes('--visible'));
    const context = await browser.newContext();
    const bilimclass = new BilimClass(await context.newPage());
    await bilimclass.login(username, password);
    const data = await bilimclass.importGrades(ui.choose);
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
