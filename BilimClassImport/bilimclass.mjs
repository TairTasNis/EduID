import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const origin = 'https://www.bilimclass.kz';
const summaryPath = /^\/(\d{4})\/summary-estimates\/?$/;
const timeout = 20_000;

function loadsGrades(request) {
  if (!['xhr', 'fetch'].includes(request.resourceType())) return false;
  const url = new URL(request.url());
  if (url.hostname === 'api.bilimclass.kz') {
    return /^\/api\/v\d+\/os\/clientoffice\/(?:diary\/(?:subjects|periods)|group-list)\/?$/.test(url.pathname);
  }
  return ['journal-service.bilimclass.kz', 'journal-service-past.bilimclass.kz'].includes(url.hostname)
    && /^\/diary\/quarter\/?$/.test(url.pathname);
}

export async function launchBrowser(visible = false) {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: !visible });
    } catch {
      // Try the other installed browser if this one cannot start.
    }
  }
  throw new Error('Не удалось запустить Microsoft Edge или Google Chrome.');
}

export class BilimClass {
  constructor(page) {
    this.page = page;
    page.setDefaultTimeout(timeout);
    this.yearToggle = page.locator('.v-set-year-global__select-wrap');
    this.selectedYear = this.yearToggle.locator('.v-set-year-global__year');
    this.yearOptions = page.locator('.v-set-year-global__options-item .v-set-year-global__year:visible');
    this.filters = page.locator('[role=combobox]:has(input.vs__search):visible');
    this.table = page.locator('table.v-adp-table:visible');

    this.gradeRequests = new Set();
    this.lastGradeActivity = 0;
    this.gradeRequestFailed = false;
    page.on('request', request => {
      if (!loadsGrades(request)) return;
      this.gradeRequests.add(request);
      this.lastGradeActivity = performance.now();
    });
    const finish = request => {
      if (!this.gradeRequests.delete(request)) return;
      this.lastGradeActivity = performance.now();
      const failure = request.failure()?.errorText;
      if (failure && failure !== 'net::ERR_ABORTED') this.gradeRequestFailed = true;
    };
    page.on('requestfinished', finish);
    page.on('requestfailed', finish);
    page.on('response', response => {
      if (this.gradeRequests.has(response.request()) && response.status() >= 400) {
        this.gradeRequestFailed = true;
      }
    });
  }

  async waitForGrades() {
    // The site updates its selection before the replacement table has loaded.
    const started = performance.now();
    while (performance.now() - started < timeout) {
      const idleFor = performance.now() - Math.max(started, this.lastGradeActivity);
      if (!this.gradeRequests.size && idleFor >= 450) {
        if (this.gradeRequestFailed) throw new Error('BilimClass вернул ошибку при загрузке оценок. Повторите выгрузку.');
        return;
      }
      await delay(50);
    }
    throw new Error('BilimClass не успел загрузить оценки. Повторите выгрузку.');
  }

