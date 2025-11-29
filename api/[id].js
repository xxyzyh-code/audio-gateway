// api/[id].js

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
    const url = new URL(req.url, `http://${req.headers.host}`);

    // 1. 提取 audioId
    let audioId = url.searchParams.get("id");
    if (!audioId) {
      const parts = url.pathname.split("/").filter(Boolean);
      audioId = parts.pop();
    }

    if (!audioId) {
      res.status(400).send("Missing audio ID");
      return;
    }

    // 2. Normalize
    const cleanId = decodeURIComponent(audioId.replace(/\+/g, " "));
    const finalId = encodeURIComponent(cleanId);

    // 3. 分配 Main Worker
    const workerIndex = cheapHash(cleanId) % MAIN_WORKERS.length;
    const target = `${MAIN_WORKERS[workerIndex]}/${finalId}`;

    // 4. Range 支援
    const fetchHeaders = {};
    if (req.headers.range) fetchHeaders["Range"] = req.headers.range;

    // 5. 上游請求
    const upstream = await fetch(target, { headers: fetchHeaders });

    // 6. 設置響應 header
    upstream.headers.forEach((v, k) => {
      res.setHeader(k, v);
    });
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);

    // 7. 返回內容
    res.statusCode = upstream.status;
    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
    });

    // 將 ReadableStream 轉成 Node Response
    const arrayBuffer = await new Response(stream).arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error(err);
    res.status(502).json({ message: "Proxy fetch failed.", error: err.message });
  }
}
