// runE2E.mjs — test end-to-end del simulador M68K.
//
// Replica el algoritmo de m68ki_build_opcode_table y un subconjunto
// del executor/assembler en JS puro, para verificar el comportamiento
// sin depender del bundler TS. La idea es que las codificaciones de las
// instrucciones usadas en los demos coincidan exactamente con el CSV.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// --- 1. Carga CSV y construye jump table ---
const csvText = readFileSync(resolve(root, 'src/m68k/data/opcodes.csv'), 'utf8');
const rows = [];
for (const line of csvText.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const [fn, maskStr, matchStr, cycStr] = line.split(',');
  rows.push({
    fn,
    mask: parseInt(maskStr, 16) & 0xffff,
    match: parseInt(matchStr, 16) & 0xffff,
    cycles: parseInt(cycStr, 10) | 0,
  });
}
rows.push({ fn: 'm68k_op_illegal', mask: 0xffff, match: 0xffff, cycles: 4 });

const TABLE_SIZE = 0x10000;
const ILLEGAL = 'm68k_op_illegal';
const jump = new Uint16Array(TABLE_SIZE);
const cycles = new Uint16Array(TABLE_SIZE);
const indexByName = new Map();
const names = [];
for (let i = 0; i < TABLE_SIZE; i++) { jump[i] = 0; cycles[i] = 4; }
for (const r of rows) {
  if (!indexByName.has(r.fn)) {
    indexByName.set(r.fn, names.length);
    names.push(r.fn);
  }
}
if (!indexByName.has(ILLEGAL)) {
  indexByName.set(ILLEGAL, names.length);
  names.push(ILLEGAL);
}
const illegalIdx = indexByName.get(ILLEGAL);
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

function handlerName(op) { return names[jump[op]]; }
function cyclesOf(op) { return cycles[op]; }

// --- 2. Mini-assembler para los demos ---
function parseNum(s) {
  s = s.trim();
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.slice(2), 16);
  if (s.startsWith('$')) return parseInt(s.slice(1), 16);
  return parseInt(s, 10);
}

function assembleSimple(source) {
  const lines = source.split(/\r?\n/);

  // Pass 1: SOLO recoge labels (calculando tamaños)
  const labels = {};
  let pc = 0;
  const instrList = [];   // { mnemonic, operands, label?, sizeInBytes }
  for (const line of lines) {
    let s = line.split(';')[0].trim();
    if (!s) continue;
    let label;
    const colon = s.indexOf(':');
    if (colon >= 0) {
      label = s.substring(0, colon).trim();
      s = s.substring(colon + 1).trim();
      if (label) labels[label] = pc;
    }
    if (!s) continue;
    const tokens = s.split(/\s+/);
    const mnemonic = tokens[0].toUpperCase();
    const operands = tokens.slice(1).join(' ').split(',').map(t => t.trim()).filter(Boolean);
    let sizeInBytes = 2;
    switch (mnemonic) {
      case 'ORG': sizeInBytes = 0; break;
      case 'STOP': sizeInBytes = 4; break;
      case 'BSR.S': case 'BSR.B': sizeInBytes = 2; break;
      case 'BSR': sizeInBytes = 4; break;
    }
    instrList.push({ mnemonic, operands, label, sizeInBytes });
    pc += sizeInBytes;
  }

  // Pass 2: emite usando labels ya conocidos
  const bytes = [];
  let baseAddr = 0;
  let pcEmit = 0;
  for (const p of instrList) {
    if (p.mnemonic === 'ORG') {
      baseAddr = parseNum(p.operands[0]) & 0xffff;
      pcEmit = baseAddr;
      continue;
    }
    const items = [];
    switch (p.mnemonic) {
      case 'NOP': items.push(0x4e71); break;
      case 'MOVEQ': {
        const imm = parseNum(p.operands[0].slice(1)) & 0xff;
        const reg = parseInt(p.operands[1].slice(1), 10);
        items.push(0x7000 | (reg << 9) | imm);
        break;
      }
      case 'ADDQ.W': {
        const n = parseNum(p.operands[0].slice(1));
        const reg = parseInt(p.operands[1].slice(1), 10);
        items.push(0x5040 | ((n & 0x7) << 9) | reg);
        break;
      }
      case 'ADD.W': {
        const src = parseInt(p.operands[0].slice(1), 10);
        const dst = parseInt(p.operands[1].slice(1), 10);
        items.push(0xd040 | (dst << 9) | src);
        break;
      }
      case 'STOP': {
        const v = parseNum(p.operands[0].slice(1));
        items.push(0x4e72, v & 0xffff);
        break;
      }
      case 'BSR.S':
      case 'BSR.B': {
        const target = labels[p.operands[0]] ?? parseNum(p.operands[0]);
        const disp = (target - (pcEmit + 2)) & 0xff;
        items.push(0x6100 | (disp & 0xff));
        break;
      }
      case 'BSR': {
        const target = labels[p.operands[0]] ?? parseNum(p.operands[0]);
        const disp = (target - (pcEmit + 2)) & 0xffff;
        items.push(0x6100, disp);
        break;
      }
      case 'RTS': items.push(0x4e75); break;
    }
    for (const w of items) {
      bytes.push((w >> 8) & 0xff, w & 0xff);
    }
    pcEmit += p.sizeInBytes;
  }
  return { bytes, baseAddr, labels };
}