  async login(username, password) {
    const page = this.page;
    const dateParts = new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Oral', year: 'numeric', month: 'numeric',
    }).formatToParts(new Date());
    const calendarYear = Number(dateParts.find(part => part.type === 'year').value);
    const month = Number(dateParts.find(part => part.type === 'month').value);
    const year = calendarYear - (month < 9 ? 1 : 0);
    const gradesUrl = `${origin}/${year}/summary-estimates?type=current`;
    const passwordField = page.locator('input[type=password]:visible');
    try {
      await page.goto(gradesUrl, { waitUntil: 'domcontentloaded' });
      await passwordField.or(this.selectedYear).first().waitFor();
    } catch {
      throw new Error('Страница входа BilimClass не загрузилась. Проверьте интернет и доступность сайта.');
    }

    if (await passwordField.isVisible()) {
      if (new URL(page.url()).origin !== origin || new URL(page.url()).pathname !== '/login') {
        throw new Error('BilimClass открыл неизвестную страницу входа.');
      }
      try {
        await page.locator('input[type=text]:visible').fill(username);
        await passwordField.fill(password);
        await page.getByRole('button', { name: /^(?:Войти|Кіру)$/iu }).click();
        await page.waitForURL(url => url.origin === origin && url.pathname !== '/login', { timeout });
      } catch {
        throw new Error('BilimClass не завершил вход. Проверьте логин и пароль, затем попробуйте снова.');
      }
    }

    if (!summaryPath.test(new URL(page.url()).pathname)) {
      await page.goto(gradesUrl, { waitUntil: 'domcontentloaded' });
    }
    try {
      await this.selectedYear.waitFor();
      await this.filters.nth(1).waitFor();
    } catch {
      throw new Error('Сводные оценки недоступны для этого аккаунта или учебного года.');
    }
  }

  async chooseYear(choose) {
    const current = await this.selectedYear.innerText();
    const invitation = this.page.locator('[data-gl-modal-window=VParentsAddModalWindow]:visible');
    await invitation.waitFor({ timeout: 1500 }).catch(() => {});
    if (await invitation.isVisible()) {
      await invitation.locator('.gl-modal-window__close').click();
      await invitation.waitFor({ state: 'hidden' });
    }
    await this.yearToggle.click();
    await this.yearOptions.first().waitFor();
    const years = (await this.yearOptions.allInnerTexts()).map(label => label.trim());
    await this.yearToggle.click();
    const year = await choose('Учебный год', years, current.trim());
    if (year !== current.trim()) {
      await this.yearToggle.click();
      await this.yearOptions.and(this.page.getByText(year, { exact: true })).click();
      const startYear = year.match(/^\d{4}/)?.[0];
      await this.page.waitForURL(url => url.origin === origin && summaryPath.exec(url.pathname)?.[1] === startYear);
      await this.selectedYear.and(this.page.getByText(year, { exact: true })).waitFor();
    }
    return year;
  }

  async openFilter(box, prompt) {
    const input = box.locator('input.vs__search');

    // The open list can be moved outside the selector. A class change can replace its ID.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await box.getAttribute('aria-expanded') !== 'true') {
        await input.blur();
        await input.focus();
      }
      const listId = await box.getAttribute('aria-owns');
      const list = this.page.locator(`[role=listbox][id=${JSON.stringify(listId ?? '')}]`);
      try {
        await list.getByRole('option').first().waitFor({ timeout: 1800 });
        return list;
      } catch {
        continue;
      }
    }
    throw new Error(`BilimClass не открыл список «${prompt}».`);
  }

  async chooseFilter(index, prompt, choose) {
    const box = this.filters.nth(index);
    const selected = box.locator('.vs__selected');
    const current = (await selected.innerText()).trim();
    const list = await this.openFilter(box, prompt);
    const labels = (await list.getByRole('option').allInnerTexts()).map(label => label.trim());
    await box.locator('input.vs__search').blur();
    const label = await choose(prompt, labels, current);

    if (label !== (await selected.innerText()).trim()) {
      const activeList = await this.openFilter(box, prompt);
      // The menu is rendered in a portal that can overlap the header in a background browser.
      await activeList.getByRole('option', { name: label, exact: true }).dispatchEvent('click');
      await selected.and(this.page.getByText(label, { exact: true })).waitFor();
    }
    return label;
  }

  async importGrades(choose) {
    const academicYear = await this.chooseYear(choose);
    await this.waitForGrades();
    const className = await this.chooseFilter(0, 'Класс', choose);
    await this.waitForGrades();
    const quarterLabel = await this.chooseFilter(1, 'Четверть', choose);
    const quarter = Number(quarterLabel.match(/\b[1-4]\b/)?.[0]);
    if (!quarter) throw new Error('Не удалось определить номер выбранной четверти.');

    await this.waitForGrades();
    await this.table.locator('thead th').nth(7).waitFor();
    await this.table.locator('tbody').first().waitFor({ state: 'attached' });
    const subjects = await this.table.evaluate(parseGrades);
    return {
      schemaVersion: 2,
      source: { name: 'BilimClass', url: this.page.url() },
      academicYear,
      class: className,
      quarter,
      exportedAt: new Date().toISOString(),
      subjects,
    };
  }
}

