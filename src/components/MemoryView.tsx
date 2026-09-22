import React from 'react';
import type { Memory } from '../types/cpu';
import { toHexString } from '../utils/assembler';
import './MemoryView.css';

interface MemoryViewProps {
  memory: Memory;
  highlightAddress?: number;
}

export const MemoryView: React.FC<MemoryViewProps> = ({ memory, highlightAddress }) => {
  const rows = [];
  for (let i = 0; i < 256; i += 16) {
    const cells = [];
    for (let j = 0; j < 16; j++) {
      const addr = i + j;
      const isHighlighted = addr === highlightAddress;
      cells.push(
        <span
          key={addr}
          className={`memory-cell ${isHighlighted ? 'highlighted' : ''}`}
          title={`Dirección: 0x${toHexString(addr)}, Valor: ${memory[addr] || 0}`}
        >
          {toHexString(memory[addr] || 0)}
        </span>
      );
    }
    rows.push(
      <div key={i} className="memory-row">
        <span className="memory-address">0x{toHexString(i)}</span>
        <span className="memory-cells">{cells}</span>
      </div>
    );
  }

  return (
    <div className="memory-view">
      <h3>Memoria (256 bytes)</h3>
      <div className="memory-grid">{rows}</div>
    </div>
  );
};