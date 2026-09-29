// assembler.ts — ensamblador M68K mínimo (subset v1).
//
// Sintaxis aceptada (case-insensitive en el mnemónico):
//   NOP
//   MOVEQ   #imm,Dn
//   MOVE.L  #imm32,Dn
//   MOVE.W  src,dst      (Dn, (An), (An)+, -(An), #imm, (abs).W, (abs).L)
//   MOVE.L  src,dst
//   ADDQ    #1..8,Dn    | ADDQ.W #1..8,(An)
//   SUBQ    #1..8,Dn
//   CLR.W   Dn
//   CMP.W   src,Dn
//   BRA.B   label       | BRA.W label
//   BEQ.B   label | BNE.B label | BCC.B label | BCS.B label | BPL.B label | BMI.B label
//   JSR     (An) | JSR label
//   RTS
//   LEA     (An),Ax     | LEA label,Ax
//   STOP    #imm16
//
// Directivas:
//   ORG  addr           — fija la dirección base de ensamblado
//   DC.B v[,v...]       — emite bytes
//   DC.W v[,v...]       — emite words
//   DC.L v[,v...]       — emite longs
//   label:              — captura la dirección actual

import type { AssemblerResult, M68kInstruction } from '../types/cpu';
import { EXAMPLE_M68K_PROGRAM, FACTORIAL_M68K_PROGRAM } from '../m68k/examplePrograms';

const REGS_D = ['D0','D1','D2','D3','D4','D5','D6','D7'];
const REGS_A = ['A0','A1','A2','A3','A4','A5','A6','A7'];

interface AssemblerLine {
  /** Texto original (trimmed, sin comentario). */
  text: string;
  /** Mnemónico en mayúsculas. */
  mnemonic: string;
  /** Tokens del operando (puede ser ['D0','D1'], ['#5','D0'], etc). */
  operands: string[];
  /** Número de línea original (1-based). */
  lineNum: number;
  /** Etiqueta si la línea la trae delante (label:). */
  label?: string;
}

/** Quita comentarios `;` o `//`. */
function stripComment(line: string): string {
  const idx = line.indexOf(';');
  let s = idx >= 0 ? line.substring(0, idx) : line;
  const idx2 = s.indexOf('//');
  if (idx2 >= 0) s = s.substring(0, idx2);
  return s.trim();
}

/** Parsea un número (acepta hex `0x...`, decimal, y el prefijo `$`). */
function parseNum(s: string): number {
  const t = s.trim();
  if (t.startsWith('0x') || t.startsWith('0X')) return parseInt(t.slice(2), 16);
  if (t.startsWith('$')) return parseInt(t.slice(1), 16);
  if (t.startsWith('%')) return parseInt(t.slice(1), 2);
  return parseInt(t, 10);
}

/** Parsea una línea a `AssemblerLine` o devuelve null si vacía. */
function parseLine(raw: string, lineNum: number): AssemblerLine | null {
  const text = stripComment(raw);
  if (!text) return null;
  // Etiqueta delante: "label: mnemónico operandos"
  let label: string | undefined;
  let body = text;
  const colon = text.indexOf(':');
  if (colon >= 0) {
    label = text.substring(0, colon).trim();
    body = text.substring(colon + 1).trim();
    if (!body) {
      // línea con solo etiqueta
      return { text: '', mnemonic: '', operands: [], lineNum, label };
    }
  }
  const tokens = body.split(/\s+/);
  const mnemonic = tokens[0].toUpperCase();
  // Quitar la coma de los operandos.
  const restRaw = tokens.slice(1).join(' ');
  const operands = restRaw.split(',').map(s => s.trim()).filter(Boolean);
  return { text, mnemonic, operands, lineNum, label };
}

