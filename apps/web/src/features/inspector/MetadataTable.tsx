import type React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableRow
} from "@/components/ui/table";

export function MetadataTable({
  rows
}: {
  readonly rows: ReadonlyArray<readonly [string, React.ReactNode]>;
}) {
  return (
    <Table>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label} className="border-workbench-border/70">
            <TableCell className="w-24 py-1.5 align-top text-[11px] text-workbench-muted">
              {label}
            </TableCell>
            <TableCell className="break-words py-1.5 text-[11px] text-workbench-foreground">
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
