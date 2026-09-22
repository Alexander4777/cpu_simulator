import React from 'react';
import './ControlPanel.css';

interface ControlPanelProps {
  isRunning: boolean;
  isHalted: boolean;
  onRun: () => void;
  onStep: () => void;
  onReset: () => void;
  onAssemble: () => void;
  cycleCount: number;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  isRunning,
  isHalted,
  onRun,
  onStep,
  onReset,
  onAssemble,
  cycleCount,
}) => {
  return (
    <div className="control-panel">
      <h3>Control</h3>
      <div className="control-buttons">
        <button onClick={onAssemble} disabled={isRunning} className="btn btn-assemble">
          Ensamblar
        </button>
        <button onClick={onStep} disabled={isRunning || isHalted} className="btn btn-step">
          Paso
        </button>
        <button onClick={onRun} disabled={isRunning || isHalted} className="btn btn-run">
          {isRunning ? 'Ejecutando...' : 'Ejecutar'}
        </button>
        <button onClick={onReset} className="btn btn-reset">
          Reiniciar
        </button>
      </div>
      <div className="cycle-count">Ciclos: {cycleCount}</div>
    </div>
  );
};