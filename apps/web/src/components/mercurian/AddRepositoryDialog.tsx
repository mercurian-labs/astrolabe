import { useState } from "react";

import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";
import { AddRepositoryFlow } from "./AddRepositoryFlow";

interface AddRepositoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function AddRepositoryDialog({ open, onOpenChange }: AddRepositoryDialogProps) {
  const [flowKey, setFlowKey] = useState(0);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setFlowKey((current) => current + 1);
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-lg">
        <AddRepositoryFlow
          key={flowKey}
          onAdded={() => handleOpenChange(false)}
          renderHeader={(title) => (
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
          )}
        />
      </DialogPopup>
    </Dialog>
  );
}
