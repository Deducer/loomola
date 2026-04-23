import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, r2BucketName } from "./client";

/**
 * Uploads a small in-memory payload to R2. For large streams, use multipart
 * (see multipart.ts). For thumbnails (~tens of KB), a single PutObject is
 * fine.
 */
export async function uploadBytes(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
}
