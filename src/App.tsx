import { useState, useCallback } from 'react';
import { CPUView } from './components/CPUView';
import { CodeEditor } from './components/CodeEditor';
import type { CPUState, Instruction, Memory } from './types/cpu';
import { assemble, EXAMPLE_PROGRAM } from './utils/assembler';
import { createInitialCPUState, createInitialMemory, executeCycle, loadProgram } from './utils/executor';
import './App.css';

function App() {
  const [code, setCode] = useState<string>(EXAMPLE_PROGRAM);
  const [cpu, setCpu] = useState<CPUState>(createInitialCPUState());
  const [memory, setMemory] = useState<Memory>(createInitialMemory());
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [output, setOutput] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isHalted, setIsHalted] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);

  const handleAssemble = useCallback(() => {
    const result = assemble(code);
    setErrors(result.errors);

    if (result.errors.length === 0) {
      setInstructions(result.instructions);
      const newMemory = loadProgram(createInitialMemory(), result.binary);
      setMemory(newMemory);
      setCpu(createInitialCPUState());
      setOutput([]);
      setIsHalted(false);
      setCycleCount(0);
    }
  }, [code]);

  const handleStep = useCallback(() => {
    if (isHalted || instructions.length === 0) return;

    const result = executeCycle(cpu, memory, output, null);
    setCpu(result.newState);
    setMemory(result.newMemory);
    setOutput(result.newOutput);
    setIsHalted(result.halted);
    setCycleCount((c) => c + 1);
  }, [cpu, memory, output, isHalted, instructions]);

  const handleRun = useCallback(() => {
    if (isHalted || isRunning) return;
    setIsRunning(true);

    const interval = setInterval(() => {
      setCpu((prevCpu) => {
        if (isHalted) {
          clearInterval(interval);
          setIsRunning(false);
          return prevCpu;
        }

        const result = executeCycle(prevCpu, memory, output, null);
        setMemory(result.newMemory);
        setOutput(result.newOutput);
        setIsHalted(result.halted);
        setCycleCount((c) => c + 1);

        if (result.halted) {
          clearInterval(interval);
          setIsRunning(false);
        }

        return result.newState;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isHalted, isRunning, memory, output]);

  const handleReset = useCallback(() => {
    setCpu(createInitialCPUState());
    setMemory(createInitialMemory());
    setOutput([]);
    setIsHalted(false);
    setIsRunning(false);
    setCycleCount(0);
  }, []);

  return (
    <div className="app">
      <div className="app-header">
        <h1>Simulador de CPU</h1>
        <p>Ensambla y ejecuta programas en un CPU simulado</p>
      </div>
      <div className="app-content">
        <div className="editor-section">
          <CodeEditor code={code} onChange={setCode} errors={errors} />
        </div>
        <div className="simulator-section">
          <CPUView
            cpu={cpu}
            memory={memory}
            instructions={instructions}
            output={output}
            isRunning={isRunning}
            isHalted={isHalted}
            cycleCount={cycleCount}
            onRun={handleRun}
            onStep={handleStep}
            onReset={handleReset}
            onAssemble={handleAssemble}
          />
        </div>
      </div>
    </div>
  );
}

export default App;