export interface OpencodeModelChoice {
  id: string;
  name: string;
  provider: string;
}

export interface OpencodeModels {
  current: string | null;
  models: OpencodeModelChoice[];
}
