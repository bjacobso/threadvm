import assert from "node:assert/strict";
import { terminalShortcutAction } from "../apps/web/src/features/terminal/keyboardShortcuts.js";
import { parseOsc52 } from "../apps/web/src/features/terminal/osc52.js";
import { Separator } from "../apps/web/src/components/ui/separator.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "../apps/web/src/components/ui/sheet.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "../apps/web/src/components/ui/tabs.js";
import { terminalSessionActionAtom } from "../apps/web/src/features/terminal/terminalSessionActions.js";
import {
  focusTerminalPane,
  forwardSurfaceMouseEventToTerminal
} from "../apps/web/src/features/terminal/terminalFocus.js";
import {
  nextThreadVmSelection,
  threadVmNavigationAction
} from "../apps/web/src/features/threadvms/threadVmNavigation.js";
import { xtermTheme } from "../apps/web/src/features/terminal/xtermTheme.js";
import {
  firstPreviewUrl,
  threadVmHostClipboardText
} from "../apps/web/src/features/threadvms/threadVmActions.js";
import {
  activeTerminalVmKey,
  clipboardNoticeAtom,
  focusedPanelAtom,
  terminalSessionAtomFamily,
  terminalStatusAtomFamily
} from "../apps/web/src/features/terminal/terminalAtoms.js";
import {
  devLogActionAtom,
  devLogAtom,
  portStatusAtom,
  provisioningStreamAtom,
  provisioningStreamStateAtom
} from "../apps/web/src/state/atoms.js";
import {
  createThreadVmActionAtom,
  createThreadVmAtom,
  portStatusActionAtom,
  selectedThreadVmAtom,
  selectedVmKey,
  threadVmsAtom
} from "../apps/web/src/features/threadvms/threadVmAtoms.js";
import {
  apiPayloads,
  threadVmApi
} from "../apps/web/src/state/apiClient.js";
import type {
  ProjectModel,
  TerminalAttachResponseModel,
  ThreadVmModel
} from "../packages/shared/src/domain/schema.js";

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

if (typeof MouseEvent === "undefined") {
  Object.defineProperty(globalThis, "MouseEvent", {
    value: class ProbeMouseEvent extends Event {
      readonly altKey: boolean;
      readonly button: number;
      readonly buttons: number;
      readonly clientX: number;
      readonly clientY: number;
      readonly ctrlKey: boolean;
      readonly detail: number;
      readonly metaKey: boolean;
      readonly relatedTarget: EventTarget | null;
      readonly screenX: number;
      readonly screenY: number;
      readonly shiftKey: boolean;

      constructor(type: string, init: MouseEventInit = {}) {
        super(type, init);
        this.altKey = init.altKey ?? false;
        this.button = init.button ?? 0;
        this.buttons = init.buttons ?? 0;
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
        this.ctrlKey = init.ctrlKey ?? false;
        this.detail = init.detail ?? 0;
        this.metaKey = init.metaKey ?? false;
        this.relatedTarget = init.relatedTarget ?? null;
        this.screenX = init.screenX ?? 0;
        this.screenY = init.screenY ?? 0;
        this.shiftKey = init.shiftKey ?? false;
      }
    },
    configurable: true
  });
}

class ProbeElement extends EventTarget {
  readonly children = new Set<ProbeElement>();

  appendChild(child: ProbeElement) {
    this.children.add(child);
  }

  contains(target: EventTarget | null): boolean {
    return (
      target === this ||
      Array.from(this.children).some((child) => child.contains(target))
    );
  }
}

if (typeof Node === "undefined") {
  Object.defineProperty(globalThis, "Node", {
    value: ProbeElement,
    configurable: true
  });
}

const vm: ThreadVmModel = {
  id: "vm-1",
  name: "probe-vm",
  host: "probe-vm.exe.xyz",
  state: "running",
  source: "mock",
  ports: [
    {
      label: "dev:3000",
      port: 3000,
      url: "https://probe-vm.exe.xyz:3000"
    }
  ]
};

const attachResponse: TerminalAttachResponseModel = {
  sessionId: "session-1",
  streamUrl: "/rpc/terminal/session-1/stream",
  inputUrl: "/rpc/terminal/session-1/input",
  resizeUrl: "/rpc/terminal/session-1/resize",
  closeUrl: "/rpc/terminal/session-1",
  status: "running",
  reused: false,
  mouseModes: [],
  createdAt: Date.now()
};

