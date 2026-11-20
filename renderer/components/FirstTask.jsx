import React from 'react';
import { MimirAsset } from './MimirAsset.jsx';

// Three first tasks that work on a small local model: one conversation, one plain explanation, one real action.
export const STARTER_TASKS = Object.freeze([
  {
    id: 'plan-week',
    title: 'Plan my week',
    hint: 'Mimir asks a few questions, then builds a day-by-day plan.',
    prompt: 'I have a busy week. Ask me 3 quick questions about it, then turn my answers into a day-by-day plan.',
  },
  {
    id: 'explain',
    title: 'Explain something simply',
    hint: 'A plain-language answer, no tools needed.',
    prompt: 'Explain how a vaccine teaches the immune system, in plain words, in under 150 words.',
  },
  {
    id: 'make-file',
    title: 'Make me a file',
    hint: 'Watch Mimir use a tool for real. It asks before writing.',
    prompt: 'Create a file called hello.md in my workspace with a friendly three-line welcome note.',
  },
]);

/**
 * Second and last step of first launch: the model is ready, so run something now.
 * One tap starts a real task in chat. No settings page in between.
 */
export function FirstTask({ onRun, onSkip }) {
  return (
    <div className="first-run" data-testid="first-task">
      <section className="first-run-card" aria-labelledby="first-task-title">
        <header className="first-run-top">
          <span />
          <button type="button" className="link-btn" data-testid="first-task-skip" onClick={onSkip}>Skip</button>
        </header>
        <div className="first-run-hero">
          <MimirAsset category="characters" name="mimir-head" size={56} />
          <div>
            <h1 id="first-task-title">You're set. Try a first task.</h1>
            <p className="muted">Pick one. It runs on this computer, and you can change or stop it any time.</p>
          </div>
        </div>
        <ul className="first-run-checks">
          {STARTER_TASKS.map(task => (
            <li key={task.id}>
              <span className="muted">•</span>
              <div>
                <strong>{task.title}</strong>
                <span className="muted">{task.hint}</span>
                <button type="button" className="btn btn-primary" data-testid={`first-task-${task.id}`} onClick={() => onRun(task.prompt)}>
                  Run this
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
