/** Pure Step 1 phase flags — theme saved vs embed unlocked. */
export function step1Visibility({
  themeSaved,
  setupUnlocked,
}: {
  themeSaved: boolean;
  setupUnlocked: boolean;
}) {
  return {
    showInstall: themeSaved,
    showSetupControls: setupUnlocked,
  };
}
