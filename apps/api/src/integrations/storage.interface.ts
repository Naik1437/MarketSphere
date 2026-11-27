import { providerError, requestWithRetry } from "./http-client";

export interface StoragePutResult {
  key: string;
  url: string;
  mode: "local-simulation" | "external";
}

export interface ObjectStorageProvider {
  putObject(key: string, contentType: string): Promise<StoragePutResult>;
}

export class LocalStubStorageProvider implements ObjectStorageProvider {
  async putObject(key: string, _contentType: string): Promise<StoragePutResult> {
    return {
      key,
      url: `http://localhost:4000/local-storage/${encodeURIComponent(key)}`,
      mode: "local-simulation",
    };
  }
}

export class SupabaseStorageProvider implements ObjectStorageProvider {
  async putObject(key: string, contentType: string): Promise<StoragePutResult> {
    const base = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!base || !serviceKey || !bucket) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET are required");
    const response = await requestWithRetry(`${base}/storage/v1/object/${bucket}/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": contentType, "x-upsert": "false", "Idempotency-Key": `object-${key}` },
      body: new Uint8Array(),
    });
    if (!response.ok) await providerError(response);
    return { key, url: `${base}/storage/v1/object/public/${bucket}/${encodeURIComponent(key)}`, mode: "external" };
  }
}

export const storageProvider: ObjectStorageProvider = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET
  ? new SupabaseStorageProvider()
  : new LocalStubStorageProvider();
