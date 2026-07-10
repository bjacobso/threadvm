import type { ThreadVmModel } from "@threadvm/shared/domain";
import { OctagonXIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  threadVmLifecycleActionAtom,
  threadVmLifecycleAtom,
  useAtomRef
} from "@/state/atoms";

interface LifecycleActionsProps {
  readonly threadVm: ThreadVmModel;
}

export function LifecycleActions({ threadVm }: LifecycleActionsProps) {
  const lifecycle = useAtomRef(threadVmLifecycleAtom);
  const pendingForThisVm =
    lifecycle.status === "running" && lifecycle.threadVmId === threadVm.id;
  const stopping = pendingForThisVm && lifecycle.action === "stop";
  const removing = pendingForThisVm && lifecycle.action === "remove";
  const stopDisabled =
    pendingForThisVm ||
    threadVm.state === "stopped" ||
    threadVm.state === "destroying";

  const stopThreadVm = async () => {
    try {
      const response = await threadVmLifecycleActionAtom.stop(threadVm.id);
      toast.success(response.message);
    } catch (cause) {
      toast.error("Stop failed", {
        description: cause instanceof Error ? cause.message : String(cause)
      });
    }
  };

  const removeThreadVm = async () => {
    try {
      const response = await threadVmLifecycleActionAtom.remove(threadVm.id);
      toast.success(response.message);
    } catch (cause) {
      toast.error("Remove failed", {
        description: cause instanceof Error ? cause.message : String(cause)
      });
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={stopDisabled}
          onClick={() => void stopThreadVm()}
        >
          <SquareIcon data-icon="inline-start" />
          {stopping ? "Stopping..." : "Stop"}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pendingForThisVm}
            >
              <Trash2Icon data-icon="inline-start" />
              {removing ? "Removing..." : "Remove"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogMedia>
                <OctagonXIcon />
              </AlertDialogMedia>
              <AlertDialogTitle>Remove {threadVm.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This sends an exe.dev remove request for the selected VM. The
                local inventory will drop it after the request is accepted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void removeThreadVm()}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {lifecycle.status === "failed" && lifecycle.threadVmId === threadVm.id ? (
        <Alert variant="destructive">
          <OctagonXIcon />
          <AlertTitle>Lifecycle action failed</AlertTitle>
          <AlertDescription className="break-words">
            {lifecycle.error}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
