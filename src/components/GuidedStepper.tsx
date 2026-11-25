import { Check } from 'lucide-react';
import type { StudioStepId } from './TopNav';

export interface StepCompletionState {
  video: boolean;
  voice: boolean;
  export: boolean;
  history: boolean;
}

interface GuidedStepperProps {
  activeStep: StudioStepId;
  completedSteps: StepCompletionState;
  onSelectStep: (step: StudioStepId) => void;
}

const STEPS: Array<{ id: StudioStepId; num: string; label: string }> = [
  { id: 'video', num: '1', label: 'Video' },
  { id: 'voice', num: '2', label: 'Voice' },
  { id: 'export', num: '3', label: 'Export' },
  { id: 'history', num: '4', label: 'History' },
];

export function GuidedStepper({
  activeStep,
  completedSteps,
  onSelectStep,
}: GuidedStepperProps) {
  return (
    <div
      id="workflow-stepper"
      role="tablist"
      aria-label="Workflow tabs"
      className="grid grid-cols-4 border-b border-slate-200 bg-slate-50/70 rounded-t-xl overflow-hidden"
    >
      {STEPS.map((step) => {
        const isActive = activeStep === step.id;
        const isDone = completedSteps[step.id];

        return (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectStep(step.id)}
            className={`min-w-0 min-h-[48px] px-2 sm:px-3 py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer border-b-2 ${
              isActive
                ? 'border-[#7C3AED] bg-white text-slate-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-mono-tabular shrink-0 ${
                isActive
                  ? 'bg-[#7C3AED] text-white'
                  : isDone
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-200/80 text-slate-600'
              }`}
            >
              {isDone && !isActive ? (
                <Check className="w-3 h-3" aria-hidden="true" />
              ) : (
                step.num
              )}
            </span>
            <span className="truncate">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}
