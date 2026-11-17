'use strict';

/*
 * Диагностика микрофона в чате помощника: показывает, где именно ломается —
 * разрешение, устройство, уровень звука или распознавание.
 *
 *   node tools/patch-mic-diag.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8');

if (src.includes('runMicDiag')) {
  console.log('уже пропатчено');
  process.exit(0);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';

const block = [
  '  /* --------------------------------------------------------------------',
  '     Проверка микрофона: разрешение, устройство, уровень, распознавание',
  '     -------------------------------------------------------------------- */',
  '',
  '  let micDiagBusy = false;',
  '',
  '  function diagLine(text) {',
  '    aiBubble(\'bot\', text);',
  '  }',
  '',
  '  /** 3 секунды слушаем микрофон и говорим, есть ли звук. */',
  '  async function measureMicLevel(stream) {',
  '    const AudioCtx = window.AudioContext || window.webkitAudioContext;',
  '    if (!AudioCtx) return null;',
  '',
  '    const ctx = new AudioCtx();',
  '    const source = ctx.createMediaStreamSource(stream);',
  '    const analyser = ctx.createAnalyser();',
  '    analyser.fftSize = 1024;',
  '    source.connect(analyser);',
  '',
  '    const data = new Uint8Array(analyser.fftSize);',
  '    let peak = 0;',
  '    const started = Date.now();',
  '',
  '    while (Date.now() - started < 3000) {',
  '      analyser.getByteTimeDomainData(data);',
  '',
  '      for (let i = 0; i < data.length; i++) {',
  '        const value = Math.abs(data[i] - 128);',
  '        if (value > peak) peak = value;',
  '      }',
  '',
  '      await new Promise((resolve) => setTimeout(resolve, 120));',
  '    }',
  '',
  '    try { source.disconnect(); ctx.close(); } catch (error) { /* уже закрыт */ }',
  '',
  '    return peak;',
  '  }',
  '',
  '  async function runMicDiag() {',
  '    if (micDiagBusy) return;',
  '    micDiagBusy = true;',
  '',
  '    const button = $(\'#aiDiag\');',
  '    if (button) { button.disabled = true; button.textContent = \'Проверяю…\'; }',
  '',
  '    try {',
  '      diagLine(\'Проверяю микрофон. На вопросы браузера отвечайте «Разрешить».\');',
  '',
  '      // 1. Разрешение',
  '      let permission = \'неизвестно\';',
  '',
  '      if (navigator.permissions && navigator.permissions.query) {',
  '        try {',
  '          const status = await navigator.permissions.query({ name: \'microphone\' });',
  '          permission = status.state;',
  '        } catch (error) {',
  '          permission = \'браузер не сообщает\';',
  '        }',
  '      }',
  '',
  '      diagLine(\'1. Разрешение на микрофон: \' + permission + \'.\');',
  '',
  '      // 2. Доступ к устройству',
  '      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {',
  '        diagLine(\'Микрофон недоступен: страница открыта не по HTTPS или браузер не поддерживает запись.\');',
  '        return;',
  '      }',
  '',
  '      let stream = null;',
  '',
  '      try {',
  '        stream = await navigator.mediaDevices.getUserMedia({ audio: true });',
  '      } catch (error) {',
  '        const reasons = {',
  '          NotAllowedError: \'доступ запрещён. Нажмите на замок в адресной строке → Микрофон → Разрешить, затем перезагрузите страницу\',',
  '          PermissionDeniedError: \'доступ запрещён в настройках браузера\',',
  '          NotFoundError: \'компьютер не видит микрофон — проверьте, подключён ли он\',',
  '          NotReadableError: \'микрофон занят другой программой\',',
  '          OverconstrainedError: \'выбранное устройство не подошло\'',
  '        };',
  '',
  '        diagLine(\'2. Ошибка доступа: \' + (reasons[error.name] || error.name + \' — \' + error.message));',
  '        return;',
  '      }',
  '',
  '      const track = stream.getAudioTracks()[0];',
  '      const label = track ? track.label : \'без названия\';',
  '',
  '      diagLine(\'2. Микрофон найден: \' + label + \'.\');',
  '',
  '      // 3. Уровень звука',
  '      diagLine(\'3. Говорите что-нибудь 3 секунды — слушаю уровень…\');',
  '',
  '      const peak = await measureMicLevel(stream);',
  '',
  '      try { stream.getTracks().forEach((t) => t.stop()); } catch (error) { /* уже остановлен */ }',
  '',
  '      if (peak === null) {',
  '        diagLine(\'Не смог замерить уровень — браузер не поддерживает анализ звука.\');',
  '      } else if (peak < 8) {',
  '        diagLine(\'Тишина: микрофон ничего не слышит (уровень \' + peak + \'). Проверьте, не выбран ли не тот микрофон в Windows: Параметры → Система → Звук → Устройство ввода.\');',
  '      } else {',
  '        diagLine(\'Звук идёт, уровень \' + peak + \' — микрофон слышит.\');',
  '      }',
  '',
  '      // 4. Распознавание',
  '      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;',
  '',
  '      if (!SR) {',
  '        diagLine(\'4. Этот браузер не умеет распознавать речь. Откройте сайт в Chrome или Edge.\');',
  '        return;',
  '      }',
  '',
  '      diagLine(\'4. Проверяю распознавание: скажите фразу…\');',
  '',
  '      const result = await new Promise((resolve) => {',
  '        const rec = new SR();',
  '        rec.lang = \'ru-RU\';',
  '        rec.interimResults = false;',
  '',
  '        let heard = \'\';',
  '        let finished = false;',
  '',
  '        const finish = (text) => {',
  '          if (finished) return;',
  '          finished = true;',
  '          try { rec.abort(); } catch (error) { /* уже停止 */ }',
  '          resolve(text);',
  '        };',
  '',
  '        rec.onresult = (event) => {',
  '          heard = event.results[0][0].transcript;',
  '        };',
  '',
  '        rec.onerror = (event) => finish(\'ошибка: \' + event.error);',
  '        rec.onend = () => finish(heard ? \'услышал: «\' + heard + \'»\' : \'ничего не разобрал\');',
  '',
  '        try { rec.start(); } catch (error) { finish(\'не запустилось: \' + error.message); }',
  '',
  '        setTimeout(() => finish(heard ? \'услышал: «\' + heard + \'»\' : \'нет ответа за 10 секунд\'), 10000);',
  '      });',
  '',
  '      diagLine(\'Результат распознавания: \' + result + \'.\');',
  '      diagLine(\'Если звук есть, а распознавания нет — дело в браузере. Откройте сайт в Chrome или Edge, либо печатайте через Win+H.\');',
  '    } catch (error) {',
  '      diagLine(\'Проверка прервалась: \' + error.message);',
  '    } finally {',
  '      micDiagBusy = false;',
  '      if (button) { button.disabled = false; button.textContent = \'Проверить микрофон\'; }',
  '    }',
  '  }',
  '',
  '  async function aiSend(text) {'
].join(eol);

const anchor = '  async function aiSend(text) {';

if (!src.includes(anchor)) {
  console.error('не нашёл aiSend');
  process.exit(1);
}

src = src.replace(anchor, block);

/* Кнопка в форме чата */
const bindAnchor = "    if ($('#aiForm')) $('#aiForm').addEventListener('submit', (event) => {";

if (!src.includes(bindAnchor)) {
  console.error('не нашёл привязку формы чата');
  process.exit(1);
}

src = src.replace(bindAnchor, [
  "    if ($('#aiDiag')) $('#aiDiag').addEventListener('click', runMicDiag);",
  '',
  bindAnchor
].join(eol));

fs.writeFileSync(file, src);
console.log('диагностика микрофона добавлена');
