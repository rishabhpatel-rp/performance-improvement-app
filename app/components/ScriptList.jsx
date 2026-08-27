import { useState } from "react";

const POSITION_LABEL = {
  head: "Head",
  body_start: "Body start",
  body_end: "Body end",
};

export default function ScriptList({
  scripts,
  onToggle,
  onDelete,
  onReorder,
  themeEditorUrl,
}) {
  const [order, setOrder] = useState(
    () => [...scripts].sort((a, b) => a.priority - b.priority),
  );
  const [dragId, setDragId] = useState(null);

  if (!scripts || scripts.length === 0) {
    return null;
  }

  const sorted = order.length === scripts.length
    ? order
    : [...scripts].sort((a, b) => a.priority - b.priority);

  const handleDragStart = (id) => (e) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (overId) => (e) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;

    setOrder((current) => {
      const fromIndex = current.findIndex((s) => s.id === dragId);
      const toIndex = current.findIndex((s) => s.id === overId);
      if (fromIndex === -1 || toIndex === -1) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragId(null);
    if (onReorder) {
      onReorder(sorted.map((s) => s.id));
    }
  };

  return (
    <s-table>
      <s-table-header-row>
        <s-table-header aria-label="Drag handle" />
        <s-table-header>Name</s-table-header>
        <s-table-header>Status</s-table-header>
        <s-table-header>Target pages</s-table-header>
        <s-table-header>Position</s-table-header>
        <s-table-header>Priority</s-table-header>
        <s-table-header>Actions</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {sorted.map((script, index) => (
          <s-table-row
            key={script.id}
            draggable
            onDragStart={handleDragStart(script.id)}
            onDragOver={handleDragOver(script.id)}
            onDrop={handleDrop}
            style={{ opacity: dragId === script.id ? 0.5 : 1 }}
          >
            <s-table-cell>
              <span
                title="Drag to reorder"
                style={{ cursor: "grab", userSelect: "none" }}
              >
                ⠿
              </span>
            </s-table-cell>
            <s-table-cell>
              <s-link href={`/app/scripts/${encodeURIComponent(script.id)}`}>
                {script.name}
              </s-link>
            </s-table-cell>
            <s-table-cell>
              <s-badge tone={script.enabled ? "success" : "neutral"}>
                {script.enabled ? "Enabled" : "Disabled"}
              </s-badge>
            </s-table-cell>
            <s-table-cell>
              <s-stack direction="inline" gap="tight" wrap>
                {(script.targetPages || []).map((page) => (
                  <s-badge key={page}>{page}</s-badge>
                ))}
              </s-stack>
            </s-table-cell>
            <s-table-cell>
              {POSITION_LABEL[script.position] || script.position}
            </s-table-cell>
            <s-table-cell>{index}</s-table-cell>
            <s-table-cell>
              <s-stack direction="inline" gap="tight">
                <s-button
                  variant="tertiary"
                  href={`/app/scripts/${encodeURIComponent(script.id)}`}
                >
                  Edit
                </s-button>
                <s-button
                  variant="tertiary"
                  onClick={() => onToggle(script)}
                >
                  {script.enabled ? "Disable" : "Enable"}
                </s-button>
                {themeEditorUrl && (
                  <s-button
                    variant="tertiary"
                    href={themeEditorUrl}
                    target="_blank"
                  >
                    Open in theme editor
                  </s-button>
                )}
                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => onDelete(script)}
                >
                  Delete
                </s-button>
              </s-stack>
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}
