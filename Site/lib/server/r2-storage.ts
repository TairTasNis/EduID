import 'server-only';
import { createHash, createHmac } from 'node:crypto';

const R2_ACCOUNT_ID = '6d7d3613fed5c211b6b28f9d324504fa';
const R2_BUCKET = 'photos';
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_URL || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_TOTAL_STORAGE_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB

function hmac(key: Buffer | string, string: string): Buffer {
  return createHmac('sha256', key).update(string, 'utf8').digest();
}

function hash(stringOrBuffer: string | Buffer): string {
  return createHash('sha256').update(stringOrBuffer).digest('hex');
}

export async function uploadToR2(key: string, buffer: Buffer, contentType: string): Promise<string> {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    // If R2 credentials aren't set in .env.local yet, return data URL or fallback
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadHash = hash(buffer);
  const canonicalUri = `/${R2_BUCKET}/${encodeURIComponent(key)}`;
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    `PUT\n` +
    `${canonicalUri}\n` +
    `\n` +
    `${canonicalHeaders}\n` +
    `${signedHeaders}\n` +
    `${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n` +
    `${amzDate}\n` +
    `${credentialScope}\n` +
    `${hash(canonicalRequest)}`;

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${R2_ENDPOINT}/${R2_BUCKET}/${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      Host: host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: authorizationHeader,
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    console.error('R2 upload failed:', res.status, errorText);
    // Fallback to data URL so user flow is never interrupted
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }

  return `${R2_PUBLIC_BASE}/${encodeURIComponent(key)}`;
}
