import { S3Client } from "@aws-sdk/client-s3";
import { resolveStorageEndpoint } from "./endpoint";

let opsClient: S3Client | null = null;
let presignClient: S3Client | null = null;

function credentials() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing storage credentials (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)"
    );
  }
  return { accessKeyId, secretAccessKey };
}

/**
 * Cached S3 client for server-side operations against the configured
 * S3-compatible store (Cloudflare R2 by default; MinIO/AWS via S3_ENDPOINT).
 * Name kept from the R2-only era — ~30 call sites import it.
 */
export function getR2Client(): S3Client {
  if (opsClient) return opsClient;
  const cfg = resolveStorageEndpoint();
  opsClient = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: credentials(),
  });
  return opsClient;
}

/**
 * Client used ONLY to presign URLs that a browser will fetch. Differs from
 * getR2Client when S3_PUBLIC_ENDPOINT is set (docker-compose: the server
 * reaches MinIO at http://minio:9000 but the browser at http://localhost:9000;
 * the signature covers the host, so signing must happen against the public
 * endpoint).
 */
export function getPresignClient(): S3Client {
  if (presignClient) return presignClient;
  const cfg = resolveStorageEndpoint();
  if (cfg.publicEndpoint === cfg.endpoint) {
    presignClient = getR2Client();
    return presignClient;
  }
  presignClient = new S3Client({
    region: "auto",
    endpoint: cfg.publicEndpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: credentials(),
  });
  return presignClient;
}

export function r2BucketName(): string {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error("R2_BUCKET_NAME is not set");
  return name;
}
