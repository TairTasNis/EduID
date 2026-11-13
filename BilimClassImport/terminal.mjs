import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export function openConsole() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Запустите утилиту в интерактивной консоли.');

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
