// api/[id].js — Serverless Gateway（Streaming + CDN + Range + Warm Cache）

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

// 建議你保留：瀏覽器短緩，CDN 極長緩
const ONE_YEAR = 31536000; // 365 天（秒）

export default async function handler(req, res) {
  try {
    // -----------------------------
    // 1. 解析 audioId（path + query）
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
    // 2. Normalize: 空格、+
    // -----------------------------
    const cleanId = decodeURIComponent(audioId.replace(/\+/g, " "));
    const finalId = encodeURIComponent(cleanId);

    // -----------------------------
    // 3. Worker 負載分配
    // -----------------------------
    const workerIndex = cheapHash(cleanId) % MAIN_WORKERS.length;
    const target = `${MAIN_WORKERS[workerIndex]}/${finalId}`;

    // -----------------------------
    // 4. Range 支援（播放器需要）
    // -----------------------------
    const fetchHeaders = {};
    if (req.headers.range) fetchHeaders["Range"] = req.headers.range;

    const upstream = await fetch(target, { headers: fetchHeaders });

    // -----------------------------
    // 5. 設置 Headers
    // -----------------------------
    upstream.headers.forEach((v, k) => res.setHeader(k, v));

    res.setHeader("Accept-Ranges", "bytes");

    // 🔥 CDN 專用：一年緩存 + immutable
    res.setHeader(
      "Cache-Control",
      `public, immutable, s-maxage=${ONE_YEAR}, max-age=3600`
    );

    // -----------------------------
    // 6. Warm Cache（只在非 Range）
    // -----------------------------
    if (!req.headers.range) {
      const warmUrl = `${MAIN_WORKERS[workerIndex]}/${finalId}`;
      fetch(warmUrl)
        .then(r => r.arrayBuffer())
        .catch(() => {});
    }

    // -----------------------------
    // 7. Streaming 回傳給用戶（最重要）
    // -----------------------------
    if (!upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    const reader = upstream.body.getReader();

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
