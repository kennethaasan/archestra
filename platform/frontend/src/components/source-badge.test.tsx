import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceBadge } from "./source-badge";

vi.mock("@/lib/hooks/use-app-name", () => ({
  useAppIconLogo: () => "/icon.png",
}));

describe("SourceBadge", () => {
  it("renders the scheduled trigger label", () => {
    render(<SourceBadge source="schedule-trigger" />);

    expect(screen.getByText("Scheduled Trigger")).toBeInTheDocument();
  });
});
