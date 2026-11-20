export type FirstActivationSnapshot = {
  onboardingActivated: boolean;
  adminManaged: boolean;
  appEnabled: boolean;
  hasStorefrontPassword: boolean;
  passwordProtected: boolean | null;
  embedEnabled: boolean;
};

export function shouldUnlockStep1Setup(embedStatus: string | null | undefined): boolean {
  return embedStatus === "enabled";
}

export function isEligibleForFirstActivation(s: FirstActivationSnapshot): boolean {
  if (s.onboardingActivated) return false;
  if (s.adminManaged) return false;
  if (s.appEnabled) return false;
  if (!s.embedEnabled) return false;
  if (s.passwordProtected === true && !s.hasStorefrontPassword) return false;
  return true;
}
