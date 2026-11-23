/** Small accessibility helpers shared by the form components. */

export function describedBy(field: string, hasError: boolean): string | undefined {
  return hasError ? `${field}-error` : undefined;
}

export function errorId(field: string): string {
  return `${field}-error`;
}

export function stepHeadingLabel(step: number): string {
  return step === 1 ? "Step 1: Activate" : "Step 2: Configure";
}
