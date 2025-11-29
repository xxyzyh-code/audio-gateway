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
    let audioId = req.url.split("/").pop();
    if (!audioId) {
      res.status(400).send("Missing audio ID");
      return;
    }

    const cleanId = decodeURIComponent(audioId.replace(/\+/g, " "));
    const finalId = encodeURIComponent(cleanId);

    // -----------------------------
    // 2. 分配主 Worker
    // -----------------------------
    const workerIndex = cheapHash(cleanId) % MAIN_WORKERS.length;
    const target = `${MAIN_WORKERS[workerIndex]}/${finalId}`;

    // -----------------------------
    // 3. 支持 Range
    // -----------------------------
    const fetchHeaders = {};
    if (req.headers.range) fetchHeaders["Range"] = req.headers.range;

    const upstream = await fetch(target, { headers: fetchHeaders });

    // -----------------------------
    // 4. 讀完整 body (Buffer) → 讓 CDN 可以緩存
    // -----------------------------
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // -----------------------------
    // 5. 設置 Headers
    // -----------------------------
    // CDN 緩存
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=3600`
    );

    // 保留上游 headers
    upstream.headers.forEach((v, k) => {
      res.setHeader(k, v);
    });
    res.setHeader("Accept-Ranges", "bytes");

    // -----------------------------
    // 6. 返回內容
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
