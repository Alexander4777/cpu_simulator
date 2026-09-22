import React from 'react';
import type { CPUState, RegisterName } from '../types/cpu';
import { REGISTER_DESCRIPTIONS } from '../types/cpu';
import { toHexString, toBinaryString } from '../utils/assembler';
import './RegisterPanel.css';

interface RegisterPanelProps {
  cpu: CPUState;
}

interface RegisterDisplayProps {
  name: RegisterName;
  value: number;
  description: string;
  highlighted?: boolean;
}

function RegisterDisplay({ name, value, description, highlighted }: RegisterDisplayProps) {
  return (
    <div className={`register ${highlighted ? 'highlighted' : ''}`}>
      <div className="register-header">
        <span className="register-name">{name}</span>
        <span className="register-value">{toHexString(value)}</span>
      </div>
      <div className="register-binary">{toBinaryString(value)}</div>
      <div className="register-desc">{description}</div>
      {name === 'FLAGS' && (
        <div className="flags-bits">
          <span className={`flag ${value & 0x04 ? 'set' : ''}`}>C</span>
          <span className={`flag ${value & 0x02 ? 'set' : ''}`}>N</span>
          <span className={`flag ${value & 0x01 ? 'set' : ''}`}>Z</span>
        </div>
      )}
    </div>
  );
}

export const RegisterPanel: React.FC<RegisterPanelProps> = ({ cpu }) => {
  const registers: RegisterName[] = ['PC', 'MAR', 'MBR', 'IR', 'ACC', 'X', 'Y', 'FLAGS'];

  // Calcular valor de FLAGS como bits combinados
  const flagsValue =
    (cpu.FLAGS.C ? 0x04 : 0) |
    (cpu.FLAGS.N ? 0x02 : 0) |
    (cpu.FLAGS.Z ? 0x01 : 0);

  return (
    <div className="register-panel">
      <h3>Registros</h3>
      <div className="registers-grid">
        {registers.map((name) => (
          <RegisterDisplay
            key={name}
            name={name}
            value={name === 'FLAGS' ? flagsValue : cpu[name]}
            description={REGISTER_DESCRIPTIONS[name]}
            highlighted={name === 'PC' || name === 'ACC'}
          />
        ))}
      </div>
    </div>
  );
};