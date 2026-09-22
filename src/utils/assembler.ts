import type { Instruction, InstructionOpcode, AssemblerResult } from '../types/cpu';
import { OPCODE_MAP, INSTRUCTION_NAMES } from '../types/cpu';

// Ensamblador simple para el CPU Simulator

export function assemble(code: string): AssemblerResult {
  const lines = code.split('\n');
  const instructions: Instruction[] = [];
  const binary: number[] = [];
  const errors: string[] = [];
  let address = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Ignorar comentarios y líneas vacías
    if (!line || line.startsWith(';') || line.startsWith('//')) {
      continue;
    }

    // Eliminar comentarios
    const commentIdx = line.indexOf(';');
    const cleanLine = commentIdx >= 0 ? line.substring(0, commentIdx).trim() : line;

    if (!cleanLine) continue;

    // Tokenizar
    const tokens = cleanLine.split(/\s+/);
    const mnemonic = tokens[0].toUpperCase();

    // Validar opcode
    if (!INSTRUCTION_NAMES.includes(mnemonic as InstructionOpcode)) {
      errors.push(`Línea ${lineNum}: Opcode desconocido "${mnemonic}"`);
      continue;
    }

    const opcode = mnemonic as InstructionOpcode;
    let operand = 0;

    // Parsear operando (si existe)
    if (tokens.length > 1) {
      const operandStr = tokens[1];

      // Manejar etiquetas o direcciones hex
      if (operandStr.startsWith('0x') || operandStr.startsWith('0X')) {
        operand = parseInt(operandStr, 16);
      } else if (/^\d+$/.test(operandStr)) {
        operand = parseInt(operandStr, 10);
      } else {
        errors.push(`Línea ${lineNum}: Operando inválido "${operandStr}"`);
        continue;
      }

      // Validar rango
      if (operand < 0 || operand > 255) {
        errors.push(`Línea ${lineNum}: Operando fuera de rango (0-255)`);
        continue;
      }
    }

    // Ensamblar instrucción (16 bits: opcode 4 bits + operando 8 bits + unused 4 bits)
    const instructionBinary = (OPCODE_MAP[opcode] << 12) | (operand << 4);
    const highByte = (instructionBinary >> 8) & 0xFF;
    const lowByte = instructionBinary & 0xFF;

    instructions.push({
      opcode,
      operand,
      raw: line,
      address,
    });

    binary.push(highByte);
    binary.push(lowByte);

    address++;
  }

  return { instructions, binary, errors };
}

// Desensamblador: convierte binario a instrucciones
export function disassemble(binary: number[], startAddress = 0): Instruction[] {
  const instructions: Instruction[] = [];

  for (let i = 0; i < binary.length; i += 2) {
    if (i + 1 >= binary.length) break;

    const highByte = binary[i];
    const lowByte = binary[i + 1];
    const word = (highByte << 8) | lowByte;

    const opcodeBits = (word >> 12) & 0xF;
    const operand = (word >> 4) & 0xFF;

    // Buscar opcode对应的指令
    const opcodeName = Object.entries(OPCODE_MAP).find(
      ([, v]) => v === opcodeBits
    )?.[0] as InstructionOpcode | undefined;

    if (opcodeName) {
      instructions.push({
        opcode: opcodeName,
        operand,
        raw: `${opcodeName} ${operand}`,
        address: startAddress + Math.floor(i / 2),
      });
    }
  }

  return instructions;
}

// Formatear valor como binario de 8 bits
export function toBinaryString(value: number): string {
  return (value & 0xFF).toString(2).padStart(8, '0');
}

// Formatear valor como hex de 2 dígitos
export function toHexString(value: number): string {
  return (value & 0xFF).toString(16).padStart(2, '0').toUpperCase();
}

// Programa de ejemplo: sumar 5 + 3
export const EXAMPLE_PROGRAM = `; Datos
MOV 5      ; Primer operando (5)
STORE 0x10      
MOV 3      ; Segundo operando (3)
STORE 0x11

; Programa de ejemplo: 5 + 3
LOAD 0x10  ; Cargar valor de dirección 0x10
ADD 0x11    ; Sumar valor de dirección 0x11
OUT         ; Mostrar resultado
HLT         ; Terminar`;

// Programa factorial
export const FACTORIAL_PROGRAM = `; Programa factorial de 5
LOAD 0x10   ; Cargar n (5)
STORE 0x20  ; Almacenar en dirección de resultado
ADD 0xFF    ; Decrementar
JZ 0x0A     ; Si es 0, saltar al final
STORE 0x20  ; Almacenar resultado parcial
JMP 0x02    ; Volver al inicio
OUT         ; Mostrar resultado
HLT
0x10 5      ; n = 5`;