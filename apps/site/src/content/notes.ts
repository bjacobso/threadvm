export const notes = [
  {
    slug: "a-bullet-is-enough",
    category: "THE INTERACTION",
    title: "A bullet is enough to begin.",
    readTime: 3,
    description:
      "Why an outline might be the right starting point for working with agents.",
    lead: "An idea usually starts smaller than a ticket. A sentence, a question, a handful of nested details. What if that was enough to give work a place?",
    sections: [
      {
        title: "Start with intent",
        body: "An outline lets you keep an unfinished thought next to a concrete task. A parent describes the goal; children hold the details. You can rearrange the structure as your understanding changes. In ThreadVM, each node has a stable ID, so moving a thought does not sever its connection to the work it started.",
      },
      {
        title: "Context follows the branch",
        body: "A delegated node becomes a thread. Its ancestor path explains why the task exists, and its subtree describes the work. The local harness passes that context and instructions to the run. You can keep broad planning and narrow execution in one document without treating every bullet as an agent command.",
      },
      {
        title: "The document stays yours",
        body: "In the local interface, mentioning an agent starts a short countdown when you leave the bullet. You can send it immediately or keep it as a note. Agents can propose changes, ask questions, and report observations. They do not silently rewrite your outline: proposed changes wait for review.",
      },
      {
        title: "An interface hypothesis",
        body: "The bet is that this keeps intent and execution close enough to stay understandable. The outline becomes the place to write, delegate, inspect, and review. This is an exploration of that interaction, with a working local harness to test the idea.",
      },
    ],
    source: "VISION.md",
    sourceLabel: "Read the project vision",
  },
  {
    slug: "three-histories",
    category: "THE ARCHITECTURE",
    title: "Three histories, one thread.",
    readTime: 4,
    description:
      "Separating what we thought, what ran, and what changed in the code.",
    lead: "Thoughts evolve. Agents execute. Code changes. Those are related events, but they need different records.",
    sections: [
      {
        title: "Thought history belongs to the outline",
        body: "The project contains a nested .threadvm/ Git repository. Its snapshot, operations, Markdown projection, proposals, and run summaries form the thought history. A human edit or accepted batch creates a commit. Proposal submissions, rejections, and delegation summaries are also recorded. The nested repository is excluded from the outer project repository.",
      },
      {
        title: "Execution history records what happened",
        body: "The local events.jsonl file is an append-only execution log. Runs report observations and agent activity. This is distinct from the versioned document: progress messages are useful without becoming outline edits. Runtime capabilities, worktrees, and transcripts are ignored by the thought repository.",
      },
      {
        title: "Code history stays with the project",
        body: "A local delegated run works in an isolated Git worktree on a threadvm/<node>-<run> branch. Its code changes stay in the project’s Git history. Finished run summaries link to the final code HEAD. Accepting an outline proposal updates thought history; it does not merge the run’s code branch.",
      },
      {
        title: "Connect the records explicitly",
        body: "Stable node IDs connect the original intent to a run. Run IDs connect execution events and summaries. Commit SHAs point to code. These links let you reconstruct the story without forcing every event into one document or one Git repository. The local outline and code repositories retain their own histories and can be inspected with familiar tools.",
      },
    ],
    source: "README.md#local-outline-workflow",
    sourceLabel: "Read the storage and workflow details",
  },
  {
    slug: "give-work-a-place",
    category: "THE RUNTIME",
    title: "Give the work a place to live.",
    readTime: 3,
    description:
      "Isolated worktrees, durable terminals, and agents you can inspect.",
    lead: "A task needs more than a prompt. It needs a branch, a filesystem, a running process, and a way to come back later.",
    sections: [
      {
        title: "A workspace for each run",
        body: "The first local execution substrate uses Git worktrees and tmux. Delegating a node creates an isolated code workspace and a persistent executor. Its terminal can be attached from the browser. Closing the terminal leaves the run alive, and browser or server restarts recover live tmux sessions alongside pending reviews and outline state.",
      },
      {
        title: "A common agent protocol",
        body: "Coding agents use ACP through configured shims. The runner handles initialization, sessions, streamed updates, permission requests, and cancellation. The agent receives a scoped outline MCP server for reading context, proposing changes, and observing its run. A shell profile provides terminal-only execution.",
      },
      {
        title: "Make the boundary visible",
        body: "The run-scoped CLI and MCP API allow read, propose, and observe operations. They deny human mutation, review, remotes, and further delegation. This is an API ownership contract in a trusted local environment; it is not an operating-system sandbox. A local worktree isolates a checkout, while tmux keeps its process attachable.",
      },
      {
        title: "Inspect, steer, return",
        body: "The selected thread exposes context, activity, follow-up turns, Stop, and a collapsible terminal. Worktrees and branches remain available for manual review and cleanup after execution. The broader project also retains its exe.dev VM control plane. The local harness is the implemented starting point for the outline-centered workflow.",
      },
    ],
    source: "docs/agent-runtime.md",
    sourceLabel: "Read the agent runtime guide",
  },
];
