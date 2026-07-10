import type {
  TerminalAttachResponseModel,
  ThreadVmModel
} from "@threadvm/shared/domain";

const apiJson = async <A>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<A> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as A;
};

export const threadVmApi = {
  listThreadVms: () => apiJson<ReadonlyArray<ThreadVmModel>>("/api/threadvms"),
  attachTerminal: (threadVmId: string, restart = false) =>
    apiJson<TerminalAttachResponseModel>("/api/terminal/attach", {
      method: "POST",
      body: JSON.stringify({ threadVmId, restart })
    })
};

