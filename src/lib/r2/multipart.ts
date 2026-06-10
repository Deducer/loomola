import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getPresignClient, getR2Client, r2BucketName } from "./client";

export async function createMultipartUpload(
  key: string,
  contentType: string
): Promise<string> {
  const client = getR2Client();
  const res = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: r2BucketName(),
      Key: key,
      ContentType: contentType,
    })
  );
  if (!res.UploadId) {
    throw new Error("CreateMultipartUpload returned no UploadId");
  }
  return res.UploadId;
}

export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number
): Promise<string> {
  const client = getPresignClient();
  const cmd = new UploadPartCommand({
    Bucket: r2BucketName(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(client, cmd, { expiresIn: 3600 });
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[]
): Promise<void> {
  const client = getR2Client();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: r2BucketName(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );
}

export async function abortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
  const client = getR2Client();
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: r2BucketName(),
        Key: key,
        UploadId: uploadId,
      })
    );
  } catch {
    // Abort is best-effort; R2's lifecycle will clean orphaned parts
  }
}
