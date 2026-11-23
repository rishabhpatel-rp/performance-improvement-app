import { messages } from "../lib/messages.ts";
interface Props {
  currentStep: number;
  maxStep: number;
  onChange: (step: number) => void;
}
/**
 * Pure UI step navigation — no longer responsible for saving, since each
 * step's inputs save themselves via useFetcher as soon as they change.
 */
export default function WizardNavigation({ currentStep, maxStep, onChange }: Props) {
  const isFirst = currentStep === 1;
  const isLast = currentStep >= maxStep;
  // On Step 1, "Continue" is disabled until the app is enabled (maxStep > 1).
  const canContinue = maxStep >= currentStep + 1;

  return (
    <s-stack direction="inline" gap="tight" justifyContent="end">
      {!isFirst && (
        <s-button variant="secondary" onClick={() => onChange(currentStep - 1)}>
          {messages.back}
        </s-button>
      )}
      {!isLast && !canContinue && (
        <s-text tone="subdued" variant="bodySm">
          {messages.describeDisabled}
        </s-text>
      )}
      {!isLast && canContinue && (
        <s-button variant="primary" onClick={() => onChange(currentStep + 1)}>
          {messages.continue}
        </s-button>
      )}
    </s-stack>
  );
}
