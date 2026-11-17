/** Verbatim .pp-audit-* rules from merchant Step3Titles.jsx (Plan B). */
export function PpAuditStyles() {
  return (
    <style>{`
      .pp-step2-wrap {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      }
      .pp-audit-card {
        padding: 12px;
        border: 1px solid #E5E8EC;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        background: transparent;
        transition:
          background-color 240ms ease,
          border-color 240ms ease,
          box-shadow 240ms ease;
      }
      .pp-audit-card.is-error {
        background: var(--t-surface-critical-26021, rgba(254, 232, 235, 1));
        border-color: rgba(142, 11, 33, 0.28);
        box-shadow: inset 0 0 0 1px rgba(142, 11, 33, 0.06);
      }
      .pp-audit-card__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .pp-audit-card__title {
        font-size: 15px;
        font-weight: 700;
        color: #222222;
        min-width: 0;
      }
      .pp-audit-card__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .pp-audit-save {
        display: flex;
        align-items: center;
        max-width: 0;
        opacity: 0;
        transform: translateX(8px);
        overflow: hidden;
        pointer-events: none;
        transition:
          max-width 240ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 180ms ease,
          transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
      }
      .pp-audit-save.is-visible {
        max-width: 120px;
        opacity: 1;
        transform: translateX(0);
        pointer-events: auto;
      }
      .pp-audit-delay {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pp-audit-delay__label {
        font-size: 13px;
        color: #666666;
      }
      .pp-audit-delay__input {
        width: 60px;
        padding: 4px 8px;
        border: 1px solid #cccccc;
        border-radius: 4px;
        font-size: 14px;
        background: #ffffff;
        transition: border-color 180ms ease, box-shadow 180ms ease;
      }
      .pp-audit-delay__input:focus {
        outline: none;
        border-color: #8A8A8A;
        box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.06);
      }
      .pp-audit-delay__input:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .pp-audit-hint {
        position: relative;
        min-height: 1.45em;
      }
      .pp-audit-hint__line {
        display: block;
        font-size: 13px;
        line-height: 1.45;
        color: #6B7177;
        transition: opacity 180ms ease, color 180ms ease;
      }
      .pp-audit-hint__line.is-error {
        color: rgb(142, 11, 33);
        font-weight: 500;
      }
      .pp-audit-hint {
        position: relative;
      }
      .pp-audit-hint__line.is-hidden {
        display: none;
      }
      .pp-audit-fields {
        margin-top: 20px;
      }
      .pp-audit-grid + .pp-audit-grid {
        margin-top: 16px;
      }
      .pp-polaris-textarea {
        width: 100%;
        min-height: 120px;
        padding: 8px 10px;
        border: 1px solid #C9CCCF;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.45;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        resize: vertical;
        box-sizing: border-box;
      }
      .pp-polaris-textarea:focus {
        outline: none;
        border-color: #8A8A8A;
        box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.06);
      }
      .pp-polaris-textarea:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .pp-btn-secondary-sm {
        font-size: 13px;
        font-weight: 500;
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid #C9CCCF;
        background: #fff;
        color: #202223;
        cursor: pointer;
      }
      .pp-btn-secondary-sm:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .pp-switch {
        position: relative;
        width: 36px;
        height: 20px;
        flex-shrink: 0;
      }
      .pp-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .pp-switch__track {
        position: absolute;
        inset: 0;
        background: #C9CCCF;
        border-radius: 999px;
        transition: background 180ms ease;
        cursor: pointer;
      }
      .pp-switch__track::after {
        content: "";
        position: absolute;
        width: 16px;
        height: 16px;
        left: 2px;
        top: 2px;
        background: #fff;
        border-radius: 50%;
        transition: transform 180ms ease;
      }
      .pp-switch input:checked + .pp-switch__track {
        background: #008060;
      }
      .pp-switch input:checked + .pp-switch__track::after {
        transform: translateX(16px);
      }
      .pp-switch input:disabled + .pp-switch__track {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .pp-banner {
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 13px;
        line-height: 1.45;
        margin-bottom: 12px;
      }
      .pp-banner--info {
        background: #EAF4FF;
        color: #202223;
        border: 1px solid #B4D8F6;
      }
      .pp-banner--critical {
        background: rgba(254, 232, 235, 1);
        color: rgb(142, 11, 33);
        border: 1px solid rgba(142, 11, 33, 0.28);
      }
      .pp-banner--warning {
        background: #FFF5EA;
        color: #5E4200;
        border: 1px solid #FFD79D;
      }
      @keyframes pp-spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  );
}
