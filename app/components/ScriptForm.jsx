import { useState } from "react";

const TARGET_PAGE_OPTIONS = [
  { value: "all", label: "All pages" },
  { value: "home", label: "Home" },
  { value: "product", label: "Product" },
  { value: "collection", label: "Collection" },
  { value: "cart", label: "Cart" },
  { value: "checkout", label: "Checkout" },
  { value: "custom", label: "Custom" },
];

const POSITION_OPTIONS = [
  { value: "head", label: "Head" },
  { value: "body_start", label: "Body start" },
  { value: "body_end", label: "Body end" },
];

function emptyForm(initialData) {
  return {
    name: initialData?.name || "",
    code: initialData?.code || "",
    enabled: initialData?.enabled ?? true,
    position: initialData?.position || "head",
    async: initialData?.async ?? false,
    defer: initialData?.defer ?? true,
    targetPages: initialData?.targetPages || [],
    customPageHandles: (initialData?.customPageHandles || []).join(", "),
  };
}

export default function ScriptForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading = false,
  errors = {},
}) {
  const [form, setForm] = useState(() => emptyForm(initialData));
  const [localErrors, setLocalErrors] = useState({});

  const toggleTargetPage = (value) => {
    setForm((prev) => {
      const has = prev.targetPages.includes(value);
      return {
        ...prev,
        targetPages: has
          ? prev.targetPages.filter((v) => v !== value)
          : [...prev.targetPages, value],
      };
    });
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.code.trim()) errs.code = "Code is required";
    if (form.targetPages.includes("custom") && !form.customPageHandles.trim()) {
      errs.customPageHandles = "Add at least one page handle";
    }
    setLocalErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      name: form.name.trim(),
      code: form.code,
      enabled: form.enabled,
      position: form.position,
      async: form.async,
      defer: form.defer,
      targetPages: form.targetPages,
      customPageHandles: form.customPageHandles
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean),
    });
  };

  const showCustomHandles = form.targetPages.includes("custom");
  const err = (key) => errors[key] || localErrors[key];

  return (
    <s-stack direction="block" gap="loose">
      <s-text-field
        label="Name"
        value={form.name}
        required
        error={err("name")}
        onChange={(e) =>
          setForm((p) => ({ ...p, name: e.target.value }))
        }
      />

      <s-text-area
        label="Code"
        value={form.code}
        required
        rows={10}
        error={err("code")}
        helpText="JavaScript to inject. Rendered inside a <script> tag."
        onChange={(e) =>
          setForm((p) => ({ ...p, code: e.target.value }))
        }
      />

      <s-switch
        label="Enabled"
        checked={form.enabled}
        onChange={(e) =>
          setForm((p) => ({ ...p, enabled: e.target.checked }))
        }
      />

      <s-select
        label="Position"
        value={form.position}
        onChange={(e) =>
          setForm((p) => ({ ...p, position: e.target.value }))
        }
      >
        {POSITION_OPTIONS.map((opt) => (
          <s-option key={opt.value} value={opt.value}>
            {opt.label}
          </s-option>
        ))}
      </s-select>

      <s-stack direction="inline" gap="loose">
        <s-switch
          label="Async"
          checked={form.async}
          onChange={(e) =>
            setForm((p) => ({ ...p, async: e.target.checked }))
          }
        />
        <s-switch
          label="Defer"
          checked={form.defer}
          onChange={(e) =>
            setForm((p) => ({ ...p, defer: e.target.checked }))
          }
        />
      </s-stack>

      <s-stack direction="block" gap="tight">
        <s-text>Target pages</s-text>
        <s-stack direction="inline" gap="tight" wrap>
          {TARGET_PAGE_OPTIONS.map((opt) => (
            <s-checkbox
              key={opt.value}
              label={opt.label}
              checked={form.targetPages.includes(opt.value)}
              onChange={() => toggleTargetPage(opt.value)}
            />
          ))}
        </s-stack>
      </s-stack>

      {showCustomHandles && (
        <s-text-area
          label="Custom page handles"
          value={form.customPageHandles}
          error={err("customPageHandles")}
          helpText="Comma-separated paths, e.g. /pages/about, /blogs/news"
          onChange={(e) =>
            setForm((p) => ({ ...p, customPageHandles: e.target.value }))
          }
        />
      )}

      <s-stack direction="inline" gap="base">
        <s-button
          variant="primary"
          {...(isLoading ? { loading: true } : {})}
          onClick={handleSubmit}
        >
          Save
        </s-button>
        {onCancel && (
          <s-button variant="tertiary" onClick={onCancel}>
            Cancel
          </s-button>
        )}
      </s-stack>
    </s-stack>
  );
}
