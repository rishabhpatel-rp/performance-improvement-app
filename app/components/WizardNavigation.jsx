/* eslint-disable react/prop-types */
import PpPillButton from "./PpPillButton";

export default function WizardNavigation({ currentStep, maxStep, onChange }) {
  const isFirst = currentStep === 1;
  const isLast = currentStep >= maxStep;
  const canContinue = maxStep >= currentStep + 1;

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
      {!isFirst && (
        <PpPillButton onClick={() => onChange(currentStep - 1)}>Back</PpPillButton>
      )}
      {!isLast && (
        <PpPillButton
          variant="primary"
          disabled={!canContinue}
          onClick={() => onChange(currentStep + 1)}
        >
          Continue
        </PpPillButton>
      )}
    </div>
  );
}
