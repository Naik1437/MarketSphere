import { providerError, requestWithRetry } from "./http-client";

export interface StoragePutResult {
  key: string;
  url: string;
  mode: "local-simulation" | "external";
  publicUrl?: string;
}

export interface ObjectStorageProvider {
  putObject(key: string, contentType: string, content?: Uint8Array): Promise<StoragePutResult>;
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
  async putObject(key: string, contentType: string, content?: Uint8Array): Promise<StoragePutResult> {
    const base = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!base || !serviceKey || !bucket) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET are required");
    if (!content) throw new Error("Object content bytes are required for external storage");
    const bucketResponse = await requestWithRetry(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: "GET", headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    if (!bucketResponse.ok) await providerError(bucketResponse);
    const bucketInfo = (await bucketResponse.json()) as { public?: boolean };
    const response = await requestWithRetry(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": contentType, "x-upsert": "false", "Idempotency-Key": `object-${key}` },
      body: Uint8Array.from(content).buffer,
    });
    if (!response.ok) await providerError(response);
    return bucketInfo.public
      ? { key, url: `${base}/storage/v1/object/public/${bucket}/${encodeURIComponent(key)}`, publicUrl: `${base}/storage/v1/object/public/${bucket}/${encodeURIComponent(key)}`, mode: "external" }
      : { key, url: `storage://${bucket}/${key}`, mode: "external" };
  }
}

export const storageProvider: ObjectStorageProvider = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_STORAGE_BUCKET
  ? new SupabaseStorageProvider()
  : new LocalStubStorageProvider();