/** Primera pasada: recoge etiquetas y calcula el tamaño total. */
function passOne(sourceLines: string[]): { lines: AssemblerLine[]; labels: Record<string, number>; size: number; errors: string[] } {
  const lines: AssemblerLine[] = [];
  const labels: Record<string, number> = {};
  const errors: string[] = [];
  let pc = 0;
  let orgSet = false;

  for (let i = 0; i < sourceLines.length; i++) {
    const ln = parseLine(sourceLines[i], i + 1);
    if (!ln) continue;
    lines.push(ln);
    if (ln.label) labels[ln.label] = pc;
    if (!ln.mnemonic) continue;

    switch (ln.mnemonic) {
      case 'ORG': {
        if (ln.operands.length !== 1) { errors.push(`Línea ${ln.lineNum}: ORG requiere 1 operando`); break; }
        pc = parseNum(ln.operands[0]) & 0xffff;
        orgSet = true;
        break;
      }
      case 'NOP': pc += 2; break;
      case 'MOVEQ': {
        if (ln.operands.length !== 2) { errors.push(`Línea ${ln.lineNum}: MOVEQ requiere 2 operandos`); break; }
        pc += 2; break;
      }
      case 'MOVE.L': {
        if (ln.operands.length !== 2) { errors.push(`Línea ${ln.lineNum}: MOVE.L requiere 2 operandos`); break; }
        const [src, dst] = ln.operands;
        if (src.startsWith('#')) {
          pc += 2 + 4; // opcode + 2 ext words (32 bits)
        } else {
          // Estimación conservadora
          pc += 2 + estimateEaExt(src) * 2;
        }
        void dst;
        break;
      }
      case 'MOVE.W':
      case 'MOVE.B': {
        if (ln.operands.length !== 2) { errors.push(`Línea ${ln.lineNum}: ${ln.mnemonic} requiere 2 operandos`); break; }
        const [src, dst] = ln.operands;
        pc += 2 + estimateEaExt(src) * 2 + estimateEaExt(dst) * 2;
        break;
      }
      case 'ADDQ':
      case 'SUBQ': {
        if (ln.operands.length !== 2) { errors.push(`Línea ${ln.lineNum}: ${ln.mnemonic} requiere 2 operandos`); break; }
        const [imm, dst] = ln.operands;
        if (!imm.startsWith('#')) { errors.push(`Línea ${ln.lineNum}: ${ln.mnemonic} primer operando debe ser #imm`); break; }
        pc += 2 + estimateEaExt(dst) * 2;
        break;
      }
      case 'CLR.W':
      case 'CLR.B':
      case 'CLR.L': {
        if (ln.operands.length !== 1) { errors.push(`Línea ${ln.lineNum}: CLR requiere 1 operando`); break; }
        pc += 2 + estimateEaExt(ln.operands[0]) * 2;
        break;
      }
      case 'CMP.W':
      case 'CMP.B':
      case 'CMP.L': {
        if (ln.operands.length !== 2) { errors.push(`Línea ${ln.lineNum}: CMP requiere 2 operandos`); break; }
        const [src, dst] = ln.operands;
        pc += 2 + estimateEaExt(src) * 2;
        void dst;
        break;
      }
      case 'BRA': case 'BEQ': case 'BNE': case 'BCC': case 'BCS': case 'BPL': case 'BMI':
      case 'BRA.B': case 'BEQ.B': case 'BNE.B': case 'BCC.B': case 'BCS.B': case 'BPL.B': case 'BMI.B': {
        if (ln.operands.length !== 1) { errors.push(`Línea ${ln.lineNum}: branch requiere 1 operando`); break; }
        // Tamaño depende del operando: BRA.B usa 2 bytes (8-bit disp), BRA.W usa 4.
        // Detectamos sufijo: `.B` → 2 bytes, `.W` o nada → 4 bytes por defecto.
        const m = ln.mnemonic;
        if (m.endsWith('.B')) pc += 2;
        else pc += 4; // .W o sin sufijo
        break;
      }
      case 'JSR': {
        if (ln.operands.length !== 1) { errors.push(`Línea ${ln.lineNum}: JSR requiere 1 operando`); break; }
        const op = ln.operands[0];
        if (op.startsWith('(')) pc += 2;
        else if (op.startsWith('#')) { errors.push(`Línea ${ln.lineNum}: JSR no admite inmediato`); break; }
        else pc += 2 + 4; // absoluto largo
        break;
      }
      case 'BSR': case 'BSR.B': case 'BSR.W': {
        if (ln.operands.length !== 1) { errors.push(`Línea ${ln.lineNum}: BSR requiere 1 operando`); break; }
        pc += ln.mnemonic.endsWith('.B') ? 2 : 4;
        break;
      }
      case 'RTS': pc += 2; break;
      case 'LEA': {
        if (ln.operands.length !== 2) { errors.push(`Línea ${ln.lineNum}: LEA requiere 2 operandos`); break; }
        const [src, dst] = ln.operands;
        if (src.startsWith('(')) pc += 2;
        else if (REGS_A.includes(src.toUpperCase())) pc += 2;
        else pc += 2 + 2; // .W (asumimos word)
        void dst;
        break;
      }
      case 'STOP': {
        if (ln.operands.length !== 1 || !ln.operands[0].startsWith('#')) {
          errors.push(`Línea ${ln.lineNum}: STOP requiere #imm`);
          break;
        }
        pc += 2 + 2;
        break;
      }
      case 'DC.B': case 'DC.W': case 'DC.L': {
        if (ln.operands.length < 1) { errors.push(`Línea ${ln.lineNum}: DC.* requiere al menos 1 valor`); break; }
        if (ln.mnemonic === 'DC.B') pc += ln.operands.length;
        else if (ln.mnemonic === 'DC.W') pc += ln.operands.length * 2;
        else pc += ln.operands.length * 4;
        break;
      }
      default:
        errors.push(`Línea ${ln.lineNum}: mnemonic desconocido "${ln.mnemonic}"`);
    }
  }

  void orgSet;
  return { lines, labels, size: pc, errors };
}

