'use strict';

/*
 * Голосовой ввод: Opera объявляет SpeechRecognition, но ничего не делает.
 * Добавляем проверку «не началось за 2,5 секунды» и понятную подсказку.
 *
 * Правим ТОЛЬКО участок функции initVoice, чтобы не задеть другие обработчики.
 *
 *   node tools/patch-voice-opera.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'server', 'public', 'app.js');
const src = fs.readFileSync(file, 'utf8');

if (src.includes('voiceExplain')) {
  console.log('уже пропатчено');
  process.exit(0);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';

const startMarker = '  function initVoice() {';
const endMarker = '  /** Переход по просьбе помощника';

const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);

if (start < 0 || end < 0 || end <= start) {
  console.error('не нашёл границы initVoice');
  process.exit(1);
}

let body = src.slice(start, end);

/* 1. Переменные и объяснение — перед функцией */
const vars = [
  '  let voiceStarted = false;',
  '  let voiceBroken = false;',
  '  let voiceWatchdog = null;',
  '  let voiceHintShown = false;',
  '',
  '  /** Opera отдаёт кнопку, но сервис распознавания в неё не встроен. */',
  '  function voiceExplain() {',
  '    if (voiceHintShown) return;',
  '    voiceHintShown = true;',
  '',
  '    aiBubble(\'bot\', [',
  '      \'В этом браузере распознавание речи не работает. Так устроена Opera: кнопка есть, а сервис распознавания в неё не встроен.\',',
  '      \'\',',
  '      \'Что делать:\',',
  '      \'• нажмите Win+H — это голосовой ввод Windows, он печатает в любое поле, включая это;\',',
  '      \'• или откройте сайт в Chrome либо Edge — там микрофон работает;\',',
  '      \'• или диктуйте с телефона.\'',
  '    ].join(\'\\n\'));',
  '  }',
  '',
  '  function initVoice() {'
].join(eol);

body = body.replace(startMarker, vars);

/* 2. Событие start */
body = body.replace(
  "    voice.addEventListener('start', () => voiceButtonMark(true));",
  [
    "    voice.addEventListener('start', () => {",
    '      voiceStarted = true;',
    '      if (voiceWatchdog) { clearTimeout(voiceWatchdog); voiceWatchdog = null; }',
    '      voiceButtonMark(true);',
    '    });'
  ].join(eol)
);

/* 3. Событие end */
const endNeedle = "    voice.addEventListener('end', () => {" + eol + '      voiceButtonMark(false);';
body = body.replace(endNeedle, endNeedle + eol +
  '      if (voiceWatchdog) { clearTimeout(voiceWatchdog); voiceWatchdog = null; }' + eol +
  '      voiceStarted = false;');

/* 4. Клик — внутри initVoice */
const clickRegex = /    button\.addEventListener\('click', \(\) => \{[\s\S]*?\r?\n    \}\);/;

if (!clickRegex.test(body)) {
  console.error('не нашёл обработчик клика внутри initVoice');
  process.exit(1);
}

const newClick = [
  "    button.addEventListener('click', () => {",
  '      if (voiceBroken) {',
  '        voiceExplain();',
  '        button.blur();',
  '        return;',
  '      }',
  '',
  "      if ($('#aiMic').classList.contains('ai-mic-on')) {",
  '        voice.stop();',
  '      } else {',
  "        voiceText = '';",
  '        voiceStarted = false;',
  '',
  '        try {',
  '          voice.start();',
  '        } catch (error) {',
  '          voiceBroken = true;',
  '          voiceButtonMark(false);',
  '          voiceExplain();',
  '          button.blur();',
  '          return;',
  '        }',
  '',
  '        // Opera молчит: не началось за 2,5 секунды — значит не работает',
  '        if (voiceWatchdog) clearTimeout(voiceWatchdog);',
  '        voiceWatchdog = setTimeout(() => {',
  '          if (voiceStarted) return;',
  '',
  '          voiceBroken = true;',
  '          voiceButtonMark(false);',
  '',
  '          try { voice.abort(); } catch (error) { /* уже остановлено */ }',
  '',
  '          voiceExplain();',
  '        }, 2500);',
  '      }',
  '',
  '      // Убираем фокус: иначе на телефоне кнопка остаётся подсвеченной',
  '      button.blur();',
  '    });'
].join(eol);

body = body.replace(clickRegex, newClick);

const out = src.slice(0, start) + body + src.slice(end);
fs.writeFileSync(file, out);
console.log('готово: initVoice обновлён, остальной файл не тронут');
