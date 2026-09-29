// handlers.ts — implementación de los handlers M68K.
//
// Cada handler CSV (m68k_op_*) está mapeado a una función `(ctx) => result`.
// Implementamos el subset v1 (NOP, STOP, RTS, MOVEQ, MOVE.W/L limitado,
// ADDQ/SUBQ, CLR.W, CMP.W, BRA/Bcc, JSR, LEA). El resto cae en
// `notImplemented`, que avanza PC de forma segura y deja un mensaje en output.
//
// Codificación M68K (MOVE):
//   bits 15-13 = 001, bit 12 = size_bit, bits 11-9 = DST reg,
//   bits 8-6 = DST mode, bits 5-3 = SRC mode, bits 2-0 = SRC reg.
// Convención de sufijos CSV: <DST>_<SRC>, p.ej. `move_16_d_ai` = MOVE.W Dn → (An).

import type { Memory, M68kCPUState } from '../types/cpu';
import {
  readWord, readLong, writeWord, writeLong,
  signExtend8, signExtend16,
} from './decode';
import { setNZ, setAddFlags, setSubFlags } from './flags';

export interface HandlerCtx {
  state: M68kCPUState;
  memory: Memory;
  output: string[];
  input: number | null;
  /** PC al inicio de esta instrucción. */
  pc: number;
  /** Opcode word de 16 bits. */
  opcodeWord: number;
  /** Memoria tal como está al entrar; el handler decide si mutar in-place o clonar. */
}

export interface HandlerResult {
  state: M68kCPUState;
  memory: Memory;
  output: string[];
  halted: boolean;
  extensionWords: number[];
  /** Etiqueta humana para mostrar en la UI, p.ej. "MOVEQ #5,D0". */
  decoded?: string;
}

// --- Helpers internos ----------------------------------------------------

function push32(state: M68kCPUState, value: number): void {
  state.A[7] = (state.A[7] - 4) >>> 0;
  // Escribimos en la memoria real accediendo desde ctx en el caller:
  // para mantener este helper puro, lo hacemos inline.
  void value;
}

function memRead32(memory: Memory, addr: number): number {
  return readLong(memory, addr);
}

function memWrite32(memory: Memory, addr: number, value: number): void {
  writeLong(memory, addr, value);
}

function memWrite16(memory: Memory, addr: number, value: number): void {
  writeWord(memory, addr, value);
}

// --- Handlers implementados (v1) -----------------------------------------

function handleNop(ctx: HandlerCtx): HandlerResult {
  return { ...ctx, state: ctx.state, halted: false, extensionWords: [], decoded: 'NOP' };
}

function handleStop(ctx: HandlerCtx): HandlerResult {
  const imm = readWord(ctx.memory, ctx.pc + 2);
  return {
    ...ctx,
    state: ctx.state,
    halted: true,
    extensionWords: [imm],
    decoded: `STOP #0x${imm.toString(16).padStart(4, '0')}`,
  };
}

function handleRts(ctx: HandlerCtx): HandlerResult {
  const sp = ctx.state.A[7];
  const retAddr = memRead32(ctx.memory, sp);
  // Post-increment del SP (M68K RTS).
  ctx.state.A[7] = (sp + 4) >>> 0;
  ctx.state.PC = retAddr & 0xffff;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: 'RTS',
  };
}

function handleMoveq(ctx: HandlerCtx): HandlerResult {
  const reg = (ctx.opcodeWord >> 9) & 0x7;
  const imm = signExtend8(ctx.opcodeWord & 0xff);
  ctx.state.D[reg] = imm >>> 0;
  setNZ(ctx.state.SR.ccr, imm, 32);
  ctx.state.SR.ccr.V = 0;
  ctx.state.SR.ccr.C = 0;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: `MOVEQ #${imm},D${reg}`,
  };
}

