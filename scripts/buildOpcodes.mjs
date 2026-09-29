// buildOpcodes.mjs — genera src/m68k/data/opcodes.ts a partir del CSV.
//
// El CSV sigue siendo la fuente de verdad; el módulo TS es una versión
// pre-parseada que Vite/TS pueden consumir directamente sin `?raw` ni
// parsing en tiempo de ejecución. El bundle final incluye 1701 filas
// (~70 KB en formato tuple), pero evita `?raw` y queda tipado.
//
// Uso:
//   node scripts/buildOpcodes.mjs
//
// Salida:
//   src/m68k/data/opcodes.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const csvPath = resolve(root, 'src/m68k/data/opcodes.csv');
const outPath = resolve(root, 'src/m68k/data/opcodes.ts');

const text = readFileSync(csvPath, 'utf8');
const lines = text.split(/\r?\n/);

// Cabecera conocida: `function,mask,match,cycles`. La saltamos.
const rows = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const [fn, maskStr, matchStr, cycStr] = line.split(',');
  if (!fn) continue;
  // Emitimos como tuple inmutable de 4 elementos. Cada columna es
  // constante en módulo-init, así que tipamos con `as const` más abajo.
  rows.push({
    fn,
    mask: parseInt(maskStr, 16) & 0xffff,
    match: parseInt(matchStr, 16) & 0xffff,
    cycles: parseInt(cycStr, 10) | 0,
  });
}

const header = `// opcodes.ts — generado automáticamente desde opcodes.csv.
//
// El CSV es la fuente de verdad; este módulo TS lo refleja pre-parseado
// para que el bundle evite el import \`?raw\` y el parsing en runtime.
// Edita \`opcodes.csv\` y vuelve a ejecutar \`npm run build:datasrc\`
// (o \`node scripts/buildOpcodes.mjs\`).
//
// NO EDITAR MANUALMENTE.

/**
 * Una fila de opcodes.csv.
 *  - \`fn\`: nombre del handler Musashi/MAME (p.ej. \`m68k_op_moveq_32\`).
 *  - \`mask\`: bits que deben coincidir para que la fila aplique.
 *  - \`match\`: valor esperado en esos bits.
 *  - \`cycles\`: ciclos base para ese opcode concreto.
 */
export interface OpcodeRow {
  readonly fn: string;
  readonly mask: number;
  readonly match: number;
  readonly cycles: number;
}

/** Catálogo canónico de opcodes Motorola 68000 en encounter-order del CSV. */
export const OPCODES: readonly OpcodeRow[] = [
`;

const tupleBody = rows
  .map(
    r =>
      `  { fn: ${JSON.stringify(r.fn)}, mask: ${hex(r.mask)}, match: ${hex(r.match)}, cycles: ${r.cycles} },`,
  )
  .join('\n');

const footer = `
] as const;

/** Total de filas del CSV (excluye cabecera). Útil para asserts. */
export const OPCODES_COUNT = ${rows.length};
`;

writeFileSync(outPath, header + tupleBody + footer, 'utf8');

function hex(n) {
  return '0x' + (n & 0xffff).toString(16).padStart(4, '0');
}

console.log(`✓ Generado ${outPath} (${rows.length} filas).`);