// --- 3. Mini-executor ---
function createState() {
  return {
    PC: 0,
    D: new Uint32Array(8),
    A: new Uint32Array(8),
    SR: { X: 0, N: 0, Z: 0, V: 0, C: 0, S: 1, I: 7, M: 1 },
    halted: false,
  };
}

function readWord(mem, addr) {
  return ((mem[addr & 0xffff] << 8) | mem[(addr + 1) & 0xffff]) & 0xffff;
}
function readLong(mem, addr) {
  return ((readWord(mem, addr) << 16) | readWord(mem, (addr + 2) & 0xffff)) >>> 0;
}
function writeLong(mem, addr, value) {
  const v = value >>> 0;
  mem[addr & 0xffff] = (v >>> 24) & 0xff;
  mem[(addr + 1) & 0xffff] = (v >>> 16) & 0xff;
  mem[(addr + 2) & 0xffff] = (v >>> 8) & 0xff;
  mem[(addr + 3) & 0xffff] = v & 0xff;
}
function signExt8(v) { return (v & 0x80) ? (v | 0xffffff00) : (v & 0xff); }
function signExt16(v) { return (v & 0x8000) ? (v | 0xffff0000) : (v & 0xffff); }
function mask8(v) { return v & 0xff; }
function mask16(v) { return v & 0xffff; }
function mask32(v) { return v >>> 0; }
function setNZ(ccr, value, size) {
  const m = size === 32 ? 0xffffffff : size === 16 ? 0xffff : 0xff;
  const sb = size === 32 ? 0x80000000 : size === 16 ? 0x8000 : 0x80;
  const v = value & m;
  ccr.N = (v & sb) ? 1 : 0;
  ccr.Z = v === 0 ? 1 : 0;
}
function setAddFlags(ccr, a, b, r, size) {
  const m = size === 32 ? 0xffffffff : size === 16 ? 0xffff : 0xff;
  const sb = size === 32 ? 0x80000000 : size === 16 ? 0x8000 : 0x80;
  const ra = a & m, rb = b & m, rr = r & m;
  ccr.N = (rr & sb) ? 1 : 0;
  ccr.Z = rr === 0 ? 1 : 0;
  const signA = (ra & sb) !== 0, signB = (rb & sb) !== 0, signR = (rr & sb) !== 0;
  ccr.V = (signA === signB && signR !== signA) ? 1 : 0;
  ccr.C = (r > m || r < 0) ? 1 : 0;
  ccr.X = ccr.C;
}
function setSubFlags(ccr, a, b, r, size) {
  const m = size === 32 ? 0xffffffff : size === 16 ? 0xffff : 0xff;
  const sb = size === 32 ? 0x80000000 : size === 16 ? 0x8000 : 0x80;
  const ra = a & m, rb = b & m, rr = r & m;
  ccr.N = (rr & sb) ? 1 : 0;
  ccr.Z = rr === 0 ? 1 : 0;
  const signA = (ra & sb) !== 0, signB = (rb & sb) !== 0, signR = (rr & sb) !== 0;
  ccr.V = (signA !== signB && signR !== signA) ? 1 : 0;
  ccr.C = (r < 0) ? 1 : 0;
  ccr.X = ccr.C;
}