function estimateEaExt(op: string): number {
  const s = op.trim();
  if (s.startsWith('#')) return s.startsWith('#$') || s.startsWith('#0x') || s.startsWith('#%') ? 2 : 2;
  if (s.startsWith('(')) {
    if (s.endsWith(').L')) return 2;
    if (s.endsWith(').W')) return 1;
    return 0;
  }
  return 0;
}

/** Emite una word de 16 bits little-endian en el array de bytes. */
function emitWord(bytes: number[], w: number) {
  bytes.push((w >> 8) & 0xff, w & 0xff);
}
function emitLong(bytes: number[], value: number) {
  emitWord(bytes, (value >>> 16) & 0xffff);
  emitWord(bytes, value & 0xffff);
}
function dataReg(s: string): number { return REGS_D.indexOf(s.toUpperCase()); }
function addrReg(s: string): number { return REGS_A.indexOf(s.toUpperCase()); }

/** Encodea MOVE.W/L/B. */
function encodeMove(size: 8 | 16 | 32, src: string, dst: string, lineNum: number, bytes: number[], labels: Record<string, number>, pc: number): { bytes: number; error?: string } {
  const sz = size === 16 ? 0b11 : size === 8 ? 0b01 : 0b10;  // MOVE.B=0001, MOVE.W=0011, MOVE.L=0010
  const dstModeBits = encodeEa(dst, 'dst', lineNum, bytes, labels, pc);
  const srcModeBits = encodeEa(src, 'src', lineNum, bytes, labels, pc);
  if (typeof dstModeBits !== 'number' || typeof srcModeBits !== 'number') {
    return { bytes: -1, error: `Línea ${lineNum}: EA no soportada` };
  }
  const dstMode = dstModeBits & 0x7;
  const dstReg = (dstModeBits >> 4) & 0x7;
  const srcMode = srcModeBits & 0x7;
  const srcReg = (srcModeBits >> 4) & 0x7;
  const op = (sz << 12) | (dstReg << 9) | (dstMode << 6) | (srcMode << 3) | srcReg;
  emitWord(bytes, op);
  return { bytes: 2 };
}

