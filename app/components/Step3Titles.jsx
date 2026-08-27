/* eslint-disable react/prop-types */
import { useState } from "react";
import { useFetcher } from "react-router";

const SECTIONS = [
  {
    heading: "Use this to decorate or add in defer script array",
    placeholder: "Enter a value to add into the defer script array...",
  },
  {
    heading: "Use this to decorate or add in delay script array",
    placeholder: "Enter a value to add into the delay script array...",
  },
  {
    heading: "Use this to decorate or add in hide css class",
    placeholder:
      "Enter a class (or classes) to hide via the Hide CSS script...",
  },
];

/**
 * Step 3 — three labeled sections, one per script (order-matched to Step 2):
 * Audit / Defer / Hide CSS. Each textarea holds the related label/value and
 * auto-saves on blur into the shared scriptTitles array (design-only change;
 * no new config fields).
 */
export default function Step3Titles({ config }) {
  const fetcher = useFetcher();
  const [values, setValues] = useState(config.scriptTitles);

  const save = () => {
    const titles = [
      (values[0] || "").trim(),
      (values[1] || "").trim(),
      (values[2] || "").trim(),
    ];
    fetcher.submit(
      { intent: "save-titles", scriptTitles: JSON.stringify(titles) },
      { method: "POST" },
    );
  };

  return (
    <s-section heading="Step 3: Titles">
      <s-stack direction="block" gap="loose">
        <s-paragraph>
          Add tags, values, or classes below. Each section maps to one of the
          scripts from Step 2, in order.
        </s-paragraph>

        {SECTIONS.map((section, index) => (
          <div
            key={index}
            style={{
              padding: "16px 0",
              borderBottom:
                index < SECTIONS.length - 1 ? "1px solid #E5E8EC" : "none",
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#222222",
                marginBottom: 8,
              }}
            >
              {section.heading}
            </div>
            <s-text-area
              label=""
              placeholder={section.placeholder}
              value={values[index] || ""}
              rows={3}
              onChange={(e) => {
                const next = [...values];
                next[index] = e.target.value;
                setValues(next);
              }}
              onBlur={save}
            />
          </div>
        ))}
      </s-stack>
    </s-section>
  );
}
