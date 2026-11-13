import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { scrapeSush } from './server/scrape-sush.js';
import { openConsole } from './terminal.mjs';

async function main() {
  const { values: { quarter, help } } = parseArgs({
    options: { quarter: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (help) {
    stdout.write('node sush-import.mjs [--quarter 1–4]\n');
    return;
  }
  if (quarter !== undefined && !/^[1-4]$/.test(quarter)) throw new Error('Укажите четверть от 1 до 4.');
  const ui = openConsole();
  let result;
  let menuWaitMs = 0;
  const choose = async (...args) => {
    const started = performance.now();
    const value = await ui.choose(...args);
    menuWaitMs += performance.now() - started;
    return value;
  };
  try {
    const iin = (await ui.ask('ИИН СУШ НИШ: ')).trim();
    if (!/^\d{12}$/.test(iin)) throw new Error('ИИН должен содержать 12 цифр.');
    const password = await ui.askPassword();
    if (!password) throw new Error('Введите пароль СУШ НИШ.');
    let lastProgress = -10;
    result = await scrapeSush({
      iin,
      password,
      ...(quarter ? { mode: 'view_refresh', targetView: `quarter${quarter}` } : {
        async chooseScope(years, getQuarterViews) {
          const yearOptions = years.map(year => ({ label: year.Name, year }));
          const all = 'Все доступные годы';
          const selected = await choose('Учебный год', [...yearOptions.map(option => option.label), all]);
          if (selected === all) return {};
          const { year } = yearOptions.find(option => option.label === selected);
          const views = [
            ...await getQuarterViews(year),
            { view: 'year', label: 'Весь учебный год: четверти и табель' },
            { view: 'report', label: 'Табель' },
          ];
          const label = await choose('Что выгрузить', views.map(option => option.label), views.find(option => option.view === 'year').label);
          return { yearId: year.Id, view: views.find(option => option.label === label).view };
        },
      }),
      onProgress({ progress, status }) {
        if (progress < lastProgress + 10) return;
        lastProgress = progress;
        stdout.write(`${progress}% ${status}\n`);
      },
    });
    if (!result.success) {
      if (result.captchaRequired) throw new Error('СУШ запросил CAPTCHA для этого входа.');
      const message = result.message ?? 'СУШ не вернул данные.';
      throw new Error(message.replaceAll(iin, '[ИИН]').replaceAll(password, '[пароль]'));
    }
  } finally {
    ui.close();
  }

  const data = result.patch?.year ?? result.grades;
  const scope = result.patch?.targetView.replace('quarter', 'q') ?? 'full';
  const folder = new URL('./exports/', import.meta.url);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = new URL(`sush_${scope}_${timestamp}.json`, folder);
  const temporary = new URL(`${randomUUID()}.tmp`, folder);
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  const seconds = Math.max(0, result.debug.durationMs - menuWaitMs) / 1000;
  stdout.write(`\nВремя импорта: ${seconds.toFixed(1)} с\n`);
  stdout.write(`Файл JSON: ${fileURLToPath(destination)}\n`);
}

try {
  await main();
} catch (error) {
  console.error(error.name === 'AbortError' ? 'Выгрузка отменена.' : `Ошибка: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
}
