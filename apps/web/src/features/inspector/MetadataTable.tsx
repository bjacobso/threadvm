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
          <TableRow key={label} className="border-border/60">
            <TableCell className="w-24 py-2 align-top text-xs text-muted-foreground">
              {label}
            </TableCell>
            <TableCell className="break-words py-2 text-xs">{value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