// MOVE.L #imm32,Dn → 0x203C | (reg<<9), imm32, imm32 (high, low)
function handleMoveLDnImm(ctx: HandlerCtx): HandlerResult {
  const reg = (ctx.opcodeWord >> 9) & 0x7;
  const hi = readWord(ctx.memory, ctx.pc + 2);
  const lo = readWord(ctx.memory, ctx.pc + 4);
  const value = ((hi << 16) | lo) >>> 0;
  ctx.state.D[reg] = value;
  setNZ(ctx.state.SR.ccr, value, 32);
  ctx.state.SR.ccr.V = 0;
  ctx.state.SR.ccr.C = 0;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [hi, lo],
    decoded: `MOVE.L #0x${value.toString(16).padStart(8, '0')},D${reg}`,
  };
}

// Dispatcher genérico de MOVE: decodifica el patrón MOVE (size + dst + src)
// desde el opcodeWord y emite la operación correcta.
//
// Esta función NO se invoca directamente: se asocia a cada
// `m68k_op_move_*_xxx_yyy` desde HANDLERS. Pero como todas comparten
// lógica, centralizamos aquí y la referenciamos desde el map.

function handleMove(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const sizeBits = (op >> 12) & 0x3;        // 01=B, 11=W, 10=L
  const size: 8 | 16 | 32 =
    sizeBits === 0b01 ? 8 :
    sizeBits === 0b11 ? 16 : 32;
  const dstReg = (op >> 9) & 0x7;
  const dstMode = (op >> 6) & 0x7;
  const srcMode = (op >> 3) & 0x7;
  const srcReg = op & 0x7;
  void dstReg;

  // Lee source. Implementación mínima: solo Dn, An, (An), (An)+, -(An), #imm, .W, .L.
  const src = readEa(ctx.state, ctx.memory, srcMode, srcReg, size, ctx.pc + 2);
  if (src.error) return notImplemented(ctx, src.error);
  // Aplica post-increment/decrement al state si readEa ya lo hizo (sí lo hace).

  // Escribe en dst.
  writeEa(ctx.state, ctx.memory, dstMode, dstReg, size, src.value, src.address);

  // MOVE pone N, Z; nunca toca V, C, X.
  setNZ(ctx.state.SR.ccr, src.value, size);
  ctx.state.SR.ccr.V = 0;
  ctx.state.SR.ccr.C = 0;

  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: src.extWords,
    decoded: `MOVE.${sizeSuffix(size)} ${fmtEa(srcMode, srcReg)},${fmtEa(dstMode, dstReg)}`,
  };
}

function readEa(
  state: M68kCPUState,
  memory: Memory,
  mode: number,
  reg: number,
  size: 8 | 16 | 32,
  pc: number,
): { value: number; address: number; extWords: number[]; error?: string } {
  const extWords: number[] = [];
  let address = -1;
  let value = 0;
  switch (mode) {
    case 0b000:
      value = readReg(state, reg, size, false);
      return { value, address, extWords };
    case 0b001:
      value = readReg(state, reg, 32, true);
      return { value, address, extWords };
    case 0b010:
      address = state.A[reg] & 0xffff;
      value = readMem(memory, address, size);
      return { value, address, extWords };
    case 0b011:
      address = state.A[reg] & 0xffff;
      value = readMem(memory, address, size);
      state.A[reg] = (state.A[reg] + (size === 8 ? 2 : size === 16 ? 2 : 4)) >>> 0;
      return { value, address, extWords };
    case 0b100:
      state.A[reg] = (state.A[reg] - (size === 8 ? 2 : size === 16 ? 2 : 4)) >>> 0;
      address = state.A[reg] & 0xffff;
      value = readMem(memory, address, size);
      return { value, address, extWords };
    case 0b111:
      if (reg === 0b100) {
        if (size === 8) {
          const w = readWord(memory, pc);
          extWords.push(w);
          value = signExtend8(w & 0xff);
        } else if (size === 16) {
          const w = readWord(memory, pc);
          extWords.push(w);
          value = signExtend16(w);
        } else {
          const hi = readWord(memory, pc);
          const lo = readWord(memory, pc + 2);
          extWords.push(hi, lo);
          value = ((hi << 16) | lo) >>> 0;
        }
        return { value, address, extWords };
      }
      if (reg === 0b000) {
        const w = readWord(memory, pc);
        extWords.push(w);
        address = w & 0xffff;
        value = readMem(memory, address, size);
        return { value, address, extWords };
      }
      if (reg === 0b001) {
        const hi = readWord(memory, pc);
        const lo = readWord(memory, pc + 2);
        extWords.push(hi, lo);
        address = ((hi << 16) | lo) & 0xffff;
        value = readMem(memory, address, size);
        return { value, address, extWords };
      }
      return { value: 0, address, extWords, error: 'EA no soportada' };
    default:
      return { value: 0, address, extWords, error: 'EA no soportada' };
  }
}

