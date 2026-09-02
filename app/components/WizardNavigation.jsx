/* eslint-disable react/prop-types */
/**
 * Pure UI step navigation — no longer responsible for saving, since each
 * step's inputs save themselves via useFetcher as soon as they change.
 */
export default function WizardNavigation({ currentStep, maxStep, onChange, onDone }) {
  const isFirst = currentStep === 1;
  const isLast = currentStep >= maxStep;
  // On Step 1, "Continue" is disabled until the app is enabled (maxStep > 1).
  const canContinue = maxStep >= currentStep + 1;

  return (
    <s-stack direction="inline" gap="tight" justifyContent="end">
      {!isFirst && (
        <s-button variant="secondary" onClick={() => onChange(currentStep - 1)}>
          Back
        </s-button>
      )}
      {!isLast ? (
        <s-button variant="primary" disabled={!canContinue} onClick={() => onChange(currentStep + 1)}>
          Continue
        </s-button>
      ) : (
        <s-button variant="primary" onClick={onDone}>
          Done
        </s-button>
      )}
    </s-stack>
  );
}
