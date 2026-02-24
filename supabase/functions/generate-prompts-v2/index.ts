import { corsHeaders } from "../_shared/cors.ts";
import { options, err } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";
import { getQnChatConfig } from "../_shared/qn-image.ts";

function sanitizeLanguage(value: unknown): string {
  const v = String(value ?? "en").toLowerCase();
  if (["none", "en", "zh", "ja", "ko", "es", "fr", "de", "pt", "ar", "ru"].includes(v)) return v;
  return "en";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return options();
  if (req.method !== "POST") return err("BAD_REQUEST", "Method not allowed", 405);

  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  const body = await req.json().catch(() => null) as {
    analysisJson?: unknown;
    targetLanguage?: string;
    outputLanguage?: string;
    imageCount?: number;
    stream?: boolean;
    design_specs?: unknown;
  } | null;
  if (!body?.analysisJson) return err("BAD_REQUEST", "analysisJson is required");

  const language = sanitizeLanguage(body.outputLanguage ?? body.targetLanguage ?? "en");
  const analysisJson = typeof body.analysisJson === "string"
    ? body.analysisJson
    : JSON.stringify(body.analysisJson, null, 2);
  const designSpecs = body.design_specs
    ? (typeof body.design_specs === "string" ? body.design_specs : JSON.stringify(body.design_specs, null, 2))
    : null;
  const imageCount = Math.max(
    1,
    Math.min(
      15,
      Number(
        body.imageCount
          ?? (typeof body.analysisJson === "object" && body.analysisJson && "_ai_meta" in body.analysisJson
            ? (body.analysisJson as Record<string, unknown>)?._ai_meta &&
              typeof (body.analysisJson as Record<string, unknown>)._ai_meta === "object"
              ? Number(((body.analysisJson as Record<string, unknown>)._ai_meta as Record<string, unknown>).image_count ?? 1)
              : 1
            : 1),
      ),
    ),
  );

  const systemPrompt = language === "zh"
    ? "你是电商视觉提示词工程专家。根据蓝图输出严格 JSON 数组，每个元素只有 prompt 字段。不要输出解释。"
    : "You are an e-commerce visual prompt engineering expert. Return a strict JSON array where each item only has a prompt field. No explanations.";

  const userPrompt = `
Generate exactly ${imageCount} prompt objects with this schema:
[{"prompt":"Subject: ... Composition: ... Background: ... Lighting: ... Color scheme: ... Material details: ... Text layout: ... Atmosphere: ... Style: ... Quality: ..."}]

Rules:
- Preserve product identity and material realism.
- Each prompt must represent a different scene/angle/composition.
- Keep language for in-image text consistent with output language: ${language}.
- If language is "none", force pure-visual output and set text layout as no-text.
- Return JSON array only.

Analysis blueprint:
${analysisJson}

Edited design specs (if provided):
${designSpecs ?? "(none)"}
`;

  const config = getQnChatConfig();
  const isAzure = config.endpoint.includes(".openai.azure.com");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));

        const controller2 = new AbortController();
        const timer = setTimeout(() => controller2.abort(), config.timeoutMs * 2);
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (isAzure) {
            headers["api-key"] = config.apiKey;
          } else {
            headers["Authorization"] = `Bearer ${config.apiKey}`;
          }

          const body: Record<string, unknown> = {
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 2048,
          };
          if (!isAzure) {
            body.model = config.model;
          }

          const res = await fetch(config.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller2.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`QN_CHAT_API_ERROR ${res.status}: ${errorText}`);
          }

          if (res.headers.get("content-type")?.includes("text/event-stream") && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(payload);
                  const delta = parsed?.choices?.[0]?.delta?.content;
                  if (typeof delta === "string" && delta.length > 0) {
                    fullText += delta;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));
                  }
                } catch {
                  // ignore non-json line
                }
              }
            }
          } else {
            const chatResponse = await res.json().catch(() => ({})) as Record<string, unknown>;
            const content = String(chatResponse?.choices?.[0]?.message?.content ?? "");
            const chunkSize = 80;
            for (let i = 0; i < content.length; i += chunkSize) {
              fullText += content.slice(i, i + chunkSize);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText })}\n\n`));
              await new Promise((resolve) => setTimeout(resolve, 40));
            }
          }
        } finally {
          clearTimeout(timer);
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ fullText, error: message })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
