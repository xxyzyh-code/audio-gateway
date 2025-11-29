// api/[id].js — 普通 Serverless Gateway（支持 Vercel CDN 緩存 & Range）

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
    // 2. Normalize: 支援空格、+ 等
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
    // 5. 讀完整 body → 讓 CDN 緩存
    // -----------------------------
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // -----------------------------
    // 6. 設置 Headers
    // -----------------------------
    upstream.headers.forEach((v, k) => res.setHeader(k, v));
    res.setHeader("Accept-Ranges", "bytes");

    // CDN 緩存策略
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=3600`
    );

    // -----------------------------
    // 7. 返回內容
    // -----------------------------
    res.statusCode = upstream.status;
    res.end(buffer);
  } catch (err) {
    console.error(err);
    res.status(502).json({
      message: "Proxy fetch failed",
      error: err.message,
    });
  }
}
