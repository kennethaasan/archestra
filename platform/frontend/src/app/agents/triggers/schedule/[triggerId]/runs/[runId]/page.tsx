"use client";

import { useParams } from "next/navigation";
import { ScheduleTriggerRunPage } from "@/app/agents/triggers/schedule/schedule-trigger-run-client";

export default function Page() {
  const params = useParams<{ triggerId: string; runId: string }>();
  const triggerId =
    typeof params?.triggerId === "string" ? params.triggerId : "";
  const runId = typeof params?.runId === "string" ? params.runId : "";

  return <ScheduleTriggerRunPage triggerId={triggerId} runId={runId} />;
}
