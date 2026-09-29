import React from 'react';
import type { M68kCPUState } from '../types/cpu';
import { REGISTER_DESCRIPTIONS } from '../types/cpu';
import { toHexString, toBinaryString } from '../utils/assembler';
import { ccrToByte } from '../m68k/flags';
import './RegisterPanel.css';

interface RegisterPanelProps {
  cpu: M68kCPUState;
}

interface RegDisplayProps {
  name: string;
  value: number;
  description: string;
  highlighted?: boolean;
  width?: 2 | 4 | 8;
}

function RegDisplay({ name, value, description, highlighted, width = 8 }: RegDisplayProps) {
  return (
    <div className={`register ${highlighted ? 'highlighted' : ''}`}>
      <div className="register-header">
        <span className="register-name">{name}</span>
        <span className="register-value">0x{toHexString(value, width)}</span>
      </div>
      <div className="register-binary">{toBinaryString(value >>> 0, width * 4)}</div>
      <div className="register-desc">{description}</div>
    </div>
  );
}

export const RegisterPanel: React.FC<RegisterPanelProps> = ({ cpu }) => {
  const dataRegs = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
    name: `D${i}`,
    value: cpu.D[i],
    desc: REGISTER_DESCRIPTIONS[`D${i}`],
  }));
  const addrRegs = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
    name: i === 7 ? 'A7/SP' : `A${i}`,
    value: cpu.A[i],
    desc: REGISTER_DESCRIPTIONS[`A${i}`],
  }));
  const ccrByte = ccrToByte(cpu.SR.ccr);

  return (
    <div className="register-panel">
      <h3>Registros</h3>
      <div className="registers-section">
        <div className="section-label">Datos</div>
        <div className="registers-grid">
          {dataRegs.map(r => (
            <RegDisplay
              key={r.name}
              name={r.name}
              value={r.value}
              description={r.desc}
              width={8}
            />
          ))}
        </div>
      </div>
      <div className="registers-section">
        <div className="section-label">Direcciones</div>
        <div className="registers-grid">
          {addrRegs.map(r => (
            <RegDisplay
              key={r.name}
              name={r.name}
              value={r.value}
              description={r.desc}
              width={8}
            />
          ))}
        </div>
      </div>
      <div className="registers-section">
        <div className="section-label">Control</div>
        <div className="registers-grid">
          <RegDisplay
            name="PC"
            value={cpu.PC}
            description={REGISTER_DESCRIPTIONS.PC}
            highlighted
            width={4}
          />
          <RegDisplay
            name="SR"
            value={ccrByte}
            description={`${REGISTER_DESCRIPTIONS.SR} (CCR=0x${toHexString(ccrByte, 2)})`}
            highlighted
            width={2}
          />
        </div>
        <div className="ccr-chips" aria-label="CCR bits">
          <span className={`flag ${cpu.SR.ccr.X ? 'set' : ''}`} title="Extend">X</span>
          <span className={`flag ${cpu.SR.ccr.N ? 'set' : ''}`} title="Negative">N</span>
          <span className={`flag ${cpu.SR.ccr.Z ? 'set' : ''}`} title="Zero">Z</span>
          <span className={`flag ${cpu.SR.ccr.V ? 'set' : ''}`} title="Overflow">V</span>
          <span className={`flag ${cpu.SR.ccr.C ? 'set' : ''}`} title="Carry">C</span>
        </div>
      </div>
      <div className="registers-section">
        <div className="section-label">Bus (último acceso)</div>
        <div className="registers-grid">
          <RegDisplay name="IR" value={cpu.IR} description={REGISTER_DESCRIPTIONS.IR} width={4} />
          <RegDisplay name="MAR" value={cpu.MAR} description={REGISTER_DESCRIPTIONS.MAR} width={4} />
          <RegDisplay name="MBR" value={cpu.MBR} description={REGISTER_DESCRIPTIONS.MBR} width={4} />
        </div>
      </div>
    </div>
  );
};
