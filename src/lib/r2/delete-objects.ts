import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getR2Client, r2BucketName } from "./client";

/** Deletes up to thousands of keys in batches of 1000 (the S3 API cap). */
export async function deleteObjects(keys: string[]): Promise<void> {
  const client = getR2Client();
  const bucket = r2BucketName();
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
  }
}

/**
 * Deletes every object under `prefix`. Recording artifacts all live under
 * the recording's slug prefix (`<slug>/composite.mp4`, `<slug>/raw/...`,
 * `<slug>/mixed.m4a`, thumbnails, sprites, ...), so prefix deletion stays
 * correct as new artifact kinds are added. Refuses blank prefixes — an
 * empty prefix would enumerate the whole bucket.
 */
export async function deleteObjectsByPrefix(prefix: string): Promise<number> {
  if (!prefix || prefix === "/" || !prefix.endsWith("/")) {
    throw new Error(`refusing to prefix-delete with unsafe prefix: "${prefix}"`);
  }
  const client = getR2Client();
  const bucket = r2BucketName();
  let deleted = 0;
  let continuationToken: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    const keys = (listed.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((key): key is string => Boolean(key));
    if (keys.length > 0) {
      await deleteObjects(keys);
      deleted += keys.length;
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return deleted;
}
