export interface OpencodeModelChoice {
  id: string;
  name: string;
  provider: string;
}

export interface OpencodeModels {
  current: string | null;
  models: OpencodeModelChoice[];
}

export type OpencodeSwitchFailure = "busy" | "not_listed" | "not_shown" | "dialog_stuck" | "no_response" | "not_reachable";
