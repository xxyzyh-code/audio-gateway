// api/[id].js （普通 Serverless Gateway，支持 Vercel CDN 緩存）

// ----------------------------------
// Main Worker Pool
// ----------------------------------
const MAIN_WORKERS = [
  "https://support.audio-main-worker.workers.dev",
];

// ----------------------------------
// 更快、更便宜的 Hash（替代 SHA-256）
// ----------------------------------
function cheapHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ----------------------------------
// Cache TTL 給瀏覽器用（Vercel CDN 也會看）
// ----------------------------------
const CACHE_TTL_DAYS = 11;
const CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 86400;

export default async function handler(req, res) {
  try {
    // Node.js 下 URL 需要完整的 origin
    const url = new URL(req.url, `http://${req.headers.host}`);

    // -----------------------------
    // 1. 提取 audioId（支援 query/path）
    // -----------------------------
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
    // 2. Normalize：支援空格、%20、+ 等
    // -----------------------------
    const cleanId = decodeURIComponent(audioId.replace(/\+/g, " "));
    const finalId = encodeURIComponent(cleanId);

    // -----------------------------
    // 3. 分配 Main Worker
    // -----------------------------
    const workerIndex = cheapHash(cleanId) % MAIN_WORKERS.length;
    const target = `${MAIN_WORKERS[workerIndex]}/${finalId}`;

    // -----------------------------
    // 4. 保留 Range 支援
    // -----------------------------
    const fetchHeaders = {};
    if (req.headers.range) fetchHeaders["Range"] = req.headers.range;

    // -----------------------------
    // 5. 上游請求
    // -----------------------------
    const upstream = await fetch(target, { headers: fetchHeaders });

    // -----------------------------
    // 6. 設置響應 header
    // -----------------------------
    const headers = {};
    upstream.headers.forEach((v, k) => {
      headers[k] = v;
    });
    headers["Accept-Ranges"] = "bytes";
    headers["Cache-Control"] = `public, max-age=${CACHE_TTL_SECONDS}`;

    // -----------------------------
    // 7. 返回內容
    // -----------------------------
    const body = upstream.body;
    res.status(upstream.status).set(headers).send(body);
  } catch (err) {
    console.error(err);
    res
      .status(502)
      .json({ message: "Proxy fetch failed.", error: err.message });
  }
}
