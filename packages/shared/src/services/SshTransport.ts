/** Shared command construction for finite SSH commands, ACP stdio and tmux PTYs. */
export const sshCommand = (host: string, script: string, pty = false) => {
  if (!host || host.startsWith("-") || !/^[A-Za-z0-9_.@-]+$/.test(host))
    throw new Error("Invalid SSH host");
  return {
    file: "ssh",
    args: [
      pty ? "-tt" : "-T",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "BatchMode=yes",
      host,
      "--",
      script,
    ],
  };
};