function execute(state, mem) {
  const pc = state.PC & 0xffff;
  const op = readWord(mem, pc);
  const name = handlerName(op);
  const cycles = cyclesOf(op);

  switch (name) {
    case 'm68k_op_nop':
      state.PC = pc + 2;
      break;
    case 'm68k_op_moveq_32': {
      const reg = (op >> 9) & 0x7;
      const imm = signExt8(op & 0xff);
      state.D[reg] = imm >>> 0;
      setNZ(state.SR, imm, 32);
      state.SR.V = 0; state.SR.C = 0;
      state.PC = pc + 2;
      break;
    }
    case 'm68k_op_addq_16_d': {
      const data = (op >> 9) & 0x7;
      const reg = op & 0x7;
      const d = data === 0 ? 8 : data;
      const a = state.D[reg];
      const r = a + d;
      state.D[reg] = mask16(r);
      setAddFlags(state.SR, a, d, r, 16);
      state.PC = pc + 2;
      break;
    }
    case 'm68k_op_add_16_er_d': {
      // ADD.W Dn,Dn: src = bits 2-0, dst = bits 11-9, mode = 000
      const dst = (op >> 9) & 0x7;
      const src = op & 0x7;
      const a = state.D[dst] & 0xffff;
      const b = state.D[src] & 0xffff;
      const r = a + b;
      state.D[dst] = (state.D[dst] & 0xffff0000) | (r & 0xffff);
      setAddFlags(state.SR, a, b, r, 16);
      state.PC = pc + 2;
      break;
    }
    case 'm68k_op_move_16_d_d': {
      // MOVE.W Dn,Dn: bits 11-9 = dst reg, bits 2-0 = src reg
      const dst = (op >> 9) & 0x7;
      const src = op & 0x7;
      const v = state.D[src] & 0xffff;
      state.D[dst] = (state.D[dst] & 0xffff0000) | v;
      setNZ(state.SR, v, 16);
      state.SR.V = 0; state.SR.C = 0;
      state.PC = pc + 2;
      break;
    }
    case 'm68k_op_stop': {
      state.PC = pc + 4;
      state.halted = true;
      break;
    }
    case 'm68k_op_bsr_8': {
      const disp = op & 0xff;
      const sd = signExt8(disp);
      const target = pc + 2 + sd;
      // push return addr = pc + 2
      state.A[7] = (state.A[7] - 4) >>> 0;
      writeLong(mem, state.A[7], (pc + 2) >>> 0);
      state.PC = target & 0xffff;
      break;
    }
    case 'm68k_op_rts_32': {
      const ret = readLong(mem, state.A[7]);
      state.A[7] = (state.A[7] + 4) >>> 0;
      state.PC = ret & 0xffff;
      break;
    }
    case 'm68k_op_illegal':
      state.halted = true;
      state.PC = pc + 2;
      break;
    default:
      console.log(`  WARN  opcode no implementado: 0x${op.toString(16).padStart(4,'0')} = ${name}`);
      state.PC = pc + 2;
  }
  return cycles;
}

// --- 4. Ejecuta los demos ---
function runDemo(name, source) {
  console.log(`\n=== ${name} ===`);
  const { bytes, baseAddr, labels } = assembleSimple(source);
  console.log(`  baseAddr=0x${baseAddr.toString(16)}, bytes=[${bytes.map(b => '0x'+b.toString(16).padStart(2,'0')).join(',')}]`);
  const mem = new Uint8Array(0x10000);

  let state = createState();
  state.PC = baseAddr;
  mem.set(bytes, baseAddr);

  let totalCycles = 0;
  let steps = 0;
  while (!state.halted && steps < 100) {
    const c = execute(state, mem);
    totalCycles += c;
    steps++;
  }
  console.log(`  Steps: ${steps}, Total cycles: ${totalCycles}`);
  console.log(`  Final PC: 0x${state.PC.toString(16).padStart(4,'0')}`);
  console.log(`  D0=0x${state.D[0].toString(16)}, D1=0x${state.D[1].toString(16)}, D2=0x${state.D[2].toString(16)}`);
  console.log(`  Z=${state.SR.Z}, N=${state.SR.N}, halted=${state.halted}`);
  return { state, totalCycles, steps, labels };
}

let failed = 0;
function pass(m) { console.log(`  PASS  ${m}`); }
function fail(m) { console.log(`  FAIL  ${m}`); failed++; }
function check(cond, m) { cond ? pass(m) : fail(m); }

// Demo 1: 5 + 3
const demo1 = runDemo('Demo 1: 5 + 3', `; Suma 5 + 3
        ORG     $1000
        MOVEQ   #5,D0
        MOVEQ   #3,D1
        ADDQ.W  #2,D0
        ADD.W   D1,D0
        STOP    #$2700
`);
check(demo1.state.halted, 'Demo 1 halted=true');
check(demo1.state.D[0] === 10, 'Demo 1 D0 = 10 (esperado 10)');
check(demo1.state.D[1] === 3, 'Demo 1 D1 = 3');
check(demo1.totalCycles === 20, `Demo 1 ciclos = ${demo1.totalCycles} (esperado 20)`);

// Demo 2: JSR/RTS
const demo2 = runDemo('Demo 2: JSR/RTS', `; D0 += 1 con subrutina
        ORG     $1000
        MOVEQ   #4,D0
        BSR.S   sub
        STOP    #$2700
sub:    ADDQ.W  #1,D0
        RTS
`);
check(demo2.state.halted, 'Demo 2 halted=true');
check(demo2.state.D[0] === 5, `Demo 2 D0 = ${demo2.state.D[0]} (esperado 5)`);
// BSR salta sobre STOP, pero después del RTS el PC cae en STOP y se ejecuta.
// MOVEQ(4) + BSR(18) + ADDQ(4) + RTS(16) + STOP(4) = 46
check(demo2.totalCycles === 46, `Demo 2 ciclos = ${demo2.totalCycles} (esperado 46)`);

console.log('');
if (failed === 0) {
  console.log('✓ Todos los checks end-to-end pasaron.');
  process.exit(0);
} else {
  console.log(`✗ ${failed} check(s) fallaron.`);
  process.exit(1);
}
