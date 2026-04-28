import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
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

/** Uploads a local generated artifact, such as an ffmpeg-created playback MP4. */
export async function uploadFile(
  key: string,
  filePath: string,
  contentType: string
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: r2BucketName(),
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    })
  );
}
