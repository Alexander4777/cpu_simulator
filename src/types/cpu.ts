// cpu.ts — tipos para el simulador M68K
//
// Migración desde la ISA custom de 16 bits hacia Motorola 68000, donde:
//   - Memoria es byte-addressable, 64KB
//   - 8 registros de datos (D0..D7) de 32 bits
//   - 8 registros de dirección (A0..A7) de 32 bits; A7 actúa como SP
//   - SR (Status Register) con byte alto (T1,T0,S,I,M) y byte bajo = CCR
//   - CCR: X=bit4, N=bit3, Z=bit2, V=bit1, C=bit0
//
// El espacio de opcodes son 16 bits y se resuelven en JUMP_TABLE
// (ver src/utils/opcodeTable.ts).

/** Tamaño de memoria: 64KB. Direcciones por encima se truncan con `& 0xffff`. */
export const MEMORY_SIZE = 0x10000;

/** Memoria byte-addressable. */
export type Memory = Uint8Array;

export interface CCR {
  /** Extend flag — copiado de C por ADD/SUB/ROx/NEGX. */
  X: 0 | 1;
  /** Negative. */
  N: 0 | 1;
  /** Zero. */
  Z: 0 | 1;
  /** Overflow (signed). */
  V: 0 | 1;
  /** Carry (unsigned) / borrow (sub). */
  C: 0 | 1;
}

export interface SR {
  T1: 0 | 1;       // Trace
  T0: 0 | 1;
  S: 0 | 1;        // Supervisor (1 = supervisor)
  I: number;       // Interrupt mask, 3 bits (0..7)
  M: 0 | 1;        // Master/interrupt state
  ccr: CCR;
}

export interface M68kCPUState {
  PC: number;       // Program Counter (24 bits en M68K real; aquí usamos 32 sin signo)
  D: Uint32Array;   // D0..D7 (32 bits cada uno)
  A: Uint32Array;   // A0..A7 (32 bits; A7 = SP)
  SR: SR;
  /** Pedagógicos: dirección y valor leídos en el último fetch. */
  MAR: number;
  MBR: number;
  /** Opcode word actual. */
  IR: number;
}

export interface M68kInstruction {
  /** Dirección (en bytes) de la instrucción. */
  address: number;
  /** Opcode word de 16 bits. */
  opcodeWord: number;
  /** Extension words (16 bits cada uno) que acompañan al opcode. */
  extensionWords: number[];
  /** Nombre del handler CSV (p.ej. "m68k_op_move_16_d_d"). */
  handlerName: string;
  /** Ciclos consumidos (del CSV). */
  cycles: number;
  /** Texto decodificado legible (p.ej. "MOVE.W D0,D1"). */
  decoded?: string;
  /** Etiqueta opcional (p.ej. cuando el desensamblado es parcial). */
  label?: string;
}

export interface AssemblerResult {
  binary: Uint8Array;
  /** Lista de instrucciones con metadatos para mostrar en UI. */
  instructions: M68kInstruction[];
  errors: string[];
  /** Direcciones de etiquetas (label → byte address). */
  labels: Record<string, number>;
}

export interface CPUExecutionState {
  cpu: M68kCPUState;
  memory: Memory;
  output: string[];
  halted: boolean;
  currentInstruction?: M68kInstruction;
  cycleCount: number;
}

/** Descripciones en español para mostrar en el panel de registros. */
export const REGISTER_DESCRIPTIONS: Record<string, string> = {
  D0: 'Registro de datos 0 (32 bits)',
  D1: 'Registro de datos 1',
  D2: 'Registro de datos 2',
  D3: 'Registro de datos 3',
  D4: 'Registro de datos 4',
  D5: 'Registro de datos 5',
  D6: 'Registro de datos 6',
  D7: 'Registro de datos 7',
  A0: 'Registro de dirección 0',
  A1: 'Registro de dirección 1',
  A2: 'Registro de dirección 2',
  A3: 'Registro de dirección 3',
  A4: 'Registro de dirección 4',
  A5: 'Registro de dirección 5',
  A6: 'Registro de dirección 6 (puntero de marco)',
  A7: 'Registro de dirección 7 / Puntero de pila (SP)',
  PC: 'Contador de programa',
  SR: 'Registro de estado (CCR: X N Z V C)',
  MAR: 'Registro de dirección de memoria (último acceso)',
  MBR: 'Registro de buffer de memoria (último valor)',
  IR: 'Registro de instrucción (opcode word actual)',
};

/** Estado inicial del CPU M68K. */
export function makeInitialCCR(): CCR {
  return { X: 0, N: 0, Z: 0, V: 0, C: 0 };
}

export function makeInitialSR(): SR {
  return {
    T1: 0,
    T0: 0,
    S: 1,            // forzar supervisor para que STOP funcione
    I: 7,            // todas las interrupciones enmascaradas (estado STOP)
    M: 1,
    ccr: makeInitialCCR(),
  };
}

export function createInitialCPUState(): M68kCPUState {
  return {
    PC: 0,
    D: new Uint32Array(8),
    A: new Uint32Array(8),
    SR: makeInitialSR(),
    MAR: 0,
    MBR: 0,
    IR: 0,
  };
}

export function createInitialMemory(): Memory {
  return new Uint8Array(MEMORY_SIZE);
}
