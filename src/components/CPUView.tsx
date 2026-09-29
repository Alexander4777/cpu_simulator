import React from 'react';
import { RegisterPanel } from './RegisterPanel';
import { MemoryView } from './MemoryView';
import { InstructionPanel } from './InstructionPanel';
import { OutputPanel } from './OutputPanel';
import { ControlPanel } from './ControlPanel';
import type { M68kCPUState, Memory, M68kInstruction } from '../types/cpu';
import './CPUView.css';

interface CPUViewProps {
  cpu: M68kCPUState;
  memory: Memory;
  instructions: M68kInstruction[];
  output: string[];
  isRunning: boolean;
  isHalted: boolean;
  cycleCount: number;
  onRun: () => void;
  onStep: () => void;
  onReset: () => void;
  onAssemble: () => void;
}

export const CPUView: React.FC<CPUViewProps> = ({
  cpu, memory, instructions, output, isRunning, isHalted, cycleCount,
  onRun, onStep, onReset, onAssemble,
}) => {
  return (
    <div className="cpu-view">
      <h2>CPU Motorola 68000</h2>
      <div className="cpu-container">
        <div className="cpu-left">
          <RegisterPanel cpu={cpu} />
          <ControlPanel
            isRunning={isRunning}
            isHalted={isHalted}
            onRun={onRun}
            onStep={onStep}
            onReset={onReset}
            onAssemble={onAssemble}
            cycleCount={cycleCount}
          />
        </div>
        <div className="cpu-center">
          <InstructionPanel instructions={instructions} currentAddress={cpu.PC} />
          <OutputPanel output={output} />
        </div>
        <div className="cpu-right">
          <MemoryView memory={memory} highlightAddress={cpu.MAR} />
        </div>
      </div>
    </div>
  );
};
