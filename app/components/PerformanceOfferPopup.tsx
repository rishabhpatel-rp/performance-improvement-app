import { useEffect, useRef, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PerformanceOfferPopup() {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(true);
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (fetcher.data?.ok === true) setSubmitted(true);
  }, [fetcher.data]);

  if (!open) return null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = email.trim();
    if (!EMAIL_PATTERN.test(value) || value.length > 254) {
      setLocalError("Enter a valid email address.");
      return;
    }
    setLocalError("");
    void fetcher.submit({ email: value }, { method: "POST", action: "/api/popup-lead" });
  };

  const errorMessage = localError || (fetcher.data?.ok === false ? fetcher.data?.error : "");

  return (
    <div
      className="pp-offer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        className="pp-offer-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pp-offer-title"
      >
        <h2 id="pp-offer-title" className="pp-visually-hidden">
          Special offer: boost your site performance for free
        </h2>

        <button
          className="pp-offer-close"
          type="button"
          aria-label="Close offer"
          onClick={() => setOpen(false)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M6 6 L18 18 M18 6 L6 18"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>

        {submitted ? (
          <div className="pp-offer-success" role="status">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 12.5 L9.5 18 L20 6.5"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <span>Thanks! We&apos;ll be in touch soon.</span>
          </div>
        ) : (
          <form className="pp-offer-form" onSubmit={handleSubmit} noValidate>
            <div className="pp-offer-input-wrap">
              <svg
                className="pp-offer-envelope"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <rect
                  x="2.5"
                  y="5"
                  width="19"
                  height="14"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  fill="none"
                />
                <path
                  d="M3.5 7 L12 13.5 L20.5 7"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <input
                ref={inputRef}
                className="pp-offer-input"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Send us a help email..."
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (localError) setLocalError("");
                }}
                aria-label="Send us a help email"
                aria-invalid={Boolean(errorMessage)}
              />
            </div>
            <button className="pp-offer-submit" type="submit" disabled={fetcher.state !== "idle"}>
              <svg
                className="pp-offer-plane"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M21.5 2.5 L10.5 13.5 M21.5 2.5 L15 21.5 L10.5 13.5 L2.5 9 Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <span>Get Started</span>
            </button>
            {errorMessage && (
              <p className="pp-offer-error" role="alert">
                {errorMessage}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
