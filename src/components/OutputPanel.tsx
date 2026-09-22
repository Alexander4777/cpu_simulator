import React from 'react';
import './OutputPanel.css';

interface OutputPanelProps {
  output: string[];
}

export const OutputPanel: React.FC<OutputPanelProps> = ({ output }) => {
  return (
    <div className="output-panel">
      <h3>Salida</h3>
      <div className="output-content">
        {output.length === 0 ? (
          <span className="no-output">Sin salida</span>
        ) : (
          output.map((line, idx) => (
            <div key={idx} className="output-line">
              <span className="output-index">[{idx}]</span>
              <span className="output-value">{line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};