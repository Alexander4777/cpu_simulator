import React, { useState } from 'react';
import type { Memory } from '../types/cpu';
import { toHexString } from '../utils/assembler';
import './MemoryView.css';

interface MemoryViewProps {
  memory: Memory;
  highlightAddress?: number;
  pageSize?: number;
}

export const MemoryView: React.FC<MemoryViewProps> = ({ memory, highlightAddress, pageSize = 256 }) => {
  const [pageStart, setPageStart] = useState(0);
  // Posiciona la página automáticamente alrededor de la dirección destacada.
  const effectiveStart = highlightAddress !== undefined
    ? Math.floor((highlightAddress & 0xffff) / pageSize) * pageSize
    : pageStart;

  const cells = [];
  for (let i = 0; i < pageSize; i++) {
    const addr = (effectiveStart + i) & 0xffff;
    const isHighlighted = addr === highlightAddress;
    cells.push(
      <span
        key={i}
        className={`memory-cell ${isHighlighted ? 'highlighted' : ''}`}
        title={`Dirección: 0x${toHexString(addr, 4)}, Valor: 0x${toHexString(memory[addr] || 0, 2)}`}
      >
        {toHexString(memory[addr] || 0, 2)}
      </span>
    );
  }

  // Construir filas de 16 celdas para legibilidad.
  const rows = [];
  for (let i = 0; i < pageSize; i += 16) {
    rows.push(
      <div key={i} className="memory-row">
        <span className="memory-address">0x{toHexString((effectiveStart + i) & 0xffff, 4)}</span>
        <span className="memory-cells">{cells.slice(i, i + 16)}</span>
      </div>
    );
  }

  return (
    <div className="memory-view">
      <h3>Memoria (64KB)</h3>
      <div className="memory-controls">
        <button onClick={() => setPageStart(s => Math.max(0, s - pageSize))}>← Anterior</button>
        <span>Página: 0x{toHexString(effectiveStart, 4)}–0x{toHexString((effectiveStart + pageSize - 1) & 0xffff, 4)}</span>
        <button onClick={() => setPageStart(s => Math.min(0xffff - pageSize, s + pageSize))}>Siguiente →</button>
      </div>
      <div className="memory-grid">{rows}</div>
    </div>
  );
};
