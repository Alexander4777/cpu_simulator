import React from 'react';
import type { M68kInstruction } from '../types/cpu';
import { toHexString } from '../utils/assembler';
import './InstructionPanel.css';

interface InstructionPanelProps {
  instructions: M68kInstruction[];
  currentAddress?: number;
}

function joinHex(values: number[]): string {
  return values.map(v => toHexString(v, 4)).join(' ');
}

export const InstructionPanel: React.FC<InstructionPanelProps> = ({ instructions, currentAddress }) => {
  return (
    <div className="instruction-panel">
      <h3>Instrucciones</h3>
      {instructions.length === 0 ? (
        <p className="no-instructions">No hay instrucciones cargadas</p>
      ) : (
        <div className="instructions-list">
          {instructions.map((instr, idx) => {
            const allWords = [instr.opcodeWord, ...instr.extensionWords];
            const isCurrent = instr.address === currentAddress;
            return (
              <div
                key={idx}
                className={`instruction-item ${isCurrent ? 'current' : ''}`}
              >
                <span className="instr-address">0x{toHexString(instr.address, 4)}</span>
                <span className="instr-bytes">{joinHex(allWords)}</span>
                <span className="instr-mnemonic">{instr.decoded ?? instr.handlerName ?? '???'}</span>
                <span className="instr-cycles">{instr.cycles > 0 ? `${instr.cycles}c` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
