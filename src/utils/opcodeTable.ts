// opcodeTable.ts
//
// Construye las tablas de despacho (jump table + cycles table) usando el
// algoritmo de 7 bucles descrito en `table_builder.txt`. Replica
// `m68ki_build_opcode_table` del Musashi/MAME.
//
// Las filas proceden de `src/m68k/data/opcodes.ts`, que es generado a
// partir del CSV (`opcodes.csv`) por `scripts/buildOpcodes.mjs`. El CSV
// es la fuente de verdad; el módulo TS lo refleja pre-parseado.
//
// IMPORTANTE: el CSV NO incluye una fila centinela (0xffff, 0xffff, ...).
// `withIllegalSentinel` la añade sintéticamente para que el 7º bucle
// `while` del algoritmo pueda terminar de forma segura. Quitar esa fila
// provoca un out-of-bounds.

import { OPCODES, type OpcodeRow } from '../m68k/data/opcodes';

// Tamaño fijo del espacio de opcodes M68K (16 bits).
const TABLE_SIZE = 0x10000;
const ILLEGAL_HANDLER = 'm68k_op_illegal';

/**
 * Devuelve la lista de filas con la sentinela sintética añadida al final.
 */
function withIllegalSentinel(rows: readonly OpcodeRow[]): OpcodeRow[] {
  return [
    ...rows,
    { fn: ILLEGAL_HANDLER, mask: 0xffff, match: 0xffff, cycles: 4 },
  ];
}

/**
 * Construye las tablas de despacho (jump table y cycles table) usando el
 * mismo algoritmo de 7 bucles que m68ki_build_opcode_table.
 */
function buildOpcodeTable(rows: readonly OpcodeRow[]) {
  const jump = new Uint16Array(TABLE_SIZE);
  const cycles = new Uint16Array(TABLE_SIZE);

  // 1. Default todo a illegal con 4 ciclos (idéntico al original en C).
  for (let i = 0; i < TABLE_SIZE; i++) {
    jump[i] = 0; // será rescrito si aparece m68k_op_illegal explícito
    cycles[i] = 4;
  }

  // 2. Mapa fn → índice estable, en orden de aparición.
  const indexByName = new Map<string, number>();
  const names: string[] = [];
  for (const r of rows) {
    if (!indexByName.has(r.fn)) {
      indexByName.set(r.fn, names.length);
      names.push(r.fn);
    }
  }
  // Garantizamos que el handler illegal tenga un índice conocido.
  if (!indexByName.has(ILLEGAL_HANDLER)) {
    indexByName.set(ILLEGAL_HANDLER, names.length);
    names.push(ILLEGAL_HANDLER);
  }
  const illegalIndex = indexByName.get(ILLEGAL_HANDLER)!;
  for (let i = 0; i < TABLE_SIZE; i++) jump[i] = illegalIndex;

  let oi = 0;

  // Bucle (a): mask != 0xff00, != 0xf1f8, != 0xfff0, != 0xf1ff, != 0xfff8, != 0xffff.
  // Caso general: si (i & mask) == match, esta fila pinta su handler.
  while (oi < rows.length) {
    const r = rows[oi];
    if (
      r.mask === 0xff00 ||
      r.mask === 0xf1f8 ||
      r.mask === 0xfff0 ||
      r.mask === 0xf1ff ||
      r.mask === 0xfff8 ||
      r.mask === 0xffff
    ) {
      break;
    }
    const h = indexByName.get(r.fn)!;
    for (let i = 0; i < TABLE_SIZE; i++) {
      if ((i & r.mask) === r.match) {
        jump[i] = h;
        cycles[i] = r.cycles;
      }
    }
    oi++;
  }

  // Bucle (b): mask == 0xff00 — bits 15..8 fijos, byte bajo libre.
  while (oi < rows.length && rows[oi].mask === 0xff00) {
    const r = rows[oi];
    const h = indexByName.get(r.fn)!;
    for (let i = 0; i <= 0xff; i++) {
      jump[r.match | i] = h;
      cycles[r.match | i] = r.cycles;
    }
    oi++;
  }

  // Bucle (c): mask == 0xf1f8 — bit 9 + bits 0..2 libres.
  while (oi < rows.length && rows[oi].mask === 0xf1f8) {
    const r = rows[oi];
    const h = indexByName.get(r.fn)!;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const instr = r.match | (i << 9) | j;
        jump[instr] = h;
        cycles[instr] = r.cycles;
      }
    }
    oi++;
  }

  // Bucle (d): mask == 0xfff0 — nibble bajo libre.
  while (oi < rows.length && rows[oi].mask === 0xfff0) {
    const r = rows[oi];
    const h = indexByName.get(r.fn)!;
    for (let i = 0; i <= 0x0f; i++) {
      jump[r.match | i] = h;
      cycles[r.match | i] = r.cycles;
    }
    oi++;
  }

  // Bucle (e): mask == 0xf1ff — bit 9 libre, byte bajo fijo.
  while (oi < rows.length && rows[oi].mask === 0xf1ff) {
    const r = rows[oi];
    const h = indexByName.get(r.fn)!;
    for (let i = 0; i <= 0x07; i++) {
      jump[r.match | (i << 9)] = h;
      cycles[r.match | (i << 9)] = r.cycles;
    }
    oi++;
  }

  // Bucle (f): mask == 0xfff8 — 3 bits bajos libres.
  while (oi < rows.length && rows[oi].mask === 0xfff8) {
    const r = rows[oi];
    const h = indexByName.get(r.fn)!;
    for (let i = 0; i <= 0x07; i++) {
      jump[r.match | i] = h;
      cycles[r.match | i] = r.cycles;
    }
    oi++;
  }

  // Bucle (g): mask == 0xffff — match exacto. La sentinela (0xffff,0xffff) corta.
  while (oi < rows.length && rows[oi].mask === 0xffff && rows[oi].match !== 0xffff) {
    const r = rows[oi];
    const h = indexByName.get(r.fn)!;
    jump[r.match] = h;
    cycles[r.match] = r.cycles;
    oi++;
  }

  return { jump, cycles, names, indexByName };
}

const built = buildOpcodeTable(withIllegalSentinel(OPCODES));

/** Tabla de despacho: opcodeWord (16 bits) → índice en HANDLER_NAMES. */
export const JUMP_TABLE: Uint16Array = built.jump;
/** Ciclos por opcode (16 bits) según el CSV. */
export const CYCLES_TABLE: Uint16Array = built.cycles;
/** Lista de nombres de handler en el mismo orden que los índices de JUMP_TABLE. */
export const HANDLER_NAMES: string[] = built.names;
/** Mapa nombre→índice para construir handlers.ts. */
export const HANDLER_INDEX: Map<string, number> = built.indexByName;

/** Devuelve el nombre del handler asociado a un opcodeWord, o 'm68k_op_illegal'. */
export function handlerNameFor(opcodeWord: number): string {
  const idx = JUMP_TABLE[opcodeWord & 0xffff];
  return HANDLER_NAMES[idx] ?? ILLEGAL_HANDLER;
}

/** Devuelve los ciclos del CSV para un opcodeWord concreto. */
export function cyclesFor(opcodeWord: number): number {
  return CYCLES_TABLE[opcodeWord & 0xffff];
}
