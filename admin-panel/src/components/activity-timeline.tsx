"use client";

import { useState } from "react";
import { eventTypeColor, eventTypeLabel, formatDate, formatRelativeTime } from "@/lib/utils";

interface ActivityItem {
  id: string;
  eventType: string;
  description: string | null;
  metadata: unknown;
  createdAt: Date | string;
  store?: { shopName: string; shopDomain: string } | null;
}

export default function ActivityTimeline({ activities }: { activities: ActivityItem[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {activities.map((activity) => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </ul>
  );
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = Boolean(
    activity.metadata &&
      typeof activity.metadata === "object" &&
      Object.keys(activity.metadata as object).length > 0,
  );

  return (
    <li className="rounded-md border border-border p-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${eventTypeColor(activity.eventType)}`}
            >
              {eventTypeLabel(activity.eventType)}
            </span>
            {activity.store && (
              <span className="text-xs text-muted-foreground truncate">
                {activity.store.shopName} ({activity.store.shopDomain})
              </span>
            )}
          </div>
          {activity.description && (
            <p className="text-sm mt-1">{activity.description}</p>
          )}
        </div>
        <span
          className="text-xs text-muted-foreground whitespace-nowrap shrink-0"
          title={formatDate(activity.createdAt)}
        >
          {formatRelativeTime(activity.createdAt)}
        </span>
      </div>

      {hasMetadata && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <pre className="mt-2 rounded-md bg-muted p-2 text-xs overflow-auto">
              {JSON.stringify(activity.metadata, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}