const reusedAttachResponse: TerminalAttachResponseModel = {
  ...attachResponse,
  reused: true,
  mouseModes: [1000, 1006]
};

const project: ProjectModel = {
  id: "onboarded",
  repo: "git@github.com:example/onboarded.git",
  defaultBranch: "main",
  workdir: "/home/exedev/onboarded",
  bootstrap: [],
  dev: {
    command: "pnpm dev",
    ports: [3000]
  },
  herdr: {
    install: "manual",
    sessionPrefix: "onboarded"
  },
  agents: {
    default: "codex",
    panes: []
  }
};

const viewOutput: Array<string> = [];
const restoredMouseModes: Array<ReadonlyArray<number>> = [];
const view = {
  reset: () => {
    viewOutput.push("[reset]");
  },
  restoreMouseModes: (modes: ReadonlyArray<number>) => {
    restoredMouseModes.push(modes);
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
assert.equal(xtermTheme.background, "var(--terminal-background)");
assert.equal(xtermTheme.foreground, "var(--terminal-foreground)");
assert.equal(xtermTheme.selectionBackground, "var(--terminal-selection)");
assert.equal(typeof Tabs, "function");
assert.equal(typeof TabsList, "function");
assert.equal(typeof TabsTrigger, "function");
assert.equal(typeof TabsContent, "function");
assert.equal(typeof Sheet, "function");
assert.equal(typeof SheetContent, "function");
assert.equal(typeof SheetHeader, "function");
assert.equal(typeof SheetTitle, "function");
assert.equal(typeof SheetDescription, "function");
assert.equal(typeof Separator, "function");
const projectPayload = apiPayloads.project(project);
const createPayload = apiPayloads.createThreadVmRequest({
  project: "onboarded",
  summary: "investigate callback",
  startingPrompt: "check auth logs",
  pinned: true
});
const attachPayload = apiPayloads.terminalAttachRequest(vm.id, false);
assert.notEqual(Object.getPrototypeOf(projectPayload), Object.prototype);
assert.notEqual(Object.getPrototypeOf(createPayload), Object.prototype);
assert.notEqual(Object.getPrototypeOf(attachPayload), Object.prototype);
assert.equal(projectPayload.id, "onboarded");
assert.equal(createPayload.project, "onboarded");
assert.equal(attachPayload.threadVmId, vm.id);
assert.equal(attachPayload.restart, false);

assert.equal(terminalShortcutAction({ key: "Enter", metaKey: true }), "attach");
assert.equal(
  terminalShortcutAction({ key: "Enter", ctrlKey: true, shiftKey: true }),
  "restart"
);
assert.equal(
  terminalShortcutAction({ key: "Enter", metaKey: true, altKey: true }),
  undefined
);
assert.equal(terminalShortcutAction({ key: "k", metaKey: true }), undefined);

assert.equal(threadVmNavigationAction({ key: "ArrowDown" }), "next");
assert.equal(threadVmNavigationAction({ key: "ArrowUp" }), "previous");
assert.equal(threadVmNavigationAction({ key: "Home" }), "first");
assert.equal(threadVmNavigationAction({ key: "End" }), "last");
assert.equal(threadVmNavigationAction({ key: "Enter" }), undefined);
assert.equal(nextThreadVmSelection(["a", "b", "c"], "a", "next"), "b");
assert.equal(nextThreadVmSelection(["a", "b", "c"], "c", "next"), "a");
assert.equal(nextThreadVmSelection(["a", "b", "c"], "a", "previous"), "c");
assert.equal(nextThreadVmSelection(["a", "b", "c"], undefined, "next"), "a");
assert.equal(nextThreadVmSelection(["a", "b", "c"], undefined, "previous"), "c");
assert.equal(nextThreadVmSelection(["a", "b", "c"], "b", "first"), "a");
assert.equal(nextThreadVmSelection(["a", "b", "c"], "b", "last"), "c");
assert.equal(nextThreadVmSelection([], undefined, "next"), undefined);

threadVmApi.attachTerminal = async (threadVmId, restart) => {
  assert.equal(threadVmId, vm.id);
  assert.equal(restart, false);
  return attachResponse;
};
threadVmApi.readDevLog = async (threadVmId) => {
  assert.equal(threadVmId, vm.id);
  return {
    threadVmId,
    path: "/tmp/threadvm/vm-1/dev.log",
    content: "dev server ready\n",
    truncated: false,
    observedAt: 456
  };
};
threadVmApi.checkPorts = async (threadVmId) => {
  assert.equal(threadVmId, vm.id);
  return {
    threadVmId,
    observedAt: 789,
    ports: [
      {
        label: "dev:3000",
        port: 3000,
        url: "https://probe-vm.exe.xyz:3000",
        status: "reachable",
        observedAt: 789
      }
    ]
  };
};
threadVmApi.createThreadVm = async (request) => {
  assert.deepEqual(request, {
    project: "onboarded",
    summary: "investigate callback",
    startingPrompt: "check auth logs",
    pinned: true
  });
  return {
    threadVm: {
      ...vm,
      id: "created-vm",
      name: "onboarded-investigate-callback",
      project: "onboarded",
      summary: request.summary,
      startingPrompt: request.startingPrompt,
      pinned: request.pinned
    },
    message: "created"
  };
};

const createResponse = await createThreadVmActionAtom.run({
  project: "onboarded",
  summary: "investigate callback",
  startingPrompt: "check auth logs",
  pinned: true
});
assert.equal(createResponse.threadVm.startingPrompt, "check auth logs");
assert.equal(createResponse.threadVm.pinned, true);
assert.equal(createThreadVmAtom.value.status, "succeeded");
assert.equal(selectedThreadVmAtom.value?.id, "created-vm");
assert.equal(storage.get(selectedVmKey), "created-vm");
assert.equal(firstPreviewUrl(vm), "https://probe-vm.exe.xyz:3000");
assert.equal(threadVmHostClipboardText(vm), "probe-vm.exe.xyz");

clipboardNoticeAtom.set({
  status: "copied",
  message: "Copied 5 chars"
});
assert.equal(clipboardNoticeAtom.value?.message, "Copied 5 chars");
focusedPanelAtom.set("inspector");
assert.equal(focusedPanelAtom.value, "inspector");
let focusCount = 0;
focusTerminalPane({
  focus: () => {
    focusCount += 1;
  }
});
assert.equal(focusedPanelAtom.value, "terminal");
assert.equal(focusCount, 1);
focusedPanelAtom.set("inspector");
let forwardedFocusCount = 0;
let forwardedMouseDownCount = 0;
let forwardedMouseUpCount = 0;
const surface = new ProbeElement();
const terminalElement = new ProbeElement();
surface.appendChild(terminalElement);
terminalElement.addEventListener("mousedown", () => {
  forwardedMouseDownCount += 1;
});
terminalElement.addEventListener("mouseup", () => {
  forwardedMouseUpCount += 1;
});
forwardSurfaceMouseEventToTerminal(
  new MouseEvent("mousedown", { bubbles: true, clientX: 12, clientY: 34 }),
  {
    element: terminalElement,
    focus: () => {
      forwardedFocusCount += 1;
    }
  },
  surface as unknown as HTMLElement
);
assert.equal(focusedPanelAtom.value, "terminal");
assert.equal(forwardedFocusCount, 1);
assert.equal(forwardedMouseDownCount, 1);
forwardSurfaceMouseEventToTerminal(
  new MouseEvent("mouseup", { bubbles: true, clientX: 12, clientY: 34 }),
  {
    element: terminalElement,
    focus: () => {
      forwardedFocusCount += 1;
    }
  },
  surface as unknown as HTMLElement
);
assert.equal(forwardedFocusCount, 2);
assert.equal(forwardedMouseUpCount, 1);
let directFocusCount = 0;
const terminalChild = new ProbeElement();
terminalElement.appendChild(terminalChild);
terminalChild.addEventListener("mousedown", (event) => {
  forwardSurfaceMouseEventToTerminal(
    event as MouseEvent,
    {
      element: terminalElement,
      focus: () => {
        directFocusCount += 1;
      }
    },
    surface as unknown as HTMLElement
  );
});
terminalChild.dispatchEvent(
  new MouseEvent("mousedown", { bubbles: true, clientX: 24, clientY: 48 })
);
assert.equal(directFocusCount, 1);
assert.equal(forwardedMouseDownCount, 1);
assert.equal(forwardedMouseUpCount, 1);

await terminalSessionActionAtom.attach({ threadVm: vm, view });
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "connecting");
assert.equal(storage.get(activeTerminalVmKey), vm.id);
assert.equal(MockEventSource.instances.length, 1);
assert.equal(MockEventSource.instances[0]?.url, attachResponse.streamUrl);
assert.deepEqual(viewOutput.slice(-2), [
  "[reset]",
  `Attaching ${vm.name}...\n`
]);
assert.deepEqual(restoredMouseModes.at(-1), []);
assert.deepEqual(
  fetchCalls.map((call) => [call.url, call.init?.method]),
  [[attachResponse.resizeUrl, "POST"]]
);
await terminalSessionActionAtom.sendInput(vm.id, "preopen\n");
assert.deepEqual(
  fetchCalls.map((call) => [call.url, call.init?.method]),
  [[attachResponse.resizeUrl, "POST"]]
);

const source = MockEventSource.instances[0]!;
source.open();
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "attached");
assert.equal(terminalStatusAtomFamily(vm.id).value, "attached");

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

