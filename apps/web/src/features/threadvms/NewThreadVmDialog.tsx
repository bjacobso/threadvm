import { FormEvent, useEffect, useMemo, useState } from "react";
import { CircleAlertIcon } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createThreadVmActionAtom,
  createThreadVmAtom,
  projectConfigAtom,
  useAtomRef
} from "@/state/atoms";

interface NewThreadVmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const trimOrUndefined = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function NewThreadVmDialog({
  open,
  onOpenChange
}: NewThreadVmDialogProps) {
  const projectConfig = useAtomRef(projectConfigAtom);
  const createState = useAtomRef(createThreadVmAtom);
  const [projectId, setProjectId] = useState("");
  const [summary, setSummary] = useState("");
  const [branch, setBranch] = useState("");
  const [baseDevbox, setBaseDevbox] = useState("");
  const [image, setImage] = useState("");
  const [startingPrompt, setStartingPrompt] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const project = useMemo(
    () => projectConfig.projects.find((candidate) => candidate.id === projectId),
    [projectConfig.projects, projectId]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    createThreadVmActionAtom.reset();
    setSubmitted(false);
    if (projectId === "" && projectConfig.projects[0]) {
      setProjectId(projectConfig.projects[0].id);
    }
  }, [open, projectConfig.projects, projectId]);

  const creating = createState.status === "creating";
  const projectInvalid = submitted && projectId.trim().length === 0;
  const summaryInvalid = submitted && summary.trim().length === 0;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);

    const trimmedSummary = summary.trim();
    if (projectId.trim().length === 0 || trimmedSummary.length === 0) {
      return;
    }

    try {
      const response = await createThreadVmActionAtom.run({
        project: projectId,
        summary: trimmedSummary,
        ...(trimOrUndefined(branch) ? { branch: trimOrUndefined(branch) } : {}),
        ...(trimOrUndefined(baseDevbox)
          ? { baseDevbox: trimOrUndefined(baseDevbox) }
          : {}),
        ...(trimOrUndefined(image) ? { image: trimOrUndefined(image) } : {}),
        ...(trimOrUndefined(startingPrompt)
          ? { startingPrompt: trimOrUndefined(startingPrompt) }
          : {})
      });
      toast.success(`Created ${response.threadVm.name}`);
      onOpenChange(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      toast.error("ThreadVM creation failed", {
        description: message
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New ThreadVM</DialogTitle>
            <DialogDescription>
              Create an isolated exe.dev workspace from a configured project.
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

            {createState.error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Create failed</AlertTitle>
                <AlertDescription className="break-words">
                  {createState.error}
                </AlertDescription>
              </Alert>
            ) : null}

            <Field data-invalid={projectInvalid || undefined}>
              <FieldLabel htmlFor="threadvm-project">Project</FieldLabel>
              <Select
                value={projectId}
                onValueChange={setProjectId}
                disabled={creating || projectConfig.loading}
              >
                <SelectTrigger id="threadvm-project" aria-invalid={projectInvalid}>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {projectConfig.projects.map((candidate) => (
                      <SelectItem key={candidate.id} value={candidate.id}>
                        {candidate.id}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {project ? (
                <FieldDescription className="truncate">
                  {project.repo}
                </FieldDescription>
              ) : null}
              <FieldError
                errors={
                  projectInvalid
                    ? [{ message: "Choose a project registry entry." }]
                    : undefined
                }
              />
            </Field>

            <Field data-invalid={summaryInvalid || undefined}>
              <FieldLabel htmlFor="threadvm-summary">Summary</FieldLabel>
              <Input
                id="threadvm-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="investigate auth callback"
                disabled={creating}
                aria-invalid={summaryInvalid}
                autoFocus
              />
              <FieldError
                errors={
                  summaryInvalid
                    ? [{ message: "Describe the idea, bug, or draft." }]
                    : undefined
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="threadvm-branch">Branch</FieldLabel>
              <Input
                id="threadvm-branch"
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder={project?.defaultBranch ?? "generated from summary"}
                disabled={creating}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="threadvm-base-devbox">Base VM</FieldLabel>
                <Input
                  id="threadvm-base-devbox"
                  value={baseDevbox}
                  onChange={(event) => setBaseDevbox(event.target.value)}
                  placeholder={project?.baseDevbox ?? "optional"}
                  disabled={creating}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="threadvm-image">Image</FieldLabel>
                <Input
                  id="threadvm-image"
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  placeholder={project?.image ?? "exeuntu"}
                  disabled={creating}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="threadvm-starting-prompt">
                Starting Prompt
              </FieldLabel>
              <Textarea
                id="threadvm-starting-prompt"
                value={startingPrompt}
                onChange={(event) => setStartingPrompt(event.target.value)}
                placeholder="optional context for the first agent session"
                className="min-h-24"
                disabled={creating}
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={creating}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create ThreadVM"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
