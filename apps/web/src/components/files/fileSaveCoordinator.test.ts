import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";

import { FileSaveCoordinator } from "./fileSaveCoordinator";

function deferred() {
  let resolve!: (result: AtomCommandResult<void, never>) => void;
  const promise = new Promise<AtomCommandResult<void, never>>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("FileSaveCoordinator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces edits and persists only the latest contents", async () => {
    vi.useFakeTimers();
    const persist = vi
      .fn<(contents: string) => Promise<AtomCommandResult<void, never>>>()
      .mockResolvedValue(AsyncResult.success(undefined));
    const onPendingChange = vi.fn();
    const onConfirmed = vi.fn();
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      initialContents: "disk",
      persist,
      onPendingChange,
      onConfirmed,
      onRollback: vi.fn(),
    });

    coordinator.change("first");
    await vi.advanceTimersByTimeAsync(300);
    coordinator.change("latest");
    await vi.advanceTimersByTimeAsync(499);
    expect(persist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith("latest");
    expect(onConfirmed).toHaveBeenCalledWith("latest");
    expect(onPendingChange.mock.calls).toEqual([[true], [true], [false]]);
  });

  it("keeps pending state until an edit made during a write is also saved", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred();
    const persist = vi
      .fn<(contents: string) => Promise<AtomCommandResult<void, never>>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(AsyncResult.success(undefined));
    const onPendingChange = vi.fn();
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      initialContents: "disk",
      persist,
      onPendingChange,
      onConfirmed: vi.fn(),
      onRollback: vi.fn(),
    });

    coordinator.change("first");
    await vi.advanceTimersByTimeAsync(500);
    coordinator.change("latest");
    await vi.advanceTimersByTimeAsync(500);
    expect(persist).toHaveBeenCalledTimes(1);

    firstWrite.resolve(AsyncResult.success(undefined));
    await vi.runAllTimersAsync();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("latest");
    expect(onPendingChange.mock.calls.at(-1)).toEqual([false]);
  });

  it("rolls back to the last confirmed contents when the latest write fails", async () => {
    vi.useFakeTimers();
    const onPendingChange = vi.fn();
    const onRollback = vi.fn();
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      initialContents: "disk",
      persist: vi
        .fn()
        .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("write failed")))),
      onPendingChange,
      onConfirmed: vi.fn(),
      onRollback,
    });

    coordinator.change("latest");
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(onRollback).toHaveBeenCalledWith("disk");
    expect(onPendingChange.mock.calls.at(-1)).toEqual([false]);
  });

  it("does not roll back a newer edit when an older write fails", async () => {
    vi.useFakeTimers();
    const firstWrite = deferred();
    const persist = vi
      .fn<(contents: string) => Promise<AtomCommandResult<void, never>>>()
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(AsyncResult.success(undefined));
    const onRollback = vi.fn();
    const onConfirmed = vi.fn();
    const coordinator = new FileSaveCoordinator({
      debounceMs: 500,
      initialContents: "disk",
      persist,
      onPendingChange: vi.fn(),
      onConfirmed,
      onRollback,
    });

    coordinator.change("first");
    await vi.advanceTimersByTimeAsync(500);
    coordinator.change("latest");
    firstWrite.resolve(AsyncResult.failure(Cause.fail(new Error("write failed"))));
    await vi.runAllTimersAsync();

    expect(onRollback).not.toHaveBeenCalled();
    expect(persist).toHaveBeenLastCalledWith("latest");
    expect(onConfirmed).toHaveBeenCalledWith("latest");
  });
});
