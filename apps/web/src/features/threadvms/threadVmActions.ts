import type { ThreadVmModel } from "@threadvm/shared/domain";

export const firstPreviewUrl = (threadVm: ThreadVmModel) =>
  threadVm.ports[0]?.url;

export const threadVmHostClipboardText = (threadVm: ThreadVmModel) =>
  threadVm.host;
