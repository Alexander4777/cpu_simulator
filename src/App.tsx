import { useState, useCallback } from 'react';
import { CPUView } from './components/CPUView';
import { CodeEditor } from './components/CodeEditor';
import type { M68kCPUState, M68kInstruction, Memory } from './types/cpu';
import { createInitialCPUState, createInitialMemory, executeCycle, loadProgram } from './utils/executor';
import { assemble, EXAMPLE_PROGRAM } from './utils/assembler';
import { JUMP_TABLE, CYCLES_TABLE, HANDLER_NAMES } from './utils/opcodeTable';
import './App.css';

function App() {
  const [code, setCode] = useState<string>(EXAMPLE_PROGRAM);
  const [cpu, setCpu] = useState<M68kCPUState>(createInitialCPUState());
  const [memory, setMemory] = useState<Memory>(createInitialMemory());
  const [instructions, setInstructions] = useState<M68kInstruction[]>([]);
  const [output, setOutput] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isHalted, setIsHalted] = useState(false);
  const [cycleCount, setCycleCount] = useState(0);

  const handleAssemble = useCallback(() => {
    const result = assemble(code);
    setErrors(result.errors);

    if (result.errors.length === 0) {
      // Decorar instrucciones con nombre de handler y ciclos a partir del jump table.
      const decorated = result.instructions.map(i => {
        const op = i.opcodeWord;
        const handler = HANDLER_NAMES[JUMP_TABLE[op]] ?? 'm68k_op_illegal';
        return { ...i, handlerName: handler, cycles: CYCLES_TABLE[op] };
      });
      setInstructions(decorated);
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
    setCycleCount(c => c + (result.executionState.currentInstruction?.cycles ?? 4));
  }, [cpu, memory, output, isHalted, instructions]);

  const handleRun = useCallback(() => {
    if (isHalted || isRunning) return;
    setIsRunning(true);

    let haltedLocal: boolean = isHalted;
    const tick = () => {
      if (haltedLocal) {
        setIsRunning(false);
        return;
      }
      setCpu(prevCpu => {
        const r = executeCycle(prevCpu, memory, output, null);
        setMemory(r.newMemory);
        setOutput(r.newOutput);
        setIsHalted(r.halted);
        setCycleCount(c => c + (r.executionState.currentInstruction?.cycles ?? 4));
        haltedLocal = r.halted;
        if (r.halted) setIsRunning(false);
        return r.newState;
      });
    };

    const interval = setInterval(tick, 100);
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
        <h1>Simulador de CPU M68K</h1>
        <p>Ensambla y ejecuta programas Motorola 68000 (ISA desde opcodes.csv)</p>
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
