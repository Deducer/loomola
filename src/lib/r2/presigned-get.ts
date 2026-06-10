import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getPresignClient, r2BucketName } from "./client";

/**
 * Returns a signed GET URL valid for 1 hour. When `opts.filename` is
 * supplied, the signed URL includes a `Content-Disposition: attachment`
 * directive with the given filename — clicking it triggers a browser
 * download instead of inline playback.
 */
export async function presignGet(
  key: string,
  opts: { filename?: string } = {}
): Promise<string> {
  const client = getPresignClient();
  const command = new GetObjectCommand({
    Bucket: r2BucketName(),
    Key: key,
    ResponseContentDisposition: opts.filename
      ? `attachment; filename="${opts.filename.replace(/"/g, "")}"`
      : undefined,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}
