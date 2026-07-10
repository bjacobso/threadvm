const decodeBase64Utf8 = (encoded: string): string => {
  const normalized = encoded
    .replace(/\s/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const parseOsc52 = (data: string): string | undefined => {
  const separator = data.indexOf(";");
  if (separator === -1) {
    return undefined;
  }

  const target = data.slice(0, separator);
  const encoded = data.slice(separator + 1);
  if (encoded === "?" || !["", "c", "p", "s", "0", "1", "2"].includes(target)) {
    return undefined;
  }

  return decodeBase64Utf8(encoded);
};