source.message(JSON.stringify({ data: "hello from vm", cursor: 13 }));
assert.equal(viewOutput.at(-1), "hello from vm");
source.onerror?.();
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "disconnected");
assert.equal(source.closed, true);
await terminalSessionActionAtom.sendInput(vm.id, "hidden\n");
assert.deepEqual(
  fetchCalls.map((call) => [call.url, call.init?.method]),
  [
    [attachResponse.resizeUrl, "POST"],
    [attachResponse.inputUrl, "POST"],
    [attachResponse.resizeUrl, "POST"]
  ]
);
threadVmApi.attachTerminal = async (threadVmId, restart) => {
  assert.equal(threadVmId, vm.id);
  assert.equal(restart, false);
  return reusedAttachResponse;
};
const outputCountBeforeReconnect = viewOutput.length;
await terminalSessionActionAtom.attach({ threadVm: vm, view });
assert.equal(MockEventSource.instances.at(-1)?.url, `${attachResponse.streamUrl}?since=13`);
assert.equal(viewOutput.length, outputCountBeforeReconnect);
assert.deepEqual(restoredMouseModes.at(-1), [1000, 1006]);
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "connecting");

const reconnectedSource = MockEventSource.instances.at(-1)!;
reconnectedSource.open();
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "attached");
reconnectedSource.message(
  JSON.stringify({ data: "after reconnect", cursor: 28 })
);
assert.equal(viewOutput.at(-1), "after reconnect");
threadVmApi.attachTerminal = async (threadVmId, restart) => {
  assert.equal(threadVmId, vm.id);
  assert.equal(restart, false);
  return attachResponse;
};
reconnectedSource.emit("exit");
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "exited");
assert.equal(terminalStatusAtomFamily(vm.id).value, "exited");
assert.equal(reconnectedSource.closed, true);
assert.equal(storage.get(activeTerminalVmKey), undefined);