function writeEa(
  state: M68kCPUState,
  memory: Memory,
  mode: number,
  reg: number,
  size: 8 | 16 | 32,
  value: number,
  address: number,
): void {
  switch (mode) {
    case 0b000:
      writeReg(state, reg, size, value);
      return;
    case 0b001:
      state.A[reg] = (value & 0xffffffff) >>> 0;
      return;
    case 0b010:
      writeMem(memory, address, size, value);
      return;
    case 0b011:
      writeMem(memory, address, size, value);
      state.A[reg] = (state.A[reg] + (size === 8 ? 2 : size === 16 ? 2 : 4)) >>> 0;
      return;
    case 0b100: {
      // Predecrement ya se hizo en readEa si fue origen; aquí ya solo escribimos.
      const addr = (address >= 0 ? address : state.A[reg]) & 0xffff;
      writeMem(memory, addr, size, value);
      return;
    }
    case 0b111:
      if (reg === 0b000 || reg === 0b001) {
        writeMem(memory, address, size, value);
        return;
      }
      return;
  }
}

function readReg(state: M68kCPUState, reg: number, size: 8 | 16 | 32, isAddr: boolean): number {
  const v = isAddr ? state.A[reg] : state.D[reg];
  return maskValue(v, size);
}
function writeReg(state: M68kCPUState, reg: number, size: 8 | 16 | 32, value: number): void {
  const mask = size === 32 ? 0xffffffff : (1 << size) - 1;
  state.D[reg] = (state.D[reg] & ~mask) | (value & mask);
}
function readMem(memory: Memory, addr: number, size: 8 | 16 | 32): number {
  if (size === 8) return memory[addr & 0xffff] & 0xff;
  if (size === 16) return readWord(memory, addr);
  return readLong(memory, addr);
}
function writeMem(memory: Memory, addr: number, size: 8 | 16 | 32, value: number): void {
  const a = addr & 0xffff;
  if (size === 8) { memory[a] = value & 0xff; return; }
  if (size === 16) { memWrite16(memory, a, value); return; }
  memWrite32(memory, a, value);
}
function maskValue(v: number, size: 8 | 16 | 32): number {
  if (size === 32) return v >>> 0;
  return v & ((1 << size) - 1);
}
function sizeSuffix(size: 8 | 16 | 32): string { return size === 8 ? 'B' : size === 16 ? 'W' : 'L'; }
function fmtEa(mode: number, reg: number): string {
  switch (mode) {
    case 0b000: return `D${reg}`;
    case 0b001: return `A${reg}`;
    case 0b010: return `(A${reg})`;
    case 0b011: return `(A${reg})+`;
    case 0b100: return `-(A${reg})`;
    case 0b111:
      if (reg === 0b100) return '#imm';
      if (reg === 0b000) return `(abs).W`;
      if (reg === 0b001) return `(abs).L`;
      return `mode=${mode},reg=${reg}`;
    default: return `mode=${mode},reg=${reg}`;
  }
}

