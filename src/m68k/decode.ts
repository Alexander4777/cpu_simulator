// decode.ts — helpers de bajo nivel para leer/escribir memoria y
// decodificar operandos M68K.
//
// El simulador trabaja con memoria byte-addressable. Cada palabra (16 bits)
// ocupa 2 bytes big-endian: `memory[addr]` = byte alto, `memory[addr+1]`
// = byte bajo. Cada long (32 bits) son 2 words consecutivas (4 bytes).

import type { Memory, M68kCPUState } from '../types/cpu';

/** Lee un byte (8 bits) en `addr`. */
export function readByte(memory: Memory, addr: number): number {
  return memory[addr & 0xffff] & 0xff;
}

/** Lee una word (16 bits, big-endian) en `addr`. */
export function readWord(memory: Memory, addr: number): number {
  const hi = memory[addr & 0xffff] & 0xff;
  const lo = memory[(addr + 1) & 0xffff] & 0xff;
  return ((hi << 8) | lo) & 0xffff;
}

/** Lee un long (32 bits, big-endian) en `addr`. */
export function readLong(memory: Memory, addr: number): number {
  const hi = readWord(memory, addr);
  const lo = readWord(memory, (addr + 2) & 0xffff);
  return ((hi << 16) | lo) >>> 0;
}

/** Escribe un byte. */
export function writeByte(memory: Memory, addr: number, value: number): void {
  memory[addr & 0xffff] = value & 0xff;
}

/** Escribe una word big-endian. */
export function writeWord(memory: Memory, addr: number, value: number): void {
  const v = value & 0xffff;
  memory[addr & 0xffff] = (v >> 8) & 0xff;
  memory[(addr + 1) & 0xffff] = v & 0xff;
}

/** Escribe un long big-endian. */
export function writeLong(memory: Memory, addr: number, value: number): void {
  writeWord(memory, addr, (value >>> 16) & 0xffff);
  writeWord(memory, (addr + 2) & 0xffff, value & 0xffff);
}

/** Sign-extend un valor de 8 bits a 32 bits. */
export function signExtend8(v: number): number {
  return (v & 0x80) ? (v | 0xffffff00) : (v & 0xff);
}

/** Sign-extend un valor de 16 bits a 32 bits. */
export function signExtend16(v: number): number {
  return (v & 0x8000) ? (v | 0xffff0000) : (v & 0xffff);
}

/** Trunca a N bits sin signo (útil para enmascarar resultado). */
export function mask(value: number, size: 8 | 16 | 32): number {
  if (size === 32) return value >>> 0;
  return value & ((1 << size) - 1);
}

// ---- Effective address decoding (subset v1) ----------------------------
//
// M68K usa un campo `mode` (3 bits) + `reg` (3 bits) para codificar la
// effective address. En v1 soportamos:
//
//   mode reg   significado
//   000  reg   Dn              (data register direct)
//   001  reg   An              (address register direct)
//   010  reg   (An)            (address indirect)
//   011  reg   (An)+           (postincrement)
//   100  reg   -(An)           (predecrement)
//   101  reg   (d16,An)        (displacement indirect)  ← no en v1
//   110  reg   (d8,An,Xn)      (indexed)                ← no en v1
//   111  000   (xxx).W         (absolute short)
//   111  001   (xxx).L         (absolute long)
//   111  010   (d16,PC)        (PC relative displ)     ← no en v1
//   111  011   (d8,PC,Xn)      (PC indexed)            ← no en v1
//   111  100   #imm            (immediate)
//
// `decodeEa` devuelve el valor efectivo (32 bits, enmascarado) y la
// información de direccionamiento (dirección para escrituras, número de
// extension words consumidos, si fue leída de memoria).

export interface EaInfo {
  /** Valor leído (32 bits, ya enmascarado según size). */
  value: number;
  /** Dirección efectiva (cuando aplique); -1 si no tiene dirección. */
  address: number;
  /** Extension words consumidos (0 si no aplica). */
  extWords: number[];
}

/**
 * Decodifica y lee una EA. Solo implementa el subset v1.
 * Si la EA requiere extension words no soportados, devuelve un error.
 */
