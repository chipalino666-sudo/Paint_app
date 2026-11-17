'use strict';

/*
 * Голос: перед запуском распознавания явно спрашиваем доступ к микрофону.
 * Так браузер показывает запрос, а при запрете мы объясняем, куда нажать.
 *
 *   node tools/patch-mic-permission.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
let src = fs.readFileSync(file, 'utf8');

if (src.includes('voiceExplainPermission')) {
  console.log('уже пропатчено');
  process.exit(0);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';

/* 1. Объяснение про запрет доступа */
const explain = [
  '  /** Разрешение не выдано — объясняем, куда нажать именно в Edge. */',
  '  function voiceExplainPermission(error) {',
  '    const name = error && error.name ? error.name : \'NotAllowedError\';',
  '',
  '    const reasons = {',
  '      NotAllowedError: \'браузер запретил доступ к микрофону\',',
  '      PermissionDeniedError: \'браузер запретил доступ к микрофону\',',
  '      NotFoundError: \'микрофон не найден — проверьте, подключён ли он\',',
  '      NotReadableError: \'микрофон занят другой программой\',',
  '      SecurityError: \'страница открыта не по https\'',
  '    };',
  '',
  '    aiBubble(\'bot\', [',
  '      \'Доступ к микрофону закрыт: \' + (reasons[name] || name) + \'.\',',
  '      \'\',',
  '      \'Как открыть в Edge:\',',
  '      \'1. Нажмите значок замка (или ползунки) слева от адреса сайта.\',',
  '      \'2. «Разрешения для этого сайта» → Микрофон → Разрешить.\',',
  '      \'3. Перезагрузите страницу.\',',
  '      \'\',',
  '      \'Если значка нет (в установленном приложении он бывает скрыт):\',',
  '      \'• откройте edge://settings/content/microphone\',',
  '      \'• в списке «Разрешить» добавьте https://ceh-lonjeron.ru\',',
  '      \'• уберите сайт из списка «Блокировать», если он там есть.\',',
  '      \'\',',
  '      \'Ещё проверьте Windows: Параметры → Конфиденциальность → Микрофон.\',',
  '      \'Там должны быть включены «Доступ к микрофону», «Разрешить приложениям» и \' +',
  '      \'«Разрешить классическим приложениям».\'',
  '    ].join(\'\\n\'));',
  '  }',
  '',
  '  /** Просим доступ к микрофону заранее: так Edge показывает запрос. */',
  '  async function askMicPermission() {',
  '    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {',
  '      return { ok: false, error: { name: \'SecurityError\' } };',
  '    }',
  '',
  '    try {',
  '      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });',
  '      stream.getTracks().forEach((track) => { try { track.stop(); } catch (e) { /* уже остановлен */ } });',
  '      return { ok: true };',
  '    } catch (error) {',
  '      return { ok: false, error };',
  '    }',
  '  }',
  '',
  '  function initVoice() {'
].join(eol);

const initMarker = '  function initVoice() {';

if (!src.includes(initMarker)) {
  console.error('не нашёл initVoice');
  process.exit(1);
}

src = src.replace(initMarker, explain);

/* 2. Клик становится асинхронным и сначала спрашивает доступ */
const oldClick = [
  "    button.addEventListener('click', () => {",
  '      if (voiceBroken) {',
  '        voiceExplain();',
  '        button.blur();',
  '        return;',
  '      }'
].join(eol);

const newClick = [
  "    button.addEventListener('click', async () => {",
  '      if (voiceBroken) {',
  '        voiceExplain();',
  '        button.blur();',
  '        return;',
  '      }'
].join(eol);

if (!src.includes(oldClick)) {
  console.error('не нашёл начало обработчика клика');
  process.exit(1);
}

src = src.replace(oldClick, newClick);

const oldStart = [
  '      } else {',
  "        voiceText = '';",
  '        voiceStarted = false;',
  '',
  '        try {',
  '          voice.start();'
].join(eol);

const newStart = [
  '      } else {',
  "        voiceText = '';",
  '        voiceStarted = false;',
  '',
  '        // Сначала явно просим доступ: иначе Edge молча блокирует',
  '        const permission = await askMicPermission();',
  '',
  '        if (!permission.ok) {',
  '          voiceBroken = true;',
  '          voiceButtonMark(false);',
  '          voiceExplainPermission(permission.error);',
  '          button.blur();',
  '          return;',
  '        }',
  '',
  '        try {',
  '          voice.start();'
].join(eol);

if (!src.includes(oldStart)) {
  console.error('не нашёл запуск распознавания');
  process.exit(1);
}

src = src.replace(oldStart, newStart);

fs.writeFileSync(file, src);
console.log('готово: явный запрос доступа и объяснение про Edge');
