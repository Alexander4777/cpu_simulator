import React from 'react';
import type { Instruction } from '../types/cpu';
import './InstructionPanel.css';

interface InstructionPanelProps {
  instructions: Instruction[];
  currentPC?: number;
}

export const InstructionPanel: React.FC<InstructionPanelProps> = ({ instructions, currentPC }) => {
  return (
    <div className="instruction-panel">
      <h3>Instrucciones</h3>
      {instructions.length === 0 ? (
        <p className="no-instructions">No hay instrucciones cargadas</p>
      ) : (
        <div className="instructions-list">
          {instructions.map((instr, idx) => (
            <div
              key={idx}
              className={`instruction-item ${instr.address === currentPC ? 'current' : ''}`}
            >
              <span className="instr-address">0x{toHexString(instr.address)}</span>
              <span className="instr-opcode">{instr.opcode}</span>
              <span className="instr-operand">
                {instr.operand !== undefined ? `0x${toHexString(instr.operand)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function toHexString(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}