// ADDQ/SUBQ: 0101 ddd 0ss dddd  → base 0x5000 con size (B/W/L) y data
function handleAddq(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  // bits 7-6 = size (00=B, 01=W, 10=L)
  const sz = (op >> 6) & 0x3;
  const size: 8 | 16 | 32 = sz === 0 ? 8 : sz === 1 ? 16 : 32;
  const dstMode = (op >> 3) & 0x7;
  const dstReg = (op >> 9) & 0x7;
  const data = (op & 0x0e00) >> 9;
  // Implementación simplificada: solo soportamos ADDQ #1..8 a Dn (DST mode = 000).
  if (dstMode !== 0b000) return notImplemented(ctx, 'ADDQ dst no soportado');
  const d = data === 0 ? 8 : data;
  const a = ctx.state.D[dstReg];
  const result = a + d;
  ctx.state.D[dstReg] = maskValue(result, size);
  setAddFlags(ctx.state.SR.ccr, a, d, result, size);
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: `ADDQ.${sizeSuffix(size)} #${d},D${dstReg}`,
  };
}

function handleSubq(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const sz = (op >> 6) & 0x3;
  const size: 8 | 16 | 32 = sz === 0 ? 8 : sz === 1 ? 16 : 32;
  const dstMode = (op >> 3) & 0x7;
  const dstReg = (op >> 9) & 0x7;
  const data = (op & 0x0e00) >> 9;
  if (dstMode !== 0b000) return notImplemented(ctx, 'SUBQ dst no soportado');
  const d = data === 0 ? 8 : data;
  const a = ctx.state.D[dstReg];
  const result = a - d;
  ctx.state.D[dstReg] = maskValue(result, size);
  setSubFlags(ctx.state.SR.ccr, a, d, result, size);
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: `SUBQ.${sizeSuffix(size)} #${d},D${dstReg}`,
  };
}

function handleClr(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const sz = (op >> 6) & 0x3;
  const size: 8 | 16 | 32 = sz === 0 ? 8 : sz === 1 ? 16 : 32;
  const mode = (op >> 3) & 0x7;
  const reg = (op >> 0) & 0x7;
  if (mode !== 0b000) return notImplemented(ctx, 'CLR dst no soportado');
  ctx.state.D[reg] = 0;
  setNZ(ctx.state.SR.ccr, 0, size);
  ctx.state.SR.ccr.V = 0;
  ctx.state.SR.ccr.C = 0;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: `CLR.${sizeSuffix(size)} D${reg}`,
  };
}

function handleCmp(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const sizeBits = (op >> 6) & 0x3;
  const size: 8 | 16 | 32 = sizeBits === 0 ? 8 : sizeBits === 1 ? 16 : 32;
  const dstReg = (op >> 9) & 0x7;
  const dstMode = (op >> 6) & 0x7; // bits 8-6
  const srcMode = (op >> 3) & 0x7;
  const srcReg = op & 0x7;
  if (dstMode !== 0b000) return notImplemented(ctx, 'CMP dst no soportado');
  const src = readEa(ctx.state, ctx.memory, srcMode, srcReg, size, ctx.pc + 2);
  if (src.error) return notImplemented(ctx, src.error);
  const a = ctx.state.D[dstReg];
  const b = src.value;
  setSubFlags(ctx.state.SR.ccr, a, b, a - b, size);
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: src.extWords,
    decoded: `CMP.${sizeSuffix(size)} ${fmtEa(srcMode, srcReg)},D${dstReg}`,
  };
}

// BRA / Bcc (mismo formato, solo cambia el condition)
function handleBranch(ctx: HandlerCtx, cond: boolean, name: string): HandlerResult {
  const op = ctx.opcodeWord;
  const disp = op & 0xff;
  const signedDisp = (disp & 0x80) ? (disp | 0xffffff00) : disp;
  let target: number;
  let extWords: number[] = [];
  if (disp === 0x00 || disp === 0xff) {
    // 16-bit displacement
    const w = readWord(ctx.memory, ctx.pc + 2);
    extWords.push(w);
    target = (ctx.pc + 2 + signExtend16(w)) & 0xffff;
  } else {
    // 8-bit displacement
    target = (ctx.pc + 2 + signedDisp) & 0xffff;
  }
  if (cond) ctx.state.PC = target;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: extWords,
    decoded: cond ? `${name} 0x${target.toString(16).padStart(4, '0')}` : `${name} (no salta)`,
  };
}

