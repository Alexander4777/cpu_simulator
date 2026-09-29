// verifyOpcodeTable.mjs — script de verificación dev-only.
// Reimplementa el algoritmo de m68ki_build_opcode_table en JS puro y compara
// la jump table resultante con las filas de opcodes.csv.
//
// Uso: node scripts/verifyOpcodeTable.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const csvText = readFileSync(resolve(root, 'src/m68k/data/opcodes.csv'), 'utf8');
const lines = csvText.split(/\r?\n/).slice(1).filter(l => l.trim());

const TABLE_SIZE = 0x10000;
const ILLEGAL_HANDLER = 'm68k_op_illegal';

// --- Replica exacta del algoritmo de table_builder.txt -----------------
const rows = [];
for (const line of lines) {
  const parts = line.split(',');
  if (parts.length < 4) continue;
  const [fn, maskStr, matchStr, cycStr] = parts;
  rows.push({
    fn,
    mask: parseInt(maskStr, 16) & 0xffff,
    match: parseInt(matchStr, 16) & 0xffff,
    cycles: parseInt(cycStr, 10) | 0,
  });
}
rows.push({ fn: ILLEGAL_HANDLER, mask: 0xffff, match: 0xffff, cycles: 4 });

const jump = new Uint16Array(TABLE_SIZE);
const cycles = new Uint16Array(TABLE_SIZE);
for (let i = 0; i < TABLE_SIZE; i++) { jump[i] = 0; cycles[i] = 4; }

const indexByName = new Map();
const names = [];
for (const r of rows) {
  if (!indexByName.has(r.fn)) {
    indexByName.set(r.fn, names.length);
    names.push(r.fn);
  }
}
if (!indexByName.has(ILLEGAL_HANDLER)) {
  indexByName.set(ILLEGAL_HANDLER, names.length);
  names.push(ILLEGAL_HANDLER);
}
const illegalIdx = indexByName.get(ILLEGAL_HANDLER);
for (let i = 0; i < TABLE_SIZE; i++) jump[i] = illegalIdx;

let oi = 0;

while (oi < rows.length) {
  const r = rows[oi];
  if ([0xff00, 0xf1f8, 0xfff0, 0xf1ff, 0xfff8, 0xffff].includes(r.mask)) break;
  const h = indexByName.get(r.fn);
  for (let i = 0; i < TABLE_SIZE; i++) {
    if ((i & r.mask) === r.match) { jump[i] = h; cycles[i] = r.cycles; }
  }
  oi++;
}
while (oi < rows.length && rows[oi].mask === 0xff00) {
  const r = rows[oi];
  const h = indexByName.get(r.fn);
  for (let i = 0; i <= 0xff; i++) { jump[r.match | i] = h; cycles[r.match | i] = r.cycles; }
  oi++;
}
while (oi < rows.length && rows[oi].mask === 0xf1f8) {
  const r = rows[oi];
  const h = indexByName.get(r.fn);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    jump[r.match | (i << 9) | j] = h;
    cycles[r.match | (i << 9) | j] = r.cycles;
  }
  oi++;
}
while (oi < rows.length && rows[oi].mask === 0xfff0) {
  const r = rows[oi];
  const h = indexByName.get(r.fn);
  for (let i = 0; i <= 0x0f; i++) { jump[r.match | i] = h; cycles[r.match | i] = r.cycles; }
  oi++;
}
while (oi < rows.length && rows[oi].mask === 0xf1ff) {
  const r = rows[oi];
  const h = indexByName.get(r.fn);
  for (let i = 0; i <= 0x07; i++) {
    jump[r.match | (i << 9)] = h;
    cycles[r.match | (i << 9)] = r.cycles;
  }
  oi++;
}
while (oi < rows.length && rows[oi].mask === 0xfff8) {
  const r = rows[oi];
  const h = indexByName.get(r.fn);
  for (let i = 0; i <= 0x07; i++) { jump[r.match | i] = h; cycles[r.match | i] = r.cycles; }
  oi++;
}
while (oi < rows.length && rows[oi].mask === 0xffff && rows[oi].match !== 0xffff) {
  const r = rows[oi];
  const h = indexByName.get(r.fn);
  jump[r.match] = h;
  cycles[r.match] = r.cycles;
  oi++;
}
// ----------------------------------------------------------------------

