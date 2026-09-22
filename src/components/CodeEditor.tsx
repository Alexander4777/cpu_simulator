import React from 'react';
import './CodeEditor.css';

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  errors: string[];
}

export const CodeEditor: React.FC<CodeEditorProps> = ({ code, onChange, errors }) => {
  return (
    <div className="code-editor">
      <h3>Editor de Código Assembly</h3>
      <textarea
        value={code}
        onChange={(e) => onChange(e.target.value)}
        placeholder="; Escribe tu programa aquí...
; Ejemplo:
LOAD 0x10
ADD 0x11
OUT
HLT
0x10 5
0x11 3"
        spellCheck={false}
      />
      {errors.length > 0 && (
        <div className="errors">
          <h4>Errores de Ensamblaje:</h4>
          <ul>
            {errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};