await terminalSessionActionAtom.attach({ threadVm: vm, view });
terminalSessionActionAtom.cleanup(vm.id, true);
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "detached");
assert.equal(terminalStatusAtomFamily(vm.id).value, "detached");
assert.deepEqual(fetchCalls.at(-1), {
  url: attachResponse.closeUrl,
  init: { method: "DELETE" }
});

threadVmApi.attachTerminal = async (threadVmId, restart) => {
  assert.equal(threadVmId, vm.id);
  assert.equal(restart, false);
  return reusedAttachResponse;
};
await terminalSessionActionAtom.attach({ threadVm: vm, view });
const coldReconnectSource = MockEventSource.instances.at(-1)!;
assert.equal(coldReconnectSource.url, `${attachResponse.streamUrl}?replay=0`);
assert.deepEqual(restoredMouseModes.at(-1), [1000, 1006]);
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "connecting");
coldReconnectSource.open();
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "attached");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(fetchCalls.at(-1), {
  url: attachResponse.inputUrl,
  init: {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: "\f" })
  }
});
terminalSessionActionAtom.cleanup(vm.id, true);

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

const devLog = await devLogActionAtom.load(vm.id);
assert.equal(devLog.content, "dev server ready\n");
assert.equal(devLogAtom.value.status, "succeeded");
assert.equal(devLogAtom.value.response?.path, "/tmp/threadvm/vm-1/dev.log");

const portStatus = await portStatusActionAtom.load(vm.id);
assert.equal(portStatus.ports[0]?.status, "reachable");
assert.equal(portStatusAtom.value.status, "succeeded");
assert.equal(portStatusAtom.value.response?.observedAt, 789);

console.log("terminal ui probe ok");
