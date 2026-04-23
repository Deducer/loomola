import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, r2BucketName } from "./client";

/**
 * Returns a signed GET URL valid for 1 hour. Used by the owner's preview
 * player in /v/:slug; the viewer page fetches fresh URLs as needed.
 */
export async function presignGet(key: string): Promise<string> {
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: r2BucketName(), Key: key }),
    { expiresIn: 3600 }
  );
}
