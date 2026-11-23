/* eslint-disable @typescript-eslint/no-explicit-any -- error payloads are untyped */
import { useState } from "react";
import { messages } from "../lib/messages.ts";

interface Props {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  code?: string | null;
  shopDomain?: string;
  jobId?: string | null;
}

export default function SupportError({
  title = "We couldn't complete that",
  error,
  onRetry,
  code = null,
  shopDomain = "",
  jobId = null,
}: Props) {
  const [copied, setCopied] = useState(false);
  const diagnostics = JSON.stringify(
    {
      message: error instanceof Error ? error.message : String(error ?? ""),
      code,
      shopDomain,
      jobId,
      at: new Date().toISOString(),
    },
    null,
    2,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div role="alert" className="pp-card" style={{ marginTop: 12 }}>
      <s-text tone="critical">{title}</s-text>
      <s-text tone="subdued">{messages.supportIntro}</s-text>
      <s-stack direction="inline" gap="tight">
        {onRetry && (
          <s-button variant="primary" class="pp-focus-ring" onClick={onRetry}>
            {messages.retry}
          </s-button>
        )}
        <s-button variant="secondary" class="pp-focus-ring" onClick={() => void copy()}>
          {copied ? "Copied" : messages.copyDiagnostics}
        </s-button>
        <s-link href="https://help.shopify.com/" target="_blank">
          {messages.supportHelp}
        </s-link>
      </s-stack>
    </div>
  );
}
