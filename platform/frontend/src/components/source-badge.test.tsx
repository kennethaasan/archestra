import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceBadge } from "./source-badge";

describe("SourceBadge", () => {
  it("renders the scheduled trigger label", () => {
    render(<SourceBadge source="schedule-trigger" />);

    expect(screen.getByText("Scheduled Trigger")).toBeInTheDocument();
  });
});