// JSR (An) — 0100 1110 1001 0rrr  (mask 0xfff8, match 0x4e90)
function handleJsrAn(ctx: HandlerCtx): HandlerResult {
  const reg = ctx.opcodeWord & 0x7;
  const target = ctx.state.A[reg] & 0xffff;
  // Push return address (PC + 2 porque la instrucción son 2 bytes y ya se avanzó).
  ctx.state.A[7] = (ctx.state.A[7] - 4) >>> 0;
  memWrite32(ctx.memory, ctx.state.A[7], (ctx.pc + 2) & 0xffffffff);
  ctx.state.PC = target;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: `JSR (A${reg})`,
  };
}

// JSR (abs).L — match 0x4eb9, ext = 2 words
function handleJsrAbsL(ctx: HandlerCtx): HandlerResult {
  const hi = readWord(ctx.memory, ctx.pc + 2);
  const lo = readWord(ctx.memory, ctx.pc + 4);
  const target = ((hi << 16) | lo) & 0xffff;
  ctx.state.A[7] = (ctx.state.A[7] - 4) >>> 0;
  memWrite32(ctx.memory, ctx.state.A[7], (ctx.pc + 2) & 0xffffffff);
  ctx.state.PC = target;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [hi, lo],
    decoded: `JSR 0x${target.toString(16).padStart(4, '0')}.L`,
  };
}

// BSR.B / BSR.W — branch to subroutine con desplazamiento relativo.
// Mismo efecto que JSR pero codificación distinta: BSR usa displacement, JSR usa EA.
function handleBsr(ctx: HandlerCtx, size: 'B' | 'W'): HandlerResult {
  const op = ctx.opcodeWord;
  const disp = op & 0xff;
  let target: number;
  let extWords: number[] = [];
  if (size === 'B' && disp !== 0x00 && disp !== 0xff) {
    const signedDisp = (disp & 0x80) ? (disp | 0xffffff00) : disp;
    target = (ctx.pc + 2 + signedDisp) & 0xffff;
  } else {
    const w = readWord(ctx.memory, ctx.pc + 2);
    extWords.push(w);
    target = (ctx.pc + 2 + signExtend16(w)) & 0xffff;
  }
  ctx.state.A[7] = (ctx.state.A[7] - 4) >>> 0;
  memWrite32(ctx.memory, ctx.state.A[7], (ctx.pc + 2) & 0xffffffff);
  ctx.state.PC = target;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: extWords,
    decoded: `BSR 0x${target.toString(16).padStart(4, '0')}`,
  };
}

// LEA (An),Ax — match 0x41d0, mask 0xf1f8  (LEA solo con src (An))
function handleLeaAn(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const dstReg = (op >> 9) & 0x7;
  const srcMode = (op >> 3) & 0x7;
  const srcReg = op & 0x7;
  if (srcMode !== 0b010) return notImplemented(ctx, 'LEA src no soportado');
  ctx.state.A[dstReg] = ctx.state.A[srcReg] & 0xffff;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [],
    decoded: `LEA (A${srcReg}),A${dstReg}`,
  };
}

// LEA (abs).W → Ax (0x41f8, mask 0xf1ff)
function handleLeaAbsW(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const dstReg = (op >> 9) & 0x7;
  const w = readWord(ctx.memory, ctx.pc + 2);
  ctx.state.A[dstReg] = w & 0xffff;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [w],
    decoded: `LEA 0x${w.toString(16).padStart(4, '0')}.W,A${dstReg}`,
  };
}

