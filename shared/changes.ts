export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  added: number;
  removed: number;
  binary: boolean;
}

export interface PaneChanges {
  root: string | null;
  files: ChangedFile[];
  added: number;
  removed: number;
  truncated: boolean;
}

export interface ChangeDiff {
  patch: string;
  truncated: boolean;
}
