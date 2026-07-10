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
    location: { href: "http://127.0.0.1:5173/" },
    clearInterval,
    setInterval,
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

class MockWebSocket {
  static instances: Array<MockWebSocket> = [];

  readonly sent: Array<string> = [];
  readyState = 0;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  message(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  serverClose(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

Object.defineProperty(globalThis, "WebSocket", {
  value: MockWebSocket,
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
const view = {
  replace: (message: string) => {
    viewOutput.push(`[replace]${message}`);
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
assert.notEqual(Object.getPrototypeOf(projectPayload), Object.prototype);
assert.notEqual(Object.getPrototypeOf(createPayload), Object.prototype);
assert.equal(projectPayload.id, "onboarded");
assert.equal(createPayload.project, "onboarded");

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
let forwardedMousePosition: { readonly x: number; readonly y: number } | undefined;
const surface = new ProbeElement();
const terminalElement = new ProbeElement();
surface.appendChild(terminalElement);
terminalElement.addEventListener("mousedown", (event) => {
  forwardedMouseDownCount += 1;
  const mouseEvent = event as MouseEvent;
  forwardedMousePosition = {
    x: mouseEvent.clientX,
    y: mouseEvent.clientY
  };
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
assert.deepEqual(forwardedMousePosition, { x: 12, y: 34 });
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
let directMouseDefaultPrevented = false;
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
  directMouseDefaultPrevented = event.defaultPrevented;
});
terminalChild.dispatchEvent(
  new MouseEvent("mousedown", { bubbles: true, clientX: 24, clientY: 48 })
);
assert.equal(directFocusCount, 1);
assert.equal(directMouseDefaultPrevented, false);
assert.equal(forwardedMouseDownCount, 1);
assert.equal(forwardedMouseUpCount, 1);

terminalSessionActionAtom.attach({ threadVm: vm, view });
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "connecting");
assert.equal(storage.get(activeTerminalVmKey), undefined);
assert.equal(MockWebSocket.instances.length, 1);
const socket = MockWebSocket.instances[0]!;
assert.equal(
  socket.url,
  `ws://127.0.0.1:5173/rpc/terminal/${vm.id}/socket?cols=100&rows=30`
);
assert.equal(viewOutput.at(-1), `[replace]Attaching ${vm.name}...`);
terminalSessionActionAtom.sendInput(vm.id, "preopen\n");
assert.deepEqual(socket.sent, []);

socket.open();
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "connecting");
socket.message({
  type: "ready",
  attachmentId: "attachment-1",
  sessionName: "threadvm-vm-1",
  createdAt: Date.now(),
  reused: false
});
socket.message({ type: "status", status: "attached" });
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "attached");
assert.equal(terminalStatusAtomFamily(vm.id).value, "attached");
assert.equal(storage.get(activeTerminalVmKey), vm.id);

terminalSessionActionAtom.sendInput(vm.id, "ls\n");
terminalSessionActionAtom.sendInput(vm.id, "\u0003");
terminalSessionActionAtom.sendInput(vm.id, "\u001b[A");
terminalSessionActionAtom.resize(vm.id, { cols: 100, rows: 30 });
terminalSessionActionAtom.resize(vm.id, { cols: 120, rows: 30 });
assert.deepEqual(socket.sent.map((message) => JSON.parse(message)), [
  { type: "input", data: "ls\n" },
  { type: "input", data: "\u0003" },
  { type: "input", data: "\u001b[A" },
  { type: "resize", cols: 120, rows: 30 }
]);

socket.message({ type: "output", data: "hello from vm" });
assert.equal(viewOutput.at(-1), "hello from vm");
socket.onerror?.();
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "disconnected");
terminalSessionActionAtom.sendInput(vm.id, "hidden\n");
assert.equal(socket.sent.length, 4);

const outputCountBeforeReconnect = viewOutput.length;
terminalSessionActionAtom.attach({ threadVm: vm, view });
assert.equal(socket.readyState, 3);
assert.equal(MockWebSocket.instances.length, 2);
const reconnectedSocket = MockWebSocket.instances[1]!;
assert.equal(
  reconnectedSocket.url,
  `ws://127.0.0.1:5173/rpc/terminal/${vm.id}/socket?cols=100&rows=30`
);
assert.equal(viewOutput.length, outputCountBeforeReconnect + 1);
assert.equal(viewOutput.at(-1), `[replace]Attaching ${vm.name}...`);
reconnectedSocket.open();
reconnectedSocket.message({
  type: "ready",
  attachmentId: "attachment-2",
  sessionName: "threadvm-vm-1",
  createdAt: Date.now(),
  reused: true
});
reconnectedSocket.message({ type: "status", status: "attached" });
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "attached");
assert.equal(
  terminalSessionAtomFamily(vm.id).value.connection?.reused,
  true
);
reconnectedSocket.message({ type: "output", data: "after reconnect" });
assert.equal(viewOutput.at(-1), "after reconnect");
reconnectedSocket.serverClose(1000, "terminal-exited");
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "exited");
assert.equal(terminalStatusAtomFamily(vm.id).value, "exited");

terminalSessionActionAtom.attach({ threadVm: vm, restart: true, view });
const restartedSocket = MockWebSocket.instances.at(-1)!;
assert.equal(
  restartedSocket.url,
  `ws://127.0.0.1:5173/rpc/terminal/${vm.id}/socket?cols=100&rows=30&restart=1`
);
terminalSessionActionAtom.cleanup(vm.id, true);
assert.equal(restartedSocket.readyState, 3);
assert.equal(terminalSessionAtomFamily(vm.id).value.status, "detached");
assert.equal(terminalStatusAtomFamily(vm.id).value, "detached");
assert.equal(storage.get(activeTerminalVmKey), undefined);

const secondVm: ThreadVmModel = {
  ...vm,
  id: "vm-2",
  name: "probe-vm-two",
  host: "probe-vm-two.exe.xyz"
};
const secondViewOutput: Array<string> = [];
const secondView = {
  replace: (message: string) => secondViewOutput.push(`[replace]${message}`),
  write: (data: string) => secondViewOutput.push(data),
  writeln: (data: string) => secondViewOutput.push(`${data}\n`),
  getSize: () => ({ cols: 80, rows: 24 })
};
terminalSessionActionAtom.attach({ threadVm: vm, view });
terminalSessionActionAtom.attach({ threadVm: secondVm, view: secondView });
const firstVmSocket = MockWebSocket.instances.at(-2)!;
const secondVmSocket = MockWebSocket.instances.at(-1)!;
firstVmSocket.open();
firstVmSocket.message({
  type: "ready",
  attachmentId: "attachment-vm-1",
  sessionName: "threadvm-vm-1",
  createdAt: Date.now(),
  reused: true
});
firstVmSocket.message({ type: "status", status: "attached" });
secondVmSocket.open();
secondVmSocket.message({
  type: "ready",
  attachmentId: "attachment-vm-2",
  sessionName: "threadvm-vm-2",
  createdAt: Date.now(),
  reused: false
});
secondVmSocket.message({ type: "status", status: "attached" });
terminalSessionActionAtom.sendInput(vm.id, "first-vm-only\n");
terminalSessionActionAtom.sendInput(secondVm.id, "second-vm-only\n");
assert.deepEqual(firstVmSocket.sent.map((message) => JSON.parse(message)), [
  { type: "input", data: "first-vm-only\n" }
]);
assert.deepEqual(secondVmSocket.sent.map((message) => JSON.parse(message)), [
  { type: "input", data: "second-vm-only\n" }
]);
terminalSessionActionAtom.cleanup(vm.id, false);
terminalSessionActionAtom.cleanup(secondVm.id, true);
assert.equal(firstVmSocket.readyState, 3);
assert.equal(secondVmSocket.readyState, 3);
assert.equal(storage.get(activeTerminalVmKey), undefined);

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
