# Local ACP runner

`src/acp` is T3 Code’s MIT-licensed `packages/effect-acp`, vendored unmodified
from commit `3ff452bd65adf758e68b886d1e3778ae1ec7d970` (2026-10-15).
Source: https://github.com/pingdotgg/t3code/tree/3ff452bd65adf758e68b886d1e3778ae1ec7d970/packages/effect-acp
License: [LICENSE-T3](LICENSE-T3). Update deliberately and rerun the ACP probe.

This process isolates its Effect 4.0.4 runtime from the server’s beta runtime.
The JSON event/control boundary belongs to ThreadVM. No Effect values cross it.
The tmux-owned runner survives HTTP server restarts. AgentDriver owns the ACP
subprocess in a Scope; interruption sends session/cancel before process cleanup.
