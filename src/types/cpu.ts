// Tipos para el simulador de CPU

export type RegisterName = 'PC' | 'MAR' | 'MBR' | 'IR' | 'ACC' | 'X' | 'Y' | 'FLAGS';

export interface Register {
  name: RegisterName;
  value: number;
  description: string;
}

export interface Flags {
  Z: boolean; // Zero
  N: boolean; // Negative
  C: boolean; // Carry
}

export interface CPUState {
  PC: number;   // Program Counter
  MAR: number;  // Memory Address Register
  MBR: number;  // Memory Buffer Register
  IR: number;   // Instruction Register
  ACC: number;  // Accumulator
  X: number;    // Register X
  Y: number;    // Register Y
  FLAGS: Flags;
}

export interface MemoryCell {
  address: number;
  value: number;
}

export type Memory = number[]; // 256 bytes

export type InstructionOpcode =
  | 'LOAD'  // 0001
  | 'STORE' // 0010
  | 'ADD'   // 0011
  | 'SUB'   // 0100
  | 'AND'   // 0101
  | 'OR'    // 0110
  | 'NOT'   // 0111
  | 'JMP'   // 1000
  | 'JZ'    // 1001
  | 'JN'    // 1010
  | 'IN'    // 1011
  | 'OUT'   // 1100
  | 'HLT'   // 1101
  | 'MOV';  // 1110

export interface Instruction {
  opcode: InstructionOpcode;
  operand: number;
  raw: string;
  address: number;
}

export interface AssemblerResult {
  instructions: Instruction[];
  binary: number[];
  errors: string[];
}

export interface ExecutionResult {
  state: CPUState;
  memory: Memory;
  output: string[];
  halted: boolean;
  error?: string;
}

export interface CPUExecutionState {
  cpu: CPUState;
  memory: Memory;
  output: string[];
  halted: boolean;
  currentInstruction?: Instruction;
  cycleCount: number;
}

export const OPCODE_MAP: Record<InstructionOpcode, number> = {
  LOAD: 0b0001,
  STORE: 0b0010,
  ADD: 0b0011,
  SUB: 0b0100,
  AND: 0b0101,
  OR: 0b0110,
  NOT: 0b0111,
  JMP: 0b1000,
  JZ: 0b1001,
  JN: 0b1010,
  IN: 0b1011,
  OUT: 0b1100,
  HLT: 0b1101,
  MOV: 0b1110,
};

export const INSTRUCTION_NAMES: InstructionOpcode[] = [
  'LOAD', 'STORE', 'ADD', 'SUB', 'AND', 'OR', 'NOT', 'JMP', 'JZ', 'JN', 'IN', 'OUT', 'HLT', 'MOV'
];

export const REGISTER_DESCRIPTIONS: Record<RegisterName, string> = {
  PC: 'Program Counter - Dirección de la siguiente instrucción',
  MAR: 'Memory Address Register - Dirección de memoria a acceder',
  MBR: 'Memory Buffer Register - Datos leídos/escritos de memoria',
  IR: 'Instruction Register - Instrucción actual',
  ACC: 'Accumulator - Registro principal de operaciones',
  X: 'Registro auxiliar X',
  Y: 'Registro auxiliar Y',
  FLAGS: 'Registro de banderas (Z=Zero, N=Negative, C=Carry)',
};