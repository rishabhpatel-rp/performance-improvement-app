/* Storefront password card (Step 1). */
/* eslint-disable @typescript-eslint/no-explicit-any -- fetcher data is untyped at the boundary */
import { describedBy, errorId } from "../../lib/a11y.ts";
import { messages } from "../../lib/messages.ts";

const PASSWORD_BLOCK_MESSAGE: Record<string, string> = {
  PASSWORD_REQUIRED: messages.passwordRequired,
  PASSWORD_INCORRECT: messages.passwordIncorrect,
};

interface Props {
  showPasswordBox: boolean;
  passwordBlockCode: string | null;
  pwDraft: string;
  setPwDraft: (v: string) => void;
  pwFetcher: any;
  hasSavedPassword: boolean;
  handleSavePassword: () => void;
  readOnly?: boolean;
}

export default function PasswordBox({
  showPasswordBox,
  passwordBlockCode,
  pwDraft,
  setPwDraft,
  pwFetcher,
  hasSavedPassword,
  handleSavePassword,
  readOnly = false,
}: Props) {
  const fieldId = "storefront-password";
  const problem = passwordBlockCode ? PASSWORD_BLOCK_MESSAGE[passwordBlockCode] : null;

  return (
    <>
      {showPasswordBox && (
        <div
          style={{
            flex: "1 1 280px",
            backgroundColor: "#f5f5f5",
            borderRadius: 8,
            padding: 16,
            minWidth: 260,
            boxShadow: passwordBlockCode ? "inset 0 0 0 1px #C62828" : "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#222222" }}>
              Password-protected store detected
            </div>
            <s-switch
              label="Password protection detected"
              labelAccessibilityVisibility="exclusive"
              checked={true}
              disabled
            />
          </div>

          {problem && (
            <div style={{ marginBottom: 8 }}>
              <s-banner tone="critical" aria-live="polite">
                {problem}
              </s-banner>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <s-text-field
                id={fieldId}
                type="password"
                label="Storefront password"
                labelAccessibilityVisibility="exclusive"
                placeholder={
                  hasSavedPassword
                    ? "Enter new password to replace the saved one"
                    : "Enter storefront password"
                }
                value={pwDraft}
                disabled={readOnly}
                aria-invalid={Boolean(problem)}
                aria-describedby={describedBy(fieldId, Boolean(problem))}
                onChange={(e: any) => setPwDraft(e.target.value)}
                required
              />
              {problem && (
                <s-text id={errorId(fieldId)} tone="critical" aria-live="polite">
                  {problem}
                </s-text>
              )}
            </div>
            <s-button
              variant="primary"
              class="pp-focus-ring"
              disabled={readOnly || !pwDraft || pwFetcher.state !== "idle"}
              aria-busy={pwFetcher.state !== "idle"}
              onClick={handleSavePassword}
            >
              {pwFetcher.state !== "idle" ? messages.saving : "Save"}
            </s-button>
          </div>
        </div>
      )}
    </>
  );
}