let failed = 0;
const pass = m => console.log(`  PASS  ${m}`);
const fail = m => { console.log(`  FAIL  ${m}`); failed++; };
const check = (cond, m) => cond ? pass(m) : fail(m);

console.log('=== Verificación opcodeTable vs opcodes.csv ===');

// 1. Cada opcodeWord debe mapear al ÚLTIMO handler del CSV que lo cubra
//    (porque el algoritmo sobrescribe). Esta es la invariante correcta.
let csvRows = 0;
let mismatches = 0;
for (let op = 0; op < TABLE_SIZE; op++) {
  // Busca la última fila del CSV (en orden) tal que (op & mask) == match.
  let lastFn = ILLEGAL_HANDLER;
  let lastCyc = 4;
  for (const line of lines) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    const [fn, maskStr, matchStr, cycStr] = parts;
    const mask = parseInt(maskStr, 16) & 0xffff;
    const match = parseInt(matchStr, 16) & 0xffff;
    if ((op & mask) === match) {
      lastFn = fn;
      lastCyc = parseInt(cycStr, 10) | 0;
    }
  }
  csvRows++;
  const gotFn = names[jump[op]];
  const gotCyc = cycles[op];
  if (gotFn !== lastFn) {
    mismatches++;
    if (mismatches <= 5) fail(`0x${op.toString(16).padStart(4,'0')} esperaba ${lastFn}, obtuvo ${gotFn}`);
  }
  if (gotCyc !== lastCyc) {
    mismatches++;
    if (mismatches <= 5) fail(`0x${op.toString(16).padStart(4,'0')} ciclos: esperaba ${lastCyc}, obtuvo ${gotCyc}`);
  }
}
if (mismatches === 0) pass(`${csvRows} opcodeWords verificados contra last-row-wins`);
else fail(`${mismatches} opcodeWords no coinciden con last-row-wins`);

// 2. Casos puntuales famosos.
check(cycles[0x4E71] === 4,  'NOP 0x4E71 = 4 ciclos');
check(cycles[0x7000] === 4,  'MOVEQ base 0x7000 = 4 ciclos');
check(cycles[0x4E75] === 16, 'RTS 0x4E75 = 16 ciclos');
check(cycles[0x6000] === 10, 'BRA base 0x60xx = 10 ciclos');
check(cycles[0x6700] === 10, 'BEQ base 0x67xx = 10 ciclos');
check(cycles[0x6640] === 10, 'BCC.W #imm (0x6640) = 10 ciclos');

// 3. Sentinela + slots default.
check(illegalIdx !== undefined, 'm68k_op_illegal en HANDLER_INDEX');
const illegalSlots = Array.from(jump).filter(i => i === illegalIdx).length;
check(illegalSlots > 0, `${illegalSlots} slots default a illegal`);

// 4. Tamaños.
check(jump.length === TABLE_SIZE, `jump.length = ${jump.length}`);
check(cycles.length === TABLE_SIZE, `cycles.length = ${cycles.length}`);
check(names.length >= 1700, `HANDLER_NAMES tiene ${names.length} entradas`);

// 5. Coherencia: todos los slots mapean a un nombre conocido.
let unknownSlots = 0;
for (let i = 0; i < TABLE_SIZE; i++) {
  if (!names[jump[i]]) unknownSlots++;
}
check(unknownSlots === 0, `Slots sin nombre resuelto: ${unknownSlots}`);

console.log('');
if (failed === 0) {
  console.log(`✓ Todos los checks pasaron (${csvRows} filas CSV).`);
  process.exit(0);
} else {
  console.log(`✗ ${failed} check(s) fallaron.`);
  process.exit(1);
}
