import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CronExpressionPicker } from "./cron-expression-picker";

describe("CronExpressionPicker", () => {
  it("shows the human-readable preview for preset cron expressions", () => {
    render(<CronExpressionPicker value="0 9 * * 1-5" onChange={vi.fn()} />);

    expect(
      screen.getByText("At 09:00, Monday through Friday"),
    ).toBeInTheDocument();
  });

  it("shows the custom input when the current value is not a preset", () => {
    render(<CronExpressionPicker value="7 4 * * *" onChange={vi.fn()} />);

    expect(screen.getByDisplayValue("7 4 * * *")).toBeInTheDocument();
  });
});