export function decodeEa(
  state: M68kCPUState,
  memory: Memory,
  mode: number,
  reg: number,
  size: 8 | 16 | 32,
  pc: number,
): { info: EaInfo; newPc: number; error?: string } {
  const extWords: number[] = [];
  let value = 0;
  let address = -1;

  switch (mode) {
    case 0b000: // Dn
      value = mask(state.D[reg], size);
      return { info: { value, address: -1, extWords }, newPc: pc };

    case 0b001: // An
      value = mask(state.A[reg], size);
      return { info: { value, address: -1, extWords }, newPc: pc };

    case 0b010: // (An)
      address = state.A[reg] & 0xffff;
      value = readForSize(memory, address, size);
      return { info: { value, address, extWords }, newPc: pc };

    case 0b011: // (An)+
      address = state.A[reg] & 0xffff;
      value = readForSize(memory, address, size);
      state.A[reg] = (state.A[reg] + (size === 8 ? 2 : size === 16 ? 2 : 4)) >>> 0;
      return { info: { value, address, extWords }, newPc: pc };

    case 0b100: // -(An)
      state.A[reg] = (state.A[reg] - (size === 8 ? 2 : size === 16 ? 2 : 4)) >>> 0;
      address = state.A[reg] & 0xffff;
      value = readForSize(memory, address, size);
      return { info: { value, address, extWords }, newPc: pc };

    case 0b111: {
      if (reg === 0b100) { // #imm
        if (size === 8) {
          extWords.push(readWord(memory, pc));
          value = signExtend8(extWords[0] & 0xff);
          return { info: { value, address: -1, extWords }, newPc: pc + 2 };
        }
        if (size === 16) {
          extWords.push(readWord(memory, pc));
          value = signExtend16(extWords[0]);
          return { info: { value, address: -1, extWords }, newPc: pc + 2 };
        }
        // size === 32: dos extension words
        extWords.push(readWord(memory, pc));
        extWords.push(readWord(memory, pc + 2));
        value = ((extWords[0] << 16) | extWords[1]) >>> 0;
        return { info: { value, address: -1, extWords }, newPc: pc + 4 };
      }
      if (reg === 0b000) { // (xxx).W
        extWords.push(readWord(memory, pc));
        address = extWords[0] & 0xffff;
        value = readForSize(memory, address, size);
        return { info: { value, address, extWords }, newPc: pc + 2 };
      }
      if (reg === 0b001) { // (xxx).L
        extWords.push(readWord(memory, pc));
        extWords.push(readWord(memory, pc + 2));
        address = ((extWords[0] << 16) | extWords[1]) >>> 0;
        address &= 0xffff; // simulador de 64KB
        value = readForSize(memory, address, size);
        return { info: { value, address, extWords }, newPc: pc + 4 };
      }
      // Otros (PC-relative, indexed) no en v1.
      return { info: { value: 0, address: -1, extWords }, newPc: pc, error: 'EA no soportada' };
    }

    default:
      // mode 101, 110 no en v1
      return { info: { value: 0, address: -1, extWords }, newPc: pc, error: 'EA no soportada' };
  }
}

/**
 * Escribe un valor en una EA previamente decodificada (o pasada por dirección).
 * Para modes que no tienen dirección (Dn, An, #imm), se ignora o se escribe
 * en el registro correspondiente.
 */
export function writeEa(
  state: M68kCPUState,
  memory: Memory,
  mode: number,
  reg: number,
  size: 8 | 16 | 32,
  value: number,
  address: number,
): void {
  const v = mask(value, size);
  switch (mode) {
    case 0b000: // Dn
      state.D[reg] = (state.D[reg] & ~((size === 32 ? 0xffffffff : (1 << size) - 1))) | v;
      return;
    case 0b001: // An
      state.A[reg] = v >>> 0;
      return;
    case 0b010: // (An)
      writeForSize(memory, address & 0xffff, size, v);
      return;
    case 0b011: // (An)+
      writeForSize(memory, address & 0xffff, size, v);
      state.A[reg] = (state.A[reg] + (size === 8 ? 2 : size === 16 ? 2 : 4)) >>> 0;
      return;
    case 0b100: // -(An)
      writeForSize(memory, address & 0xffff, size, v);
      return;
    default:
      // Para EAs absolutas en v1 también soportamos escritura.
      if (mode === 0b111 && (reg === 0b000 || reg === 0b001)) {
        writeForSize(memory, address & 0xffff, size, v);
        return;
      }
      return;
  }
}

function readForSize(memory: Memory, addr: number, size: 8 | 16 | 32): number {
  if (size === 8) return readByte(memory, addr);
  if (size === 16) return readWord(memory, addr);
  return readLong(memory, addr);
}

function writeForSize(memory: Memory, addr: number, size: 8 | 16 | 32, value: number): void {
  if (size === 8) { writeByte(memory, addr, value); return; }
  if (size === 16) { writeWord(memory, addr, value); return; }
  writeLong(memory, addr, value);
}

/** Heurística muy conservadora para estimar extension words de un opcode no implementado.
 *  Útil para que el stub `notImplemented` avance el PC sin caer en un bucle infinito.
 *  Peek: lee hasta 6 words siguientes; paramos si encontramos algo "razonable".
 */
export function estimateExtensionWords(opcodeWord: number, memory: Memory, pcAfterOpcode: number): number {
  // Para MOVE.L con EA inmediata de 32 bits (modo 111 reg 100) hacen falta 2 ext words;
  // para MOVE.W con #imm son 1. No tenemos cómo saberlo sin decodificar de verdad,
  // así que devolvemos 0 por defecto (será 0 en muchos casos simples).
  // Casos típicos que SÍ sabemos:
  const op = opcodeWord;
  const sizeBits = (op >> 6) & 0x3;
  const dstMode = (op >> 3) & 0x7;
  // Si el opcode parece MOVE/ADD/SUB/CMP/AND/OR con destino #imm-like → 0 (no se permite).
  // Si tiene dstMode = 0b111 con reg 0b100 (#imm) → 1 o 2 ext words según size.
  if (dstMode === 0b111 && (op & 0x7) === 0b100) {
    // src es #imm
    return sizeBits === 2 ? 2 : 1; // .L -> 2, .W/.B -> 1
  }
  // EA absoluto (111 reg 000) → 1 ext; absoluto long (111 reg 001) → 2.
  if (dstMode === 0b111 && (op & 0x7) === 0b000) return 1;
  if (dstMode === 0b111 && (op & 0x7) === 0b001) return 2;
  void memory; void pcAfterOpcode;
  return 0;
}
