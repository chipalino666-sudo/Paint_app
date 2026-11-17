'use strict';

/*
 * Диагностика микрофона: проверяем КАЖДОЕ устройство ввода и показываем,
 * какое из них реально слышит звук.
 *
 *   node tools/patch-mic-devices.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8');

if (src.includes('diagCheckDevices')) {
  console.log('уже пропатчено');
  process.exit(0);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';

/* 1. Функция проверки всех устройств */
const block = [
  '  /** Проверяем все микрофоны по очереди: какой реально слышит. */',
  '  async function diagCheckDevices() {',
  '    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;',
  '',
  '    let devices = [];',
  '',
  '    try {',
  '      devices = (await navigator.mediaDevices.enumerateDevices())',
  '        .filter((device) => device.kind === \'audioinput\');',
  '    } catch (error) {',
  '      return;',
  '    }',
  '',
  '    if (!devices.length) {',
  '      diagLine(\'Система не сообщает ни одного микрофона.\');',
  '      return;',
  '    }',
  '',
  '    diagLine(\'Проверяю все микрофоны по очереди — говорите не переставая.\');',
  '',
  '    const results = [];',
  '',
  '    for (const device of devices.slice(0, 4)) {',
  '      let stream = null;',
  '',
  '      try {',
  '        stream = await navigator.mediaDevices.getUserMedia({',
  '          audio: device.deviceId ? { deviceId: { exact: device.deviceId } } : true',
  '        });',
  '',
  '        const peak = await measureMicLevel(stream, 1500);',
  '',
  '        results.push({ name: device.label || \'микрофон без названия\', peak });',
  '      } catch (error) {',
  '        results.push({ name: device.label || \'микрофон без названия\', peak: null, error: error.name });',
  '      } finally {',
  '        if (stream) {',
  '          try { stream.getTracks().forEach((track) => track.stop()); } catch (error) { /* уже остановлен */ }',
  '        }',
  '      }',
  '    }',
  '',
  '    const lines = results.map((row, index) => {',
  '      const mark = row.peak === null',
  '        ? \'ошибка \' + (row.error || \'\')',
  '        : (row.peak < 8 ? \'ТИШИНА (уровень \' + row.peak + \')\' : \'слышит (уровень \' + row.peak + \')\');',
  '',
  '      return (index + 1) + \'. \' + row.name + \' — \' + mark;',
  '    });',
  '',
  '    diagLine(\'Микрофоны:\\n\' + lines.join(\'\\n\'));',
  '',
  '    const good = results.filter((row) => row.peak !== null && row.peak >= 8);',
  '',
  '    if (!good.length) {',
  '      diagLine([',
  '        \'Ни один микрофон не дал звука. Значит проблема не в программе, а в Windows или в драйвере.\',',
  '        \'\',',
  '        \'Что проверить:\',',
  '        \'1. Параметры → Система → Звук → Устройство ввода: выберите микрофон,\',',
  '        \'   проверьте «Громкость микрофона» (не 0 и не выключен).\',',
  '        \'2. Там же: «Свойства» → «Дополнительно» → снимите «Разрешить приложениям\',',
  '        \'   использовать устройство в монопольном режиме».\',',
  '        \'3. Параметры → Конфиденциальность → Микрофон: включите доступ для приложений\',',
  '        \'   и для классических приложений.\',',
  '        \'4. Если это Mac с Windows (Boot Camp): встроенный микрофон иногда не работает\',',
  '        \'   без переустановки драйвера Cirrus Logic. Проще подключить гарнитуру — она\',',
  '        \'   обычно работает сразу.\'',
  '      ].join(\'\\n\'));',
  '      return;',
  '    }',
  '',
  '    diagLine([',
  '      \'Звук есть у: \' + good.map((row) => row.name).join(\', \') + \'.\',',
  '      \'\',',
  '      \'Этот микрофон и сделайте устройством по умолчанию:\',',
  '      \'Параметры → Система → Звук → Устройство ввода → выберите его,\',',
  '      \'и в «Дополнительных параметрах звука» — «Устройство по умолчанию\',',
  '      \'и связи». Браузер берёт именно устройство связи.\'',
  '    ].join(\'\\n\'));',
  '  }',
  '',
  '  /** 3 секунды слушаем микрофон и говорим, есть ли звук. */'
].join(eol);

const anchor = '  /** 3 секунды слушаем микрофон и говорим, есть ли звук. */';

if (!src.includes(anchor)) {
  console.error('не нашёл measureMicLevel');
  process.exit(1);
}

src = src.replace(anchor, block);

/* 2. measureMicLevel принимает длительность */
src = src.replace(
  '  async function measureMicLevel(stream) {',
  '  async function measureMicLevel(stream, duration = 3000) {'
);
src = src.replace(
  '    while (Date.now() - started < 3000) {',
  '    while (Date.now() - started < duration) {'
);

/* 3. В диагностике после проверки уровня запускаем обход устройств */
const afterLevel = [
  '      if (peak === null) {',
  '        diagLine(\'Не смог замерить уровень — браузер не поддерживает анализ звука.\');',
  '      } else if (peak < 8) {',
  '        diagLine(\'Тишина: микрофон ничего не слышит (уровень \' + peak + \'). Проверьте, не выбран ли не тот микрофон в Windows: Параметры → Система → Звук → Устройство ввода.\');',
  '      } else {',
  '        diagLine(\'Звук идёт, уровень \' + peak + \' — микрофон слышит.\');',
  '      }'
].join(eol);

const newAfterLevel = [
  '      if (peak === null) {',
  '        diagLine(\'Не смог замерить уровень — браузер не поддерживает анализ звука.\');',
  '      } else if (peak < 8) {',
  '        diagLine(\'Тишина на устройстве по умолчанию (уровень \' + peak + \').\');',
  '',
  '        // Тишина: проверяем все микрофоны, чтобы найти рабочий',
  '        await diagCheckDevices();',
  '      } else {',
  '        diagLine(\'Звук идёт, уровень \' + peak + \' — микрофон слышит.\');',
  '      }'
].join(eol);

if (src.includes(afterLevel)) {
  src = src.replace(afterLevel, newAfterLevel);
}

fs.writeFileSync(file, src);
console.log('готово: проверка всех микрофонов');
