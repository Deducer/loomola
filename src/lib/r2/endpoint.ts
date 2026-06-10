// src/lib/r2/endpoint.ts
//
// Pure env → storage-endpoint resolution. Deliberately dependency-free so
// the CSP builder (which runs in middleware) can import it without dragging
// in the AWS SDK.

export interface StorageEndpointConfig {
  /** Endpoint the SERVER talks to (inside docker networks this can be an
   * internal hostname like http://minio:9000). */
  endpoint: string;
  /** Endpoint baked into presigned URLs — must be reachable from the BROWSER.
   * Same as `endpoint` unless S3_PUBLIC_ENDPOINT overrides it. */
  publicEndpoint: string;
  forcePathStyle: boolean;
  /** Origin(s) to allow in CSP media-src / connect-src. */
  cspOrigins: string[];
}

type Env = Record<string, string | undefined>;

export function resolveStorageEndpoint(
  env: Env = process.env
): StorageEndpointConfig {
  const explicit = env.S3_ENDPOINT;
  if (explicit) {
    const publicEndpoint = env.S3_PUBLIC_ENDPOINT || explicit;
    return {
      endpoint: explicit,
      publicEndpoint,
      // MinIO requires path-style; opting out is for AWS-style vhost buckets.
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
      cspOrigins: [new URL(publicEndpoint).origin],
    };
  }

  const accountId = env.R2_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      "Storage is not configured. Set S3_ENDPOINT (any S3-compatible store, e.g. MinIO) or R2_ACCOUNT_ID (Cloudflare R2)."
    );
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    endpoint,
    publicEndpoint: endpoint,
    forcePathStyle: false,
    cspOrigins: ["https://*.r2.cloudflarestorage.com"],
  };
}

/** Non-throwing variant for the CSP builder: an unconfigured dev box should
 * still serve pages, just with the historical R2 wildcard. */
export function storageCspOrigins(env: Env = process.env): string[] {
  try {
    return resolveStorageEndpoint(env).cspOrigins;
  } catch {
    return ["https://*.r2.cloudflarestorage.com"];
  }
}
