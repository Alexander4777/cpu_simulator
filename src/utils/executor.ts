import type { CPUState, Memory, CPUExecutionState, Flags } from '../types/cpu';

const MEMORY_SIZE = 256;

// Estado inicial del CPU
export function createInitialCPUState(): CPUState {
  return {
    PC: 0,
    MAR: 0,
    MBR: 0,
    IR: 0,
    ACC: 0,
    X: 0,
    Y: 0,
    FLAGS: { Z: false, N: false, C: false },
  };
}

// Crear memoria inicializada a cero
export function createInitialMemory(): Memory {
  return new Array(MEMORY_SIZE).fill(0);
}

// Decodificar opcode desde IR
function decodeOpcode(ir: number): number {
  return (ir >> 12) & 0xF;
}

// Obtener operando desde IR
function getOperand(ir: number): number {
  return (ir >> 4) & 0xFF;
}

// Actualizar flags basándose en el valor del acumulador
function updateFlags(_flags: Flags, value: number): Flags {
  const v = value & 0xFF; // Solo 8 bits
  return {
    Z: v === 0,
    N: (v & 0x80) !== 0, // Bit más significativo
    C: value > 255 || value < 0, // Carry para operaciones aritméticas
  };
}

// Cargar binario en memoria
export function loadProgram(memory: Memory, binary: number[]): Memory {
  const newMemory = [...memory];
  for (let i = 0; i < binary.length && i < MEMORY_SIZE; i++) {
    newMemory[i] = binary[i];
  }
  return newMemory;
}

// Fetch: obtener instrucción de memoria
function fetchInstruction(state: CPUState, memory: Memory): { instruction: number; newState: CPUState } {
  const mar = state.PC;
  const mbr = (memory[mar * 2] << 8) | (memory[mar * 2 + 1] || 0);
  return {
    instruction: mbr,
    newState: { ...state, MAR: mar, MBR: mbr, IR: mbr, PC: state.PC + 1 },
  };
}

// Ejecutar una instrucción
function executeInstruction(
  state: CPUState,
  memory: Memory,
  output: string[],
  inputValue: number | null
): { newState: CPUState; newMemory: Memory; newOutput: string[]; halted: boolean } {
  const opcode = decodeOpcode(state.IR);
  const operand = getOperand(state.IR);
  let newState = { ...state };
  let newMemory = [...memory];
  let newOutput = [...output];
  let halted = false;

  switch (opcode) {
    case 0b0001: // LOAD
      newState.ACC = memory[operand] || 0;
      newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
      break;

    case 0b0010: // STORE
      newMemory[operand] = newState.ACC & 0xFF;
      break;

    case 0b0011: // ADD
      {
        const value = memory[operand] || 0;
        const result = newState.ACC + value;
        newState.ACC = result & 0xFF;
        newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
        newState.FLAGS.C = result > 255;
      }
      break;

    case 0b0100: // SUB
      {
        const value = memory[operand] || 0;
        const result = newState.ACC - value;
        newState.ACC = result & 0xFF;
        newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
        newState.FLAGS.C = result < 0;
      }
      break;

    case 0b0101: // AND
      newState.ACC = newState.ACC & (memory[operand] || 0);
      newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
      break;

    case 0b0110: // OR
      newState.ACC = newState.ACC | (memory[operand] || 0);
      newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
      break;

    case 0b0111: // NOT
      newState.ACC = (~newState.ACC) & 0xFF;
      newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
      break;

    case 0b1000: // JMP
      newState.PC = operand;
      break;

    case 0b1001: // JZ
      if (newState.FLAGS.Z) {
        newState.PC = operand;
      }
      break;

    case 0b1010: // JN
      if (newState.FLAGS.N) {
        newState.PC = operand;
      }
      break;

    case 0b1011: // IN
      if (inputValue !== null) {
        newState.ACC = inputValue & 0xFF;
        newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
      }
      break;

    case 0b1100: // OUT
      newOutput.push(String(newState.ACC));
      break;

    case 0b1101: // HLT
      halted = true;
      break;
    
    case 0b1110: // MOV
      newState.ACC = operand;
      newState.FLAGS = updateFlags(newState.FLAGS, newState.ACC);
      break;

    default:
      break;
  }

  return { newState, newMemory, newOutput, halted };
}

// Ejecutor completo: fetch + decode + execute
export function executeCycle(
  state: CPUState,
  memory: Memory,
  output: string[],
  inputValue: number | null
): { executionState: CPUExecutionState; newState: CPUState; newMemory: Memory; newOutput: string[]; halted: boolean } {
  // Fetch
  const { newState: afterFetch } = fetchInstruction(state, memory);

  // Execute
  const { newState: afterExecute, newMemory, newOutput, halted } = executeInstruction(
    afterFetch,
    memory,
    output,
    inputValue
  );

  const executionState: CPUExecutionState = {
    cpu: afterFetch,
    memory,
    output,
    halted: false,
    cycleCount: state.PC,
  };

  return { executionState, newState: afterExecute, newMemory, newOutput, halted };
}

// Ejecutar programa completo
export function runProgram(
  binary: number[],
  inputValues: number[] = []
): { state: CPUState; memory: Memory; output: string[]; halted: boolean; cycles: number } {
  let state = createInitialCPUState();
  let memory = createInitialMemory();
  memory = loadProgram(memory, binary);
  let output: string[] = [];
  let halted = false;
  let cycles = 0;
  let inputIdx = 0;
  const maxCycles = 1000;

  while (!halted && cycles < maxCycles) {
    const result = executeCycle(state, memory, output, inputValues[inputIdx] ?? null);
    state = result.newState;
    memory = result.newMemory;
    output = result.newOutput;
    halted = result.halted;
    inputIdx++;
    cycles++;

    if (halted) break;
  }

  return { state, memory, output, halted, cycles };
}