/** Encodea una EA (devuelve reg en high nibble, mode en low). Emite extension words. */
function encodeEa(op: string, role: 'src' | 'dst', _lineNum: number, bytes: number[], labels: Record<string, number>, _pc: number): number | undefined {
  const s = op.trim();
  // Dn
  if (REGS_D.includes(s.toUpperCase())) return (dataReg(s) << 4) | 0b000;
  // An (solo en src)
  if (REGS_A.includes(s.toUpperCase())) {
    if (role === 'dst') return undefined; // An no admite destino MOVE
    return (addrReg(s) << 4) | 0b001;
  }
  // (An)
  let m = /^\(A([0-7])\)$/i.exec(s);
  if (m) return (parseInt(m[1], 10) << 4) | 0b010;
  // (An)+
  m = /^\(A([0-7])\)\+$/i.exec(s);
  if (m) return (parseInt(m[1], 10) << 4) | 0b011;
  // -(An)
  m = /^-\(A([0-7])\)$/i.exec(s);
  if (m) return (parseInt(m[1], 10) << 4) | 0b100;
  // #imm
  if (s.startsWith('#')) {
    const v = parseNum(s.slice(1));
    // emite ext words; el caller sumará a PC.
    if (role === 'dst') return undefined; // no permitido
    if (v >= -128 && v <= 127) {
      emitWord(bytes, v & 0xffff);
      return (0b100 << 4) | 0b111;
    } else if (v >= -32768 && v <= 32767) {
      emitWord(bytes, v & 0xffff);
      return (0b100 << 4) | 0b111;
    } else {
      emitLong(bytes, v >>> 0);
      return (0b100 << 4) | 0b111;
    }
  }
  // (abs).W / (abs).L
  m = /^\((.*)\)\.([WL])$/i.exec(s);
  if (m) {
    const v = resolveLabelOrNum(m[1], labels);
    if (m[2].toUpperCase() === 'W') {
      emitWord(bytes, v & 0xffff);
      return (0b000 << 4) | 0b111;
    } else {
      emitLong(bytes, v & 0xffff);
      return (0b001 << 4) | 0b111;
    }
  }
  // símbolo suelto → tratado como dirección absoluta L
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
    const v = labels[s];
    if (v === undefined) return undefined;
    emitLong(bytes, v & 0xffff);
    return (0b001 << 4) | 0b111;
  }
  return undefined;
}

function resolveLabelOrNum(s: string, labels: Record<string, number>): number {
  const t = s.trim();
  if (t in labels) return labels[t];
  return parseNum(t);
}

/** Encodea ADDQ/SUBQ a Dn (dst mode 000). */
function encodeAddqSubq(_mnemonic: 'ADDQ' | 'SUBQ', imm: string, dst: string, lineNum: number, bytes: number[], labels: Record<string, number>, pc: number): { bytes: number; error?: string } {
  if (!imm.startsWith('#')) return { bytes: -1, error: `Línea ${lineNum}: primer operando debe ser #imm` };
  const n = parseNum(imm.slice(1));
  if (n < 1 || n > 8) return { bytes: -1, error: `Línea ${lineNum}: ADDQ/SUBQ solo admite #1..8` };
  const dstEa = encodeEa(dst, 'dst', lineNum, bytes, labels, pc);
  if (dstEa === undefined) return { bytes: -1, error: `Línea ${lineNum}: EA destino no soportada` };
  const dstMode = dstEa & 0x7;
  const dstReg = (dstEa >> 4) & 0x7;
  // Si dst = An → usa modo 001 (ADDQ a A0..A7), tamaño .W/.L fijo
  if (dstMode === 0b001) {
    const sz = dstReg === 0 ? 0b01 : 0b10; // A7 normalmente .W; aceptamos .L
    const op = (0b0101 << 12) | (dstReg << 9) | ((n & 0x7) << 0) | (sz << 6) | (0b001 << 3) | 0;
    emitWord(bytes, op);
    return { bytes: 2 };
  }
  // Default: size .L para v1
  const sz = 0b10; // .L
  const op = (0b0101 << 12) | (dstReg << 9) | ((n & 0x7) << 0) | (sz << 6) | (dstMode << 3) | 0;
  emitWord(bytes, op);
  return { bytes: 2 };
}

