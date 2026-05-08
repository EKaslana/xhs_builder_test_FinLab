import { apiRequest, API_BASE } from "./queryClient";

export type Dataset = {
  id: string;
  name: string;
  rows: number;
  cols: string[];
  preview?: { columns: string[]; rows: any[]; total: number };
};

export type Coef = {
  name: string;
  coef: number | null;
  se: number | null;
  t: number | null;
  p: number | null;
  star: string;
};

export type RegResult = {
  coefficients: Coef[];
  n: number | null;
  r2: number | null;
  adj_r2?: number | null;
  r2_within?: number | null;
  f_stat?: number | null;
  f_pvalue?: number | null;
  model?: string;
  label?: string;
  fe_entity?: boolean;
  fe_time?: boolean;
  se_type?: string;
  error?: string;
};

export async function uploadFiles(files: File[]): Promise<Dataset[]> {
  const out: Dataset[] = [];
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`${API_BASE}/api/py/upload`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(await r.text());
    const data = await r.json();
    for (const d of data.datasets) out.push(d);
  }
  return out;
}

export async function listDatasets() {
  const r = await apiRequest("GET", "/api/py/datasets");
  return ((await r.json()).datasets || []) as Dataset[];
}

export async function getDataset(id: string, max = 200) {
  const r = await apiRequest("GET", `/api/py/dataset/${id}?max_rows=${max}`);
  return await r.json();
}

export async function deleteDataset(id: string) {
  await apiRequest("DELETE", `/api/py/dataset/${id}`);
}

export async function pyPost<T = any>(endpoint: string, body: any): Promise<T> {
  const r = await apiRequest("POST", `/api/py/${endpoint}`, body);
  return await r.json();
}
