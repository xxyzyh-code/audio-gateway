// api/[id].js — Serverless Gateway（Streaming + CDN + Range 支援）

const MAIN_WORKERS = [
  "https://support.audio-main-worker.workers.dev",
];

function cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

const CACHE_TTL_DAYS = 11;
const CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 86400;

export default async function handler(req, res) {
  try {
    // -----------------------------
    // 1. 提取 audioId（path 或 query）
    // -----------------------------
    const url = new URL(req.url, `http://${req.headers.host}`);
    let audioId = url.searchParams.get("id");
    if (!audioId) {
      const parts = url.pathname.split("/").filter(Boolean);
      audioId = parts.pop();
    }
    if (!audioId) {
      res.status(400).send("Missing audio ID");
      return;
    }

    // -----------------------------
    // 2. Normalize
    // -----------------------------
    const cleanId = decodeURIComponent(audioId.replace(/\+/g, " "));
    const finalId = encodeURIComponent(cleanId);

    // -----------------------------
    // 3. 分配主 Worker
    // -----------------------------
    const workerIndex = cheapHash(cleanId) % MAIN_WORKERS.length;
    const target = `${MAIN_WORKERS[workerIndex]}/${finalId}`;

    // -----------------------------
    // 4. 支援 Range
    // -----------------------------
    const fetchHeaders = {};
    if (req.headers.range) fetchHeaders["Range"] = req.headers.range;

    const upstream = await fetch(target, { headers: fetchHeaders });

    // -----------------------------
    // 5. 設置 Headers
    // -----------------------------
    upstream.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=3600`
    );

    // -----------------------------
    // 6. Streaming 返回內容
    // -----------------------------
    if (!upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    // 直接將 upstream 的 body pipe 到 res，支持邊播邊下
    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();

    async function pump() {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    }

    await pump();
  } catch (err) {
    console.error(err);
    res.status(502).json({
      message: "Proxy fetch failed",
      error: err.message,
    });
  }
}
