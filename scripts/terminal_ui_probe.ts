import assert from "node:assert/strict";
import { parseOsc52 } from "../apps/web/src/features/terminal/osc52.js";
import { terminalSessionActionAtom } from "../apps/web/src/features/terminal/terminalSessionActions.js";
import {
  activeTerminalVmKey,
  provisioningStreamAtom,
  provisioningStreamStateAtom,
  threadVmsAtom,
  terminalSessionAtomFamily
} from "../apps/web/src/state/atoms.js";
import { threadVmApi } from "../apps/web/src/state/apiClient.js";
import type {
  TerminalAttachResponseModel,
  ThreadVmModel
} from "@threadvm/shared/domain";

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const storage = new Map<string, string>();
const fetchCalls: Array<FetchCall> = [];

Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => {
        storage.delete(key);
      },
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      }
    }
  },
  configurable: true
});

Object.defineProperty(globalThis, "fetch", {
  value: async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  },
  configurable: true
});

class MockEventSource {
  static instances: Array<MockEventSource> = [];

  onerror: (() => void) | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | undefined;
  onopen: (() => void) | undefined;
  readonly listeners = new Map<
    string,
    Array<(event: MessageEvent<string>) => void>
  >();
  closed = false;

  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(
    event: string,
    listener: (event: MessageEvent<string>) => void
  ) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data = "") {
    for (const listener of this.listeners.get(event) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }

  message(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  open() {
    this.onopen?.();
  }
}

Object.defineProperty(globalThis, "EventSource", {
  value: MockEventSource,
  configurable: true
});

const vm: ThreadVmModel = {
  id: "vm-1",
  name: "probe-vm",
  host: "probe-vm.exe.xyz",
  state: "running",
  source: "mock",
  ports: []
};

const attachResponse: TerminalAttachResponseModel = {
  sessionId: "session-1",
  streamUrl: "/rpc/terminal/session-1/stream",
  inputUrl: "/rpc/terminal/session-1/input",
  resizeUrl: "/rpc/terminal/session-1/resize",
  closeUrl: "/rpc/terminal/session-1",
  status: "running",
  reused: false,
  createdAt: Date.now()
};

const viewOutput: Array<string> = [];
const view = {
  reset: () => {
    viewOutput.push("[reset]");
  },
  write: (data: string) => {
    viewOutput.push(data);
  },
  writeln: (data: string) => {
    viewOutput.push(`${data}\n`);
  },
  getSize: () => ({ cols: 100, rows: 30 })
};

assert.equal(parseOsc52("c;aGVsbG8="), "hello");
assert.equal(parseOsc52("c; aG Vs bG8 "), "hello");
assert.equal(parseOsc52("x;aGVsbG8="), undefined);
assert.equal(parseOsc52("c;?"), undefined);

threadVmApi.attachTerminal = async (threadVmId, restart) => {
  assert.equal(threadVmId, vm.id);
  assert.equal(restart, false);
  return attachResponse;
};

await terminalSessionActionAtom.attach({ threadVm: vm, view });
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "attached");
assert.equal(storage.get(activeTerminalVmKey), vm.id);
assert.equal(MockEventSource.instances.length, 1);
assert.equal(MockEventSource.instances[0]?.url, attachResponse.streamUrl);
assert.deepEqual(
  fetchCalls.map((call) => [call.url, call.init?.method]),
  [[attachResponse.resizeUrl, "POST"]]
);

await terminalSessionActionAtom.sendInput(vm.id, "ls\n");
await terminalSessionActionAtom.resize(vm.id, { cols: 100, rows: 30 });
await terminalSessionActionAtom.resize(vm.id, { cols: 120, rows: 30 });
assert.deepEqual(
  fetchCalls.map((call) => [call.url, call.init?.method]),
  [
    [attachResponse.resizeUrl, "POST"],
    [attachResponse.inputUrl, "POST"],
    [attachResponse.resizeUrl, "POST"]
  ]
);

const source = MockEventSource.instances[0]!;
source.message(JSON.stringify("hello from vm"));
assert.equal(viewOutput.at(-1), "hello from vm");
source.emit("exit");
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "exited");
assert.equal(source.closed, true);
assert.equal(storage.get(activeTerminalVmKey), undefined);

await terminalSessionActionAtom.attach({ threadVm: vm, view });
terminalSessionActionAtom.cleanup(vm.id, true);
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "detached");
assert.deepEqual(fetchCalls.at(-1), {
  url: attachResponse.closeUrl,
  init: { method: "DELETE" }
});

threadVmsAtom.set([vm]);
const stopProvisioning = provisioningStreamAtom.start(vm.id);
const provisioningSource = MockEventSource.instances.at(-1)!;
assert.equal(provisioningSource.url, `/rpc/threadvms/${vm.id}/provisioning`);
provisioningSource.emit(
  "provisioning",
  JSON.stringify({
    threadVm: {
      ...vm,
      state: "bootstrapping",
      provisioningSteps: [
        {
          id: "prepare-repo",
          label: "Prepare repo",
          status: "running",
          startedAt: Date.now()
        }
      ]
    },
    observedAt: 123
  })
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(threadVmsAtom.value[0]?.state, "bootstrapping");
assert.equal(
  threadVmsAtom.value[0]?.provisioningSteps?.[0]?.id,
  "prepare-repo"
);
assert.equal(provisioningStreamStateAtom.value.status, "streaming");
assert.equal(provisioningStreamStateAtom.value.lastObservedAt, 123);
stopProvisioning();
assert.equal(provisioningSource.closed, true);

console.log("terminal ui probe ok");