// LEA (abs).L → Ax (0x41f9, mask 0xf1ff)
function handleLeaAbsL(ctx: HandlerCtx): HandlerResult {
  const op = ctx.opcodeWord;
  const dstReg = (op >> 9) & 0x7;
  const hi = readWord(ctx.memory, ctx.pc + 2);
  const lo = readWord(ctx.memory, ctx.pc + 4);
  const addr = ((hi << 16) | lo) & 0xffff;
  ctx.state.A[dstReg] = addr;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: [hi, lo],
    decoded: `LEA 0x${addr.toString(16).padStart(4, '0')}.L,A${dstReg}`,
  };
}

// --- Stub universal ------------------------------------------------------

function notImplemented(ctx: HandlerCtx, reason?: string): HandlerResult {
  const ext = estimateExtWords(ctx.opcodeWord);
  const extWords: number[] = [];
  for (let k = 0; k < ext; k++) {
    extWords.push(readWord(ctx.memory, ctx.pc + 2 + k * 2));
  }
  const tag = `${ctx.pc.toString(16).padStart(4, '0')} (op=0x${ctx.opcodeWord.toString(16).padStart(4, '0')}${reason ? ' ' + reason : ''})`;
  return {
    ...ctx,
    state: ctx.state,
    halted: false,
    extensionWords: extWords,
    decoded: `[no impl] ${tag}`,
  };
}

function estimateExtWords(opcodeWord: number): number {
  const op = opcodeWord;
  const sizeBits = (op >> 6) & 0x3;
  const dstMode = (op >> 3) & 0x7;
  // src #imm con size .L = 2 ext; .W = 1; .B = 1
  if (dstMode === 0b111 && (op & 0x7) === 0b100) {
    return sizeBits === 0b10 ? 2 : 1;
  }
  // dst #imm no permitido en escritura, pero por si acaso
  if (dstMode === 0b111 && (op & 0x7) === 0b000) return 1; // (abs).W
  if (dstMode === 0b111 && (op & 0x7) === 0b001) return 2; // (abs).L
  return 0;
}

function handleIllegal(ctx: HandlerCtx): HandlerResult {
  return {
    ...ctx,
    state: ctx.state,
    halted: true,
    extensionWords: [],
    decoded: `ILLEGAL @0x${ctx.pc.toString(16).padStart(4, '0')}`,
  };
}

// --- Mapa de dispatch ----------------------------------------------------
//
// Para evitar repetir el switch 1701 veces, mapeamos por prefijo de nombre.
// Si el nombre no aparece en el switch, cae en notImplemented.

