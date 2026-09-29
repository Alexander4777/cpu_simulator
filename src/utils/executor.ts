// executor.ts — fetch + decode + dispatch contra la jump table del CSV.
//
// Ciclo:
//   1. fetch opcodeWord = readWord(memory, state.PC)
//   2. idx = JUMP_TABLE[opcodeWord]
//   3. handlerName = HANDLER_NAMES[idx]
//   4. cycles = CYCLES_TABLE[opcodeWord]
//   5. handler = HANDLERS[handlerName] ?? notImplemented
//   6. result = handler({ state, memory, output, input, pc, opcodeWord })
//   7. PC avanza al final de la instrucción (el handler es responsable de
//      saltar o caer en STOP/HLT).

import type { CPUExecutionState, Memory, M68kCPUState } from '../types/cpu';
import { createInitialCPUState, createInitialMemory } from '../types/cpu';
import { JUMP_TABLE, CYCLES_TABLE, HANDLER_NAMES, HANDLER_INDEX } from './opcodeTable';
import { getHandler, type HandlerCtx } from '../m68k/handlers';
import { readWord } from '../m68k/decode';

const ILLEGAL = HANDLER_INDEX.get('m68k_op_illegal')!;

/** Carga un programa binario en memoria (Uint8Array) byte a byte. */
export function loadProgram(memory: Memory, binary: Uint8Array): Memory {
  const m = memory.slice();
  m.set(binary.subarray(0, Math.min(binary.length, m.length)));
  return m;
}

/** Ejecuta un único ciclo: fetch + dispatch. */
export function executeCycle(
  state: M68kCPUState,
  memory: Memory,
  output: string[],
  inputValue: number | null,
): {
  executionState: CPUExecutionState;
  newState: M68kCPUState;
  newMemory: Memory;
  newOutput: string[];
  halted: boolean;
} {
  const pc = state.PC & 0xffff;
  const opcodeWord = readWord(memory, pc);
  const hIdx = JUMP_TABLE[opcodeWord];
  const handlerName = HANDLER_NAMES[hIdx] ?? 'm68k_op_illegal';
  const cycles = CYCLES_TABLE[opcodeWord];
  const handler = getHandler(handlerName);

  // Estado pedagógico tras el fetch (antes de ejecutar).
  const fetchedState: M68kCPUState = {
    ...state,
    IR: opcodeWord,
    MAR: pc,
    MBR: opcodeWord,
    // El handler decide si modifica PC; el "PC al inicio" se preserva en pc.
    PC: pc + 2,
  };

  const ctx: HandlerCtx = {
    state: fetchedState,
    memory,
    output,
    input: inputValue,
    pc,
    opcodeWord,
  };

  const result = handler(ctx);

  // El handler puede haber mutado `fetchedState` (que es una copia de `state`).
  const newState: M68kCPUState = result.state;

  const executionState: CPUExecutionState = {
    cpu: fetchedState,
    memory: result.memory,
    output: result.output,
    halted: false,
    currentInstruction: {
      address: pc,
      opcodeWord,
      extensionWords: result.extensionWords,
      handlerName,
      cycles,
      decoded: result.decoded,
    },
    cycleCount: 0, // App.tsx mantiene el acumulado
  };

  return {
    executionState,
    newState,
    newMemory: result.memory,
    newOutput: result.output,
    halted: result.halted,
  };
}

/** Ejecuta un programa completo hasta STOP/HLT/ILLEGAL o `maxCycles`. */
export function runProgram(
  binary: Uint8Array,
  inputValues: number[] = [],
): {
  state: M68kCPUState;
  memory: Memory;
  output: string[];
  halted: boolean;
  cycles: number;
} {
  let state = createInitialCPUState();
  let memory = createInitialMemory();
  memory = loadProgram(memory, binary);
  let output: string[] = [];
  let halted = false;
  let cycles = 0;
  let inputIdx = 0;
  const maxCycles = 5000;

  while (!halted && cycles < maxCycles) {
    const r = executeCycle(state, memory, output, inputValues[inputIdx] ?? null);
    state = r.newState;
    memory = r.newMemory;
    output = r.newOutput;
    halted = r.halted;
    cycles += r.executionState.currentInstruction?.cycles ?? 4;
    inputIdx++;
    if (halted) break;
  }

  return { state, memory, output, halted, cycles };
}

// Re-exportar para uso en componentes.
export { createInitialCPUState, createInitialMemory };

// Garantía estática de que el sentinel existe (referenciado para que el
// compilador no se queje si en algún momento no usamos ILLEGAL).
void ILLEGAL;
