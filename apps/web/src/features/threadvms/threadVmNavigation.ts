export type ThreadVmNavigationAction = "first" | "last" | "next" | "previous";

interface ThreadVmNavigationEvent {
  readonly key: string;
}

export const threadVmNavigationAction = (
  event: ThreadVmNavigationEvent
): ThreadVmNavigationAction | undefined => {
  switch (event.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return undefined;
  }
};

export const nextThreadVmSelection = (
  ids: ReadonlyArray<string>,
  selectedId: string | undefined,
  action: ThreadVmNavigationAction
) => {
  if (ids.length === 0) {
    return undefined;
  }

  if (action === "first") {
    return ids[0];
  }
  if (action === "last") {
    return ids.at(-1);
  }

  const selectedIndex = selectedId === undefined ? -1 : ids.indexOf(selectedId);
  if (selectedIndex === -1) {
    return action === "next" ? ids[0] : ids.at(-1);
  }

  if (action === "next") {
    return ids[(selectedIndex + 1) % ids.length];
  }

  return ids[(selectedIndex - 1 + ids.length) % ids.length];
};
