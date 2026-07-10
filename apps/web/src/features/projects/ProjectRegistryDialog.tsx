import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ProjectModel } from "@threadvm/shared/domain";
import { CircleAlertIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  projectConfigAtom,
  projectRegistryActionAtom,
  projectRegistryMutationAtom,
  useAtomRef
} from "@/state/atoms";

interface ProjectRegistryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const newProjectValue = "__new_project__";

const emptyProject = (): ProjectModel => ({
  id: "",
  repo: "",
  defaultBranch: "main",
  workdir: "",
  bootstrap: [],
  dev: {
    command: "",
    ports: []
  },
  herdr: {
    install: "manual",
    sessionPrefix: "threadvm"
  },
  agents: {
    default: "codex",
    panes: []
  }
});

const compactOptional = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const linesFromString = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parsePorts = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((port) => Number.isInteger(port) && port > 0);

const panesToText = (project: ProjectModel) =>
  project.agents.panes
    .map((pane) => [pane.label, pane.command, pane.cwd ?? ""].join(" | "))
    .join("\n");

const parsePanes = (value: string): ProjectModel["agents"]["panes"] =>
  linesFromString(value).map((line) => {
    const [label = "", command = "", cwd = ""] = line
      .split("|")
      .map((part) => part.trim());
    return {
      label,
      command,
      ...(cwd.length > 0 ? { cwd } : {})
    };
  });

