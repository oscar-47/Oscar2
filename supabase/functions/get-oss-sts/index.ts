import { options, ok, err } from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { requireUser } from "../_shared/auth.ts";

type GetOssStsReq = {
  prefix?: string;
  key?: string;
  bucket?: string;
  expiresIn?: number;
};

function toUrlSafeBase64(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeJsonToUrlSafeBase64(obj: unknown): string {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  return toUrlSafeBase64(raw);
}

async function hmacSha1UrlSafe(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toUrlSafeBase64(new Uint8Array(signature));
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return options();
    if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

    const authResult = await requireUser(req);
    if (!authResult.ok) return authResult.response;

    const supabase = createServiceClient();

    const body = await req.json().catch(() => ({})) as GetOssStsReq;
    const prefix = body.prefix && body.prefix.trim().length > 0
      ? body.prefix
      : "temp/uploads";

    const expiresIn = Math.max(60, Math.min(3600, Number(body.expiresIn ?? 900)));
    const expire = Math.floor(Date.now() / 1000) + expiresIn;
    const provider = (Deno.env.get("STORAGE_PROVIDER") ?? "supabase_compat").toLowerCase();
    console.log("[get-oss-sts] request", { provider, prefix, bucket: body.bucket ?? "temp" });

    if (provider === "qiniu") {
      const accessKey = Deno.env.get("QINIU_ACCESS_KEY");
      const secretKey = Deno.env.get("QINIU_SECRET_KEY");
      const bucket = body.bucket ?? Deno.env.get("QINIU_BUCKET") ?? "temp";
      const uploadUrl = Deno.env.get("QINIU_UPLOAD_URL") ?? "https://up.qiniup.com";
      const endpoint = Deno.env.get("QINIU_CDN_HOST") ?? uploadUrl;
      const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
      const key = body.key ?? `${normalizedPrefix}/${crypto.randomUUID()}.png`;

      if (!accessKey || !secretKey) {
        console.error("[get-oss-sts] qiniu keys missing");
        return err("INTERNAL_ERROR", "Qiniu keys are not configured", 500);
      }

      const putPolicy = {
        scope: `${bucket}:${key}`,
        deadline: expire,
        returnBody: "{\"key\":\"$(key)\",\"hash\":\"$(etag)\",\"fsize\":$(fsize),\"bucket\":\"$(bucket)\"}",
      };
      const policy = encodeJsonToUrlSafeBase64(putPolicy);
      const signature = await hmacSha1UrlSafe(secretKey, policy);
      const uploadToken = `${accessKey}:${signature}:${policy}`;

      return ok({
        provider: "qiniu",
        uploadMethod: "POST",
        bucket,
        endpoint,
        pathPrefix: prefix,
        objectKey: key,
        region: "qiniu",
        expire,
        accessKeyId: accessKey,
        policy,
        signature,
        securityToken: uploadToken,
        uploadUrl,
        formFields: {
          token: uploadToken,
          key,
        },
      });
    }

    // Compatibility shape for OSS STS, internally mapped to Supabase Storage signed upload URL.
    const bucket = body.bucket ?? "temp";
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
    const objectKey = body.key ?? `${normalizedPrefix}/${crypto.randomUUID()}.png`;
    let { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(objectKey);

    // First-run resilience: if signing fails for any reason, ensure bucket exists and retry once.
    if (error) {
      console.warn("[get-oss-sts] first createSignedUploadUrl failed, retrying after ensure bucket", error.message);
      const { error: createBucketError } = await supabase.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: "20MB",
      });
      if (createBucketError && !createBucketError.message.toLowerCase().includes("already")) {
        console.error("[get-oss-sts] createBucket failed", createBucketError.message);
        return err("INTERNAL_ERROR", createBucketError.message, 500);
      }

      // Ensure bucket is public so generated public URLs can be read by downstream steps.
      const { error: updateBucketError } = await supabase.storage.updateBucket(bucket, {
        public: true,
        fileSizeLimit: "20MB",
      });
      if (updateBucketError && !updateBucketError.message.toLowerCase().includes("not found")) {
        console.warn("[get-oss-sts] updateBucket warning", updateBucketError.message);
      }

      ({ data, error } = await supabase.storage
        .from(bucket)
        .createSignedUploadUrl(objectKey));
    }

    if (error || !data?.signedUrl) {
      console.error("[get-oss-sts] createSignedUploadUrl failed", error?.message);
      return err("INTERNAL_ERROR", error?.message ?? "Failed to create signed upload URL", 500);
    }

    const baseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const configuredHost = Deno.env.get("UPLOAD_PUBLIC_HOST");
    const publicHost = !configuredHost || configuredHost.includes("cdn.picsetai.com")
      ? `${baseUrl}/storage/v1/object/public/${bucket}`
      : configuredHost;
    const signedUrl = data.signedUrl.startsWith("http")
      ? data.signedUrl
      : data.signedUrl.startsWith("/storage/v1/")
      ? `${baseUrl}${data.signedUrl}`
      : data.signedUrl.startsWith("/object/")
      ? `${baseUrl}/storage/v1${data.signedUrl}`
      : `${baseUrl}${data.signedUrl}`;

    return ok({
      provider: "supabase_compat",
      uploadMethod: "PUT",
      bucket,
      endpoint: publicHost,
      pathPrefix: prefix,
      objectKey,
      region: "auto",
      expire,
      accessKeyId: "SUPABASE_COMPAT",
      policy: "SUPABASE_COMPAT_POLICY",
      signature: "SUPABASE_COMPAT_SIGNATURE",
      securityToken: data.token ?? "",
      uploadUrl: signedUrl,
      formFields: {},
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[get-oss-sts] unhandled error", message);
    return err("INTERNAL_ERROR", message, 500);
  }
});
