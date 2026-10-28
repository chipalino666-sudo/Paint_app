'use strict';

/*
 * Рисуем двери на схеме: в виде сбоку — контуры передней и задней двери,
 * в виде сверху — швы дверей по бортам.
 *
 *   node tools/apply-doors.js
 */

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'public', 'app.js');
let source = fs.readFileSync(file, 'utf8');

// Вид сбоку: заменяем одиночные линии на контуры дверей
const oldSide = `        <path class="car-line" d="M181 45 L181 112"></path>
        <path class="car-line" d="M104 70 L104 112"></path>
        <path class="car-line" d="M268 70 L268 112"></path>`;

const newSide = `        <path class="car-door" d="M104 70 L104 108 Q104 112 110 112 L181 112 L181 70"></path>
        <path class="car-door" d="M181 70 L181 112 L262 112 Q268 112 268 108 L268 70"></path>`;

if (!source.includes(oldSide)) {
  console.error('Не нашёл линии дверей в виде сбоку');
  process.exit(1);
}

source = source.replace(oldSide, newSide);

// Вид сверху: швы дверей по бортам
const oldTop = `        <path class="car-line" d="M52 70 C74 64 106 64 128 70"></path>`;

const newTop = `        <path class="car-line" d="M52 70 C74 64 106 64 128 70"></path>
        <path class="car-door" d="M38 188 L58 188"></path>
        <path class="car-door" d="M122 188 L142 188"></path>
        <path class="car-door" d="M38 256 L58 256"></path>
        <path class="car-door" d="M122 256 L142 256"></path>`;

source = source.replace(oldTop, newTop);

fs.writeFileSync(file, source);
console.log('двери на схеме нарисованы');