export function ProjectRegistryDialog({
  open,
  onOpenChange
}: ProjectRegistryDialogProps) {
  const projectConfig = useAtomRef(projectConfigAtom);
  const mutation = useAtomRef(projectRegistryMutationAtom);
  const [selectedProjectId, setSelectedProjectId] = useState(newProjectValue);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selectedProject = useMemo(
    () =>
      selectedProjectId === newProjectValue
        ? undefined
        : projectConfig.projects.find((project) => project.id === selectedProjectId),
    [projectConfig.projects, selectedProjectId]
  );

  const [id, setId] = useState("");
  const [repo, setRepo] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [baseDevbox, setBaseDevbox] = useState("");
  const [image, setImage] = useState("");
  const [workdir, setWorkdir] = useState("");
  const [branchPrefix, setBranchPrefix] = useState("");
  const [bootstrap, setBootstrap] = useState("");
  const [devCommand, setDevCommand] = useState("");
  const [devCwd, setDevCwd] = useState("");
  const [devPorts, setDevPorts] = useState("");
  const [herdrInstall, setHerdrInstall] =
    useState<ProjectModel["herdr"]["install"]>("manual");
  const [herdrSessionPrefix, setHerdrSessionPrefix] = useState("threadvm");
  const [agentDefault, setAgentDefault] = useState("codex");
  const [agentPanes, setAgentPanes] = useState("");

  const resetForm = (project: ProjectModel) => {
    setId(project.id);
    setRepo(project.repo);
    setDefaultBranch(project.defaultBranch);
    setBaseDevbox(project.baseDevbox ?? "");
    setImage(project.image ?? "");
    setWorkdir(project.workdir);
    setBranchPrefix(project.branchPrefix ?? "");
    setBootstrap(project.bootstrap.join("\n"));
    setDevCommand(project.dev.command);
    setDevCwd(project.dev.cwd ?? "");
    setDevPorts(project.dev.ports.join(", "));
    setHerdrInstall(project.herdr.install);
    setHerdrSessionPrefix(project.herdr.sessionPrefix);
    setAgentDefault(project.agents.default);
    setAgentPanes(panesToText(project));
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    projectRegistryActionAtom.reset();
    setSubmitted(false);
    if (
      selectedProjectId !== newProjectValue &&
      !projectConfig.projects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(newProjectValue);
    }
  }, [open, projectConfig.projects, selectedProjectId]);

  useEffect(() => {
    resetForm(selectedProject ?? emptyProject());
    setSubmitted(false);
  }, [selectedProject]);

  const saving = mutation.status === "saving";
  const removing = mutation.status === "removing";
  const busy = saving || removing || projectConfig.loading;
  const isEditingExisting = selectedProject !== undefined;
  const idInvalid = submitted && id.trim().length === 0;
  const repoInvalid = submitted && repo.trim().length === 0;
  const branchInvalid = submitted && defaultBranch.trim().length === 0;
  const workdirInvalid = submitted && workdir.trim().length === 0;
  const commandInvalid = submitted && devCommand.trim().length === 0;
  const sessionPrefixInvalid = submitted && herdrSessionPrefix.trim().length === 0;
  const agentInvalid = submitted && agentDefault.trim().length === 0;
  const panesInvalid =
    submitted &&
    parsePanes(agentPanes).some(
      (pane) => pane.label.length === 0 || pane.command.length === 0
    );

  const projectFromForm = (): ProjectModel => ({
    id: id.trim(),
    repo: repo.trim(),
    defaultBranch: defaultBranch.trim(),
    ...(compactOptional(baseDevbox) ? { baseDevbox: compactOptional(baseDevbox) } : {}),
    ...(compactOptional(image) ? { image: compactOptional(image) } : {}),
    workdir: workdir.trim(),
    ...(compactOptional(branchPrefix)
      ? { branchPrefix: compactOptional(branchPrefix) }
      : {}),
    bootstrap: linesFromString(bootstrap),
    dev: {
      command: devCommand.trim(),
      ...(compactOptional(devCwd) ? { cwd: compactOptional(devCwd) } : {}),
      ports: parsePorts(devPorts)
    },
    herdr: {
      install: herdrInstall,
      sessionPrefix: herdrSessionPrefix.trim()
    },
    agents: {
      default: agentDefault.trim(),
      panes: parsePanes(agentPanes)
    }
  });

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const nextPanes = parsePanes(agentPanes);
    const nextPanesInvalid = nextPanes.some(
      (pane) => pane.label.length === 0 || pane.command.length === 0
    );

    if (
      idInvalid ||
      repoInvalid ||
      branchInvalid ||
      workdirInvalid ||
      commandInvalid ||
      sessionPrefixInvalid ||
      agentInvalid ||
      panesInvalid ||
      id.trim().length === 0 ||
      repo.trim().length === 0 ||
      defaultBranch.trim().length === 0 ||
      workdir.trim().length === 0 ||
      devCommand.trim().length === 0 ||
      herdrSessionPrefix.trim().length === 0 ||
      agentDefault.trim().length === 0 ||
      nextPanesInvalid
    ) {
      return;
    }

    const project = projectFromForm();
    try {
      const response = await projectRegistryActionAtom.save(project);
      setSelectedProjectId(project.id);
      toast.success(response.message);
    } catch (cause) {
      toast.error("Project save failed", {
        description: cause instanceof Error ? cause.message : String(cause)
      });
    }
  };

  const onDelete = async () => {
    if (!selectedProject) {
      return;
    }
    try {
      const response = await projectRegistryActionAtom.remove(selectedProject.id);
      setDeleteConfirmOpen(false);
      setSelectedProjectId(newProjectValue);
      toast.success(response.message);
    } catch (cause) {
      toast.error("Project remove failed", {
        description: cause instanceof Error ? cause.message : String(cause)
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[720px]">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Project Registry</DialogTitle>
              <DialogDescription>
                Edit local project templates used when creating ThreadVMs.
              </DialogDescription>
            </DialogHeader>

            <FieldGroup className="py-4">
              {projectConfig.error ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Project registry failed</AlertTitle>
                  <AlertDescription className="break-words">
                    {projectConfig.error}
                  </AlertDescription>
                </Alert>
              ) : null}

              {mutation.error ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Project update failed</AlertTitle>
                  <AlertDescription className="break-words">
                    {mutation.error}
                  </AlertDescription>
                </Alert>
              ) : null}

              <Field>
                <FieldLabel htmlFor="project-registry-select">Project</FieldLabel>
                <Select
                  value={selectedProjectId}
                  onValueChange={setSelectedProjectId}
                  disabled={busy}
                >
                  <SelectTrigger id="project-registry-select">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={newProjectValue}>New project</SelectItem>
                      {projectConfig.projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>

              <Separator />

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={idInvalid || undefined}>
                  <FieldLabel htmlFor="project-id">ID</FieldLabel>
                  <Input
                    id="project-id"
                    value={id}
                    onChange={(event) => setId(event.target.value)}
                    disabled={busy || isEditingExisting}
                    placeholder="personal-site"
                    aria-invalid={idInvalid}
                  />
                  <FieldError
                    errors={
                      idInvalid ? [{ message: "Project id is required." }] : undefined
                    }
                  />
                </Field>
                <Field data-invalid={branchInvalid || undefined}>
                  <FieldLabel htmlFor="project-default-branch">
                    Default Branch
                  </FieldLabel>
                  <Input
                    id="project-default-branch"
                    value={defaultBranch}
                    onChange={(event) => setDefaultBranch(event.target.value)}
                    disabled={busy}
                    placeholder="main"
                    aria-invalid={branchInvalid}
                  />
                </Field>
              </FieldGroup>

              <Field data-invalid={repoInvalid || undefined}>
                <FieldLabel htmlFor="project-repo">Repo</FieldLabel>
                <Input
                  id="project-repo"
                  value={repo}
                  onChange={(event) => setRepo(event.target.value)}
                  disabled={busy}
                  placeholder="git@github.com:you/repo.git"
                  aria-invalid={repoInvalid}
                />
                <FieldError
                  errors={
                    repoInvalid ? [{ message: "Repository URL is required." }] : undefined
                  }
                />
              </Field>

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={workdirInvalid || undefined}>
                  <FieldLabel htmlFor="project-workdir">Workdir</FieldLabel>
                  <Input
                    id="project-workdir"
                    value={workdir}
                    onChange={(event) => setWorkdir(event.target.value)}
                    disabled={busy}
                    placeholder="/work/personal-site"
                    aria-invalid={workdirInvalid}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="project-branch-prefix">
                    Branch Prefix
                  </FieldLabel>
                  <Input
                    id="project-branch-prefix"
                    value={branchPrefix}
                    onChange={(event) => setBranchPrefix(event.target.value)}
                    disabled={busy}
                    placeholder="ben/"
                  />
                </Field>
              </FieldGroup>

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="project-base-devbox">Base VM</FieldLabel>
                  <Input
                    id="project-base-devbox"
                    value={baseDevbox}
                    onChange={(event) => setBaseDevbox(event.target.value)}
                    disabled={busy}
                    placeholder="onboarded-base"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="project-image">Image</FieldLabel>
                  <Input
                    id="project-image"
                    value={image}
                    onChange={(event) => setImage(event.target.value)}
                    disabled={busy}
                    placeholder="exeuntu"
                  />
                </Field>
              </FieldGroup>

              <Field>
                <FieldLabel htmlFor="project-bootstrap">Bootstrap</FieldLabel>
                <Textarea
                  id="project-bootstrap"
                  value={bootstrap}
                  onChange={(event) => setBootstrap(event.target.value)}
                  disabled={busy}
                  placeholder="mise install&#10;pnpm install"
                  className="min-h-24"
                />
                <FieldDescription>One command per line.</FieldDescription>
              </Field>

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field data-invalid={commandInvalid || undefined}>
                  <FieldLabel htmlFor="project-dev-command">Dev Command</FieldLabel>
                  <Input
                    id="project-dev-command"
                    value={devCommand}
                    onChange={(event) => setDevCommand(event.target.value)}
                    disabled={busy}
                    placeholder="pnpm dev"
                    aria-invalid={commandInvalid}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="project-dev-cwd">Dev CWD</FieldLabel>
                  <Input
                    id="project-dev-cwd"
                    value={devCwd}
                    onChange={(event) => setDevCwd(event.target.value)}
                    disabled={busy}
                    placeholder="apps/web"
                  />
                </Field>
              </FieldGroup>

              <Field>
                <FieldLabel htmlFor="project-dev-ports">Dev Ports</FieldLabel>
                <Input
                  id="project-dev-ports"
                  value={devPorts}
                  onChange={(event) => setDevPorts(event.target.value)}
                  disabled={busy}
                  placeholder="3000, 5173"
                />
              </Field>

              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="project-herdr-install">
                    Herdr Install
                  </FieldLabel>
                  <Select
                    value={herdrInstall}
                    onValueChange={(value) =>
                      setHerdrInstall(value as ProjectModel["herdr"]["install"])
                    }
                    disabled={busy}
                  >
                    <SelectTrigger id="project-herdr-install">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="manual">manual</SelectItem>
                        <SelectItem value="auto">auto</SelectItem>
                        <SelectItem value="never">never</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field data-invalid={sessionPrefixInvalid || undefined}>
                  <FieldLabel htmlFor="project-herdr-prefix">
                    Session Prefix
                  </FieldLabel>
                  <Input
                    id="project-herdr-prefix"
                    value={herdrSessionPrefix}
                    onChange={(event) => setHerdrSessionPrefix(event.target.value)}
                    disabled={busy}
                    placeholder="threadvm"
                    aria-invalid={sessionPrefixInvalid}
                  />
                </Field>
              </FieldGroup>

              <Field data-invalid={agentInvalid || undefined}>
                <FieldLabel htmlFor="project-agent-default">Default Agent</FieldLabel>
                <Input
                  id="project-agent-default"
                  value={agentDefault}
                  onChange={(event) => setAgentDefault(event.target.value)}
                  disabled={busy}
                  placeholder="codex"
                  aria-invalid={agentInvalid}
                />
              </Field>

              <Field data-invalid={panesInvalid || undefined}>
                <FieldLabel htmlFor="project-agent-panes">Agent Panes</FieldLabel>
                <Textarea
                  id="project-agent-panes"
                  value={agentPanes}
                  onChange={(event) => setAgentPanes(event.target.value)}
                  disabled={busy}
                  placeholder="agent | codex&#10;server | pnpm dev | apps/web"
                  className="min-h-24"
                  aria-invalid={panesInvalid}
                />
                <FieldDescription>
                  One pane per line: label | command | optional cwd.
                </FieldDescription>
                <FieldError
                  errors={
                    panesInvalid
                      ? [{ message: "Each pane needs a label and command." }]
                      : undefined
                  }
                />
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !isEditingExisting}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2Icon data-icon="inline-start" />
                Remove
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={busy}>
                  Close
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {saving ? "Saving..." : "Save Project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove project?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {selectedProject?.id ?? "the project"} from the local
              registry. Existing ThreadVMs are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
            >
              {removing ? "Removing..." : "Remove Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
