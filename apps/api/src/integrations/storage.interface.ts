// Local simulation adapter for object storage (Assessment 08).
// External S3/R2/GCS credentials are not configured (₹0 strict mode).

export interface StoragePutResult {
  key: string;
  url: string;
  mode: "local-simulation";
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

export const storageProvider: ObjectStorageProvider =
  new LocalStubStorageProvider();