export function parseGrades(table) {
  const clean = value => value.trim().replace(/\s+/g, ' ');
  const parseValue = value => {
    const text = clean(value);
    if (!text || /^[-–—]$/.test(text)) return null;
    if (/^\d+(?:[.,]\d+)?\s*%?$/.test(text)) return Number(text.replace('%', '').replace(',', '.'));
    return text;
  };
  const parseMark = (value, label = '') => {
    const text = clean(value);
    const type = clean(label) || null;
    const fraction = /^([^/]+)\/\s*(\d+(?:[.,]\d+)?)$/.exec(text);
    const points = parseValue(fraction ? fraction[1] : text);
    const max = fraction ? parseValue(fraction[2]) : null;
    let kind = 'other';
    if (/^(?:БЖБ|СОР)(?:\s|$)/iu.test(type ?? '')) kind = 'sor';
    else if (/^(?:ТЖБ|СОЧ)(?:\s|$)/iu.test(type ?? '')) kind = 'soch';
    else if (/^(?:ФБ|ФО)$/iu.test(type ?? '') || (!type && max === null && typeof points === 'number')) kind = 'formative';
    return {
      type,
      kind,
      value: points,
      max,
      percent: typeof points === 'number' && max > 0 ? Number((100 * points / max).toFixed(2)) : null,
    };
  };

  const headers = [...table.tHead.rows[0].cells].map(cell => clean(cell.innerText));
  if (headers.length !== 8 || headers[0] !== '№' || !/^(?:Пән|Предмет)$/iu.test(headers[1])) {
    throw new Error('BilimClass изменил структуру таблицы оценок.');
  }
  const rows = [...table.tBodies].flatMap(body => [...body.rows]);
  if (rows.length === 1 && rows[0].cells.length === 1 && rows[0].cells[0].colSpan === headers.length) {
    if (/нет данных|нет предметов|данные отсутствуют|деректер жоқ|мәліметтер жоқ|пәндер жоқ|no data/iu.test(rows[0].cells[0].innerText)) {
      return [];
    }
    throw new Error('BilimClass не показал данные за выбранную четверть.');
  }
  return rows.map(row => {
    const cells = [...row.cells];
    if (cells.length !== headers.length || !/^\d+$/.test(clean(cells[0].innerText)) || !clean(cells[1].innerText)) {
      throw new Error('BilimClass изменил структуру строки оценок.');
    }
    const marks = [...cells[2].querySelectorAll('.flex-wrap > div')].map(chip => {
      const value = chip.querySelector(':scope > span');
      const label = chip.querySelector(':scope > div');
      return parseMark(value?.innerText ?? chip.innerText, label?.innerText);
    });
    if (!marks.length && parseValue(cells[2].innerText) !== null) {
      throw new Error('BilimClass изменил формат отдельных оценок.');
    }
    const formativePercent = parseValue(cells[3].innerText);
    const sorPercent = parseValue(cells[4].innerText);
    const sochPercent = parseValue(cells[5].innerText);
    // The site has already applied the weights for this subject and period.
    const contributions = [formativePercent, sorPercent, sochPercent].filter(value => typeof value === 'number');
    const totalPercent = contributions.length ? Number(contributions.reduce((sum, value) => sum + value, 0).toFixed(2)) : null;
    return {
      subject: clean(cells[1].innerText),
      marks,
      formativePercent,
      sorPercent,
      sochPercent,
      totalPercent,
      predictedGrade: parseValue(cells[6].innerText),
      finalGrade: parseValue(cells[7].innerText),
    };
  });
}
