/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";

export default function Step3Titles({ scripts, onScriptDataChange }) {
  const apiScripts = scripts?.success ? scripts.scripts : [];

  // Local state for each script textarea code
  const [scriptCodes, setScriptCodes] = useState({
    script_1: "",
    script_2: "",
    script_3: "",
  });

  // Helper to notify app._index.jsx with formatted values
  const notifyParent = (updatedCodes) => {
    if (onScriptDataChange) {
      onScriptDataChange({
        auditScript: updatedCodes.script_1 || "",
        deferScript: updatedCodes.script_2 || "",
        hiddenCss: updatedCodes.script_3 || "",
      });
    }
  };

  // 1. Initialize local state AND update parent ref as soon as API scripts arrive
  useEffect(() => {
    if (apiScripts.length > 0) {
      const initialCodes = {};
      apiScripts.forEach((s) => {
        initialCodes[s.id] = s.code || "";
      });
      setScriptCodes(initialCodes);
      notifyParent(initialCodes); // <-- Immediately sync initial values to parent ref
    }
  }, [scripts]);

  const handleCodeChange = (id, newCode) => {
    const updated = { ...scriptCodes, [id]: newCode };
    setScriptCodes(updated);
    notifyParent(updated);
  };

  return (
    <s-section heading="Step 3: Audit Results">
      <s-stack direction="block" gap="loose">
        <s-paragraph>
          Inspect and edit the exact code each script injects into your storefront.
        </s-paragraph>

        {apiScripts.length > 0 && (
          <div style={{ padding: "16px 0" }}>
            {apiScripts.map((script) => (
              <div
                key={script.id}
                style={{ padding: "12px 0", borderBottom: "1px solid #E5E8EC" }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: "#222222",
                    marginBottom: 6,
                  }}
                >
                  {script.name}{" "}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "#666",
                    }}
                  >
                    ({script.type})
                  </span>
                </div>
                <s-text-area
                  label=""
                  value={scriptCodes[script.id] ?? script.code}
                  rows={10}
                  onInput={(e) => handleCodeChange(script.id, e.target.value)}
                  onChange={(e) => handleCodeChange(script.id, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </s-stack>
    </s-section>
  );
}
