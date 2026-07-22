// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "../../src/renderer/components/ModelSelector";

afterEach(cleanup);

describe("ModelSelector", () => {
  it("shows only models that passed the requested scene", () => {
    render(<ModelSelector scene="asr_analysis" value="qwen-flash-2025-07-28" onChange={vi.fn()} />);
    expect(screen.getByText("Qwen Flash")).toBeTruthy();
    expect(screen.getByText("DeepSeek V4 Flash")).toBeTruthy();
    expect(screen.queryByText("Qwen 3.5 Flash")).toBeNull();
    expect(screen.queryByText("DeepSeek V4 Pro")).toBeNull();
  });

  it("reorders passed ASR models by effect and selects a model", () => {
    const onChange = vi.fn();
    render(<ModelSelector scene="asr_extraction" value="paraformer-realtime-v2" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "效果优先" }));
    const choices = screen.getAllByRole("radio");
    expect(choices[0].textContent).toContain("Fun-ASR Realtime");
    fireEvent.click(choices[0]);
    expect(onChange).toHaveBeenCalledWith("fun-asr-realtime");
  });

  it("does not show meaningless sorting when only one model passed", () => {
    render(<ModelSelector scene="analyzer_agent" value="qwen3.5-flash-2026-02-23" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "成本优先" })).toBeNull();
    expect(screen.getByRole("radio").getAttribute("aria-checked")).toBe("true");
  });
});