/** Assembler principal. */
export function assemble(code: string): AssemblerResult {
  const sourceLines = code.split(/\r?\n/);
  const p1 = passOne(sourceLines);
  const errors: string[] = [...p1.errors];
  const labels = p1.labels;
  const bytes: number[] = [];
  const instructions: M68kInstruction[] = [];

  // Pasada 2: emisión.
  let pc = 0;
  for (const ln of p1.lines) {
    if (!ln.mnemonic && ln.label) continue; // línea con solo etiqueta
    if (!ln.mnemonic) continue;

    const startByteAddr = pc;
    const beforeBytes = bytes.length;

    switch (ln.mnemonic) {
      case 'ORG': {
        const v = parseNum(ln.operands[0]);
        pc = v & 0xffff;
        break;
      }
      case 'NOP': emitWord(bytes, 0x4e71); pc += 2; break;
      case 'MOVEQ': {
        const imm = parseNum(ln.operands[0].slice(1)) & 0xff;
        const reg = dataReg(ln.operands[1]);
        if (reg < 0) { errors.push(`Línea ${ln.lineNum}: registro destino inválido`); break; }
        emitWord(bytes, 0x7000 | (reg << 9) | imm);
        pc += 2;
        break;
      }
      case 'MOVE.L': {
        const [src, dst] = ln.operands;
        const r = encodeMove(32, src, dst, ln.lineNum, bytes, labels, pc);
        if (r.error) { errors.push(r.error); break; }
        pc += r.bytes;
        break;
      }
      case 'MOVE.W': {
        const [src, dst] = ln.operands;
        const r = encodeMove(16, src, dst, ln.lineNum, bytes, labels, pc);
        if (r.error) { errors.push(r.error); break; }
        pc += r.bytes;
        break;
      }
      case 'MOVE.B': {
        const [src, dst] = ln.operands;
        const r = encodeMove(8, src, dst, ln.lineNum, bytes, labels, pc);
        if (r.error) { errors.push(r.error); break; }
        pc += r.bytes;
        break;
      }
      case 'ADDQ':
      case 'SUBQ': {
        const r = encodeAddqSubq(ln.mnemonic, ln.operands[0], ln.operands[1], ln.lineNum, bytes, labels, pc);
        if (r.error) { errors.push(r.error); break; }
        pc += r.bytes;
        break;
      }
      case 'CLR.W': {
        const r = encodeEa(ln.operands[0], 'dst', ln.lineNum, bytes, labels, pc);
        if (r === undefined) { errors.push(`Línea ${ln.lineNum}: CLR dst no soportada`); break; }
        const dstReg = (r >> 4) & 0x7;
        // CLR.W = 0100 0010 01dd ddd   (mask 0xfff8, base 0x4240)
        emitWord(bytes, 0x4240 | dstReg);
        pc += 2;
        break;
      }
      case 'CMP.W': {
        const [src, dst] = ln.operands;
        const dstReg = dataReg(dst);
        if (dstReg < 0) { errors.push(`Línea ${ln.lineNum}: CMP dst debe ser Dn`); break; }
        const srcEa = encodeEa(src, 'src', ln.lineNum, bytes, labels, pc);
        if (srcEa === undefined) { errors.push(`Línea ${ln.lineNum}: CMP src no soportada`); break; }
        const srcMode = srcEa & 0x7;
        const srcReg = (srcEa >> 4) & 0x7;
        // CMP.W base 0xB040, mask 0xf1f8
        emitWord(bytes, 0xb040 | (dstReg << 9) | (srcMode << 3) | srcReg);
        pc += 2;
        break;
      }
      case 'BRA': case 'BRA.B': case 'BRA.W':
      case 'BEQ': case 'BEQ.B': case 'BEQ.W':
      case 'BNE': case 'BNE.B': case 'BNE.W':
      case 'BCC': case 'BCC.B': case 'BCC.W':
      case 'BCS': case 'BCS.B': case 'BCS.W':
      case 'BPL': case 'BPL.B': case 'BPL.W':
      case 'BMI': case 'BMI.B': case 'BMI.W': {
        const condBase = branchBase(ln.mnemonic);
        const size = ln.mnemonic.endsWith('.B') ? 'B' : 'W';
        const target = resolveLabelOrNum(ln.operands[0], labels);
        const disp = (target - (pc + 2)) & 0xffff;
        const dispSigned = disp > 0x7fff ? disp - 0x10000 : disp;
        if (size === 'B' && dispSigned >= -128 && dispSigned <= 127 && disp !== 0 && disp !== 0xfffe) {
          emitWord(bytes, condBase | (dispSigned & 0xff));
          pc += 2;
        } else {
          // 16-bit disp
          emitWord(bytes, condBase);
          emitWord(bytes, dispSigned & 0xffff);
          pc += 4;
        }
        break;
      }
      case 'JSR': {
        const op = ln.operands[0];
        const m = /^\(A([0-7])\)$/i.exec(op);
        if (m) {
          const r = parseInt(m[1], 10);
          emitWord(bytes, 0x4e90 | r);
          pc += 2;
        } else {
          const target = resolveLabelOrNum(op, labels);
          emitWord(bytes, 0x4eb9);
          emitLong(bytes, target & 0xffff);
          pc += 6;
        }
        break;
      }
      case 'BSR': case 'BSR.B': case 'BSR.W': {
        const target = resolveLabelOrNum(ln.operands[0], labels);
        const disp = (target - (pc + 2)) & 0xffff;
        const dispSigned = disp > 0x7fff ? disp - 0x10000 : disp;
        const size = ln.mnemonic.endsWith('.B') ? 'B' : 'W';
        if (size === 'B' && dispSigned >= -128 && dispSigned <= 127 && disp !== 0 && disp !== 0xfffe) {
          emitWord(bytes, 0x6100 | (dispSigned & 0xff));
          pc += 2;
        } else {
          emitWord(bytes, 0x6100);
          emitWord(bytes, dispSigned & 0xffff);
          pc += 4;
        }
        break;
      }
      case 'RTS': emitWord(bytes, 0x4e75); pc += 2; break;
      case 'LEA': {
        const [src, dst] = ln.operands;
        const dstReg = addrReg(dst);
        if (dstReg < 0) { errors.push(`Línea ${ln.lineNum}: LEA dst debe ser Ax`); break; }
        const m = /^\(A([0-7])\)$/i.exec(src);
        if (m) {
          const r = parseInt(m[1], 10);
          emitWord(bytes, 0x41d0 | (dstReg << 9) | r);
          pc += 2;
        } else {
          const v = resolveLabelOrNum(src, labels);
          emitWord(bytes, 0x41f9);
          emitLong(bytes, v & 0xffff);
          pc += 6;
        }
        break;
      }
      case 'STOP': {
        const v = parseNum(ln.operands[0].slice(1));
        emitWord(bytes, 0x4e72);
        emitWord(bytes, v & 0xffff);
        pc += 4;
        break;
      }
      case 'DC.B': {
        for (const t of ln.operands) {
          const v = parseNum(t) & 0xff;
          bytes.push(v);
          pc += 1;
        }
        break;
      }
      case 'DC.W': {
        for (const t of ln.operands) {
          const v = parseNum(t) & 0xffff;
          emitWord(bytes, v);
          pc += 2;
        }
        break;
      }
      case 'DC.L': {
        for (const t of ln.operands) {
          const v = parseNum(t) >>> 0;
          emitLong(bytes, v);
          pc += 4;
        }
        break;
      }
    }

    // Registra la instrucción para la UI (si emitió algo)
    if (bytes.length > beforeBytes) {
      const wordBytes = bytes.slice(beforeBytes);
      const opcodeWord = ((wordBytes[0] ?? 0) << 8) | (wordBytes[1] ?? 0);
      instructions.push({
        address: startByteAddr,
        opcodeWord,
        extensionWords: chunkWords(wordBytes.slice(2)),
        handlerName: '',
        cycles: 0,
        decoded: ln.text,
        label: ln.label,
      });
    }
  }

  return {
    binary: new Uint8Array(bytes),
    instructions,
    errors,
    labels,
  };
}

function chunkWords(arr: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    out.push(((arr[i] << 8) | arr[i + 1]) & 0xffff);
  }
  return out;
}

function branchBase(mnemonic: string): number {
  const m = mnemonic.split('.')[0];
  switch (m) {
    case 'BRA': return 0x6000;
    case 'BEQ': return 0x6700;
    case 'BNE': return 0x6600;
    case 'BCC': return 0x6400;
    case 'BCS': return 0x6500;
    case 'BPL': return 0x6a00;
    case 'BMI': return 0x6b00;
    default: return 0x6000;
  }
}

// Re-export del ejemplo desde m68k/examplePrograms.ts
export { EXAMPLE_M68K_PROGRAM as EXAMPLE_PROGRAM, FACTORIAL_M68K_PROGRAM as FACTORIAL_PROGRAM };

// Utilidades de formato que usan los componentes.
export function toHexString(value: number, width: 2 | 4 | 8 = 2): string {
  return (value >>> 0).toString(16).padStart(width, '0').toUpperCase();
}
export function toBinaryString(value: number, width = 8): string {
  return (value & ((1 << width) - 1)).toString(2).padStart(width, '0');
}
