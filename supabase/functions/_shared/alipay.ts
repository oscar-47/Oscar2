/**
 * Alipay Open Platform helpers — RSA2 signing and verification.
 * Uses Web Crypto API (available in Deno / Edge Runtime).
 */

// ── Key helpers ──────────────────────────────────────────────────────────────

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Strip PEM headers/footers and whitespace */
function stripPem(pem: string): string {
  return pem
    .replace(/-----BEGIN[\s\S]*?-----/, "")
    .replace(/-----END[\s\S]*?-----/, "")
    .replace(/\s+/g, "");
}

/** Import PKCS#8 private key for SHA-256 RSA signing */
async function importPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  const der = base64ToArrayBuffer(stripPem(pkcs8Base64));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Import SPKI (X.509) public key for SHA-256 RSA verification */
async function importPublicKey(spkiBase64: string): Promise<CryptoKey> {
  const der = base64ToArrayBuffer(stripPem(spkiBase64));
  return crypto.subtle.importKey(
    "spki",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

// ── Signing / Verification ───────────────────────────────────────────────────

/**
 * Build the "content to sign" string per Alipay spec:
 * sort keys alphabetically, join as `key=value&...`,
 * exclude only `sign` (sign_type IS included per current gateway protocol).
 */
export function buildSignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "sign" && params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

/** RSA2 (SHA256withRSA) sign and return base64 signature */
export async function rsaSign(content: string, privateKeyBase64: string): Promise<string> {
  const key = await importPrivateKey(privateKeyBase64);
  const encoded = new TextEncoder().encode(content);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoded);
  return arrayBufferToBase64(sig);
}

/** RSA2 (SHA256withRSA) verify signature */
export async function rsaVerify(
  content: string,
  signature: string,
  publicKeyBase64: string,
): Promise<boolean> {
  const key = await importPublicKey(publicKeyBase64);
  const encoded = new TextEncoder().encode(content);
  const sigBuf = base64ToArrayBuffer(signature);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBuf, encoded);
}

// ── Alipay env config ────────────────────────────────────────────────────────

export interface AlipayConfig {
  appId: string;
  appPrivateKey: string;
  alipayPublicKey: string;
  gateway: string;
  notifyUrl: string;
}

export function getAlipayConfig(): AlipayConfig {
  const appId = Deno.env.get("ALIPAY_APP_ID");
  const appPrivateKey = Deno.env.get("ALIPAY_APP_PRIVATE_KEY");
  const alipayPublicKey = Deno.env.get("ALIPAY_PUBLIC_KEY");
  if (!appId || !appPrivateKey || !alipayPublicKey) {
    throw new Error("Missing ALIPAY_APP_ID / ALIPAY_APP_PRIVATE_KEY / ALIPAY_PUBLIC_KEY");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const notifyUrl = `${supabaseUrl}/functions/v1/alipay-notify`;

  return {
    appId,
    appPrivateKey,
    alipayPublicKey,
    gateway: "https://openapi.alipay.com/gateway.do",
    notifyUrl,
  };
}

// ── Build a full signed request URL ──────────────────────────────────────────

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface PagePayParams {
  outTradeNo: string;
  totalAmount: string; // e.g. "72.00"
  subject: string;
  body?: string;
  /** Where to redirect the user AFTER payment on the Alipay page */
  returnUrl?: string;
  passbackParams?: string;
}

/**
 * Build a signed URL for `alipay.trade.page.pay` (电脑网站支付).
 * The user should be redirected to this URL via GET.
 */
export async function buildPagePayUrl(
  config: AlipayConfig,
  params: PagePayParams,
): Promise<string> {
  const bizContent = JSON.stringify({
    out_trade_no: params.outTradeNo,
    total_amount: params.totalAmount,
    subject: params.subject,
    body: params.body ?? "",
    product_code: "FAST_INSTANT_TRADE_PAY",
    passback_params: params.passbackParams ?? "",
  });

  const commonParams: Record<string, string> = {
    app_id: config.appId,
    method: "alipay.trade.page.pay",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatTimestamp(),
    version: "1.0",
    notify_url: config.notifyUrl,
    biz_content: bizContent,
    ...(params.returnUrl ? { return_url: params.returnUrl } : {}),
  };

  const signContent = buildSignContent(commonParams);
  const sign = await rsaSign(signContent, config.appPrivateKey);
  commonParams.sign = sign;

  const qs = Object.entries(commonParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  return `${config.gateway}?${qs}`;
}

// ── Verify async notification ────────────────────────────────────────────────

/**
 * Verify an Alipay async notification (POST form data).
 * Returns the parsed params if valid, or null if verification fails.
 */
export async function verifyNotification(
  formBody: string,
  alipayPublicKey: string,
): Promise<Record<string, string> | null> {
  const params: Record<string, string> = {};
  const form = new URLSearchParams(formBody);
  for (const [key, value] of form.entries()) {
    params[key] = value;
  }

  const sign = params.sign;
  if (!sign) return null;

  const signContent = buildSignContent(params);
  const valid = await rsaVerify(signContent, sign, alipayPublicKey);
  return valid ? params : null;
}