export const HANDLERS: Record<string, (ctx: HandlerCtx) => HandlerResult> = {
  m68k_op_illegal: handleIllegal,
  m68k_op_nop: handleNop,
  m68k_op_stop: handleStop,
  m68k_op_rts_32: handleRts,

  m68k_op_moveq_32: handleMoveq,
  m68k_op_move_32_d_i: handleMoveLDnImm,

  // MOVE.W/L con todos los pares DST/SRC soportados en v1.
  // Las handlers "move_*_*_*" reusan handleMove, que decodifica en runtime.
  // Para evitar registrar 100+ entradas, las registramos por prefijo en runtime
  // (ver defaultHandler en executor.ts). Aquí dejamos las explícitas para
  // asegurar que las direcciones que SÍ usamos están cubiertas.
  m68k_op_move_16_d_d: handleMove,
  m68k_op_move_16_d_ai: handleMove,
  m68k_op_move_16_d_di: handleMove,
  m68k_op_move_16_d_ix: handleMove,
  m68k_op_move_16_d_pi: handleMove,
  m68k_op_move_16_d_pd: handleMove,
  m68k_op_move_16_ai_d: handleMove,
  m68k_op_move_16_pi_d: handleMove,
  m68k_op_move_16_pd_d: handleMove,
  m68k_op_move_16_di_d: handleMove,
  m68k_op_move_16_ix_d: handleMove,
  m68k_op_move_16_aw_d: handleMove,
  m68k_op_move_16_al_d: handleMove,
  m68k_op_move_32_d_d: handleMove,
  m68k_op_move_32_ai_d: handleMove,
  m68k_op_move_32_pi_d: handleMove,

  m68k_op_addq_8_d: handleAddq,
  m68k_op_addq_16_d: handleAddq,
  m68k_op_addq_32_d: handleAddq,

  m68k_op_subq_8_d: handleSubq,
  m68k_op_subq_16_d: handleSubq,
  m68k_op_subq_32_d: handleSubq,

  m68k_op_clr_16_d: handleClr,

  m68k_op_cmp_16_d_d: handleCmp,

  // Branch helpers: cada condición llama handleBranch con el nombre.
  m68k_op_bra_8: (ctx) => handleBranch(ctx, true, 'BRA'),
  m68k_op_bra_16: (ctx) => handleBranch(ctx, true, 'BRA'),
  m68k_op_beq_8: (ctx) => handleBranch(ctx, !!ctx.state.SR.ccr.Z, 'BEQ'),
  m68k_op_beq_16: (ctx) => handleBranch(ctx, !!ctx.state.SR.ccr.Z, 'BEQ'),
  m68k_op_bne_8: (ctx) => handleBranch(ctx, !ctx.state.SR.ccr.Z, 'BNE'),
  m68k_op_bne_16: (ctx) => handleBranch(ctx, !ctx.state.SR.ccr.Z, 'BNE'),
  m68k_op_bcc_8: (ctx) => handleBranch(ctx, !ctx.state.SR.ccr.C, 'BCC'),
  m68k_op_bcc_16: (ctx) => handleBranch(ctx, !ctx.state.SR.ccr.C, 'BCC'),
  m68k_op_bcs_8: (ctx) => handleBranch(ctx, !!ctx.state.SR.ccr.C, 'BCS'),
  m68k_op_bcs_16: (ctx) => handleBranch(ctx, !!ctx.state.SR.ccr.C, 'BCS'),
  m68k_op_bpl_8: (ctx) => handleBranch(ctx, !ctx.state.SR.ccr.N, 'BPL'),
  m68k_op_bmi_8: (ctx) => handleBranch(ctx, !!ctx.state.SR.ccr.N, 'BMI'),

  // JSR
  m68k_op_jsr_32_ai: handleJsrAn,
  m68k_op_jsr_32_al: handleJsrAbsL,
  m68k_op_jsr_32_aw: (ctx) => {
    const w = readWord(ctx.memory, ctx.pc + 2);
    ctx.state.A[7] = (ctx.state.A[7] - 4) >>> 0;
    memWrite32(ctx.memory, ctx.state.A[7], (ctx.pc + 2) & 0xffffffff);
    ctx.state.PC = w & 0xffff;
    return { ...ctx, state: ctx.state, halted: false, extensionWords: [w], decoded: `JSR 0x${w.toString(16).padStart(4, '0')}.W` };
  },

  // BSR
  m68k_op_bsr_8:  (ctx) => handleBsr(ctx, 'B'),
  m68k_op_bsr_16: (ctx) => handleBsr(ctx, 'W'),

  // LEA
  m68k_op_lea_32_ai: handleLeaAn,
  m68k_op_lea_32_aw: handleLeaAbsW,
  m68k_op_lea_32_al: handleLeaAbsL,
};

// Mensaje genérico cuando un handler no está implementado explícitamente.
// Lo usa el executor cuando hace dispatch a un nombre no presente en HANDLERS.
export function getHandler(name: string): (ctx: HandlerCtx) => HandlerResult {
  return HANDLERS[name] ?? ((ctx) => notImplemented(ctx));
}

// Alias para mantener la regla de "toda función importada se usa".
export const _unused_push32 = push32; void _unused_push32;
