export const config = {
  runtime: "edge",
};

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
// Cache TTL（給瀏覽器用）
// Edge Cache API 不看 TTL，但還是加給 client
// ----------------------------------
const CACHE_TTL_DAYS = 11;
const CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 86400;

export default async function handler(request) {
  const url = new URL(request.url);
  const cache = caches.default;

  // ----------------------------------
  // 1. 提取 audioId（支援 query/path）
  // ----------------------------------
  let audioId = url.searchParams.get("id");
  if (!audioId) {
    const parts = url.pathname.split("/").filter(Boolean);
    audioId = parts.pop();
  }

  if (!audioId) {
    return new Response("Missing audio ID", { status: 400 });
  }

  // ----------------------------------
  // 2. Normalize：支援空格、%20、+ 等所有變體
  // ----------------------------------
  const cleanId = decodeURIComponent(audioId.replace(/\+/g, " "));
  const finalId = encodeURIComponent(cleanId);

  // ----------------------------------
  // 3. Cache Key：不能帶 headers（避免 Range 污染）
  // ----------------------------------
  const cacheKeyUrl = new URL(url.origin + "/api/" + finalId);
  const cacheKey = new Request(cacheKeyUrl);

  // ----------------------------------
  // 4. Cache Match（只有完整文件才會命中）
  // ----------------------------------
  const range = request.headers.get("range");
  if (!range) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // ----------------------------------
  // 5. 分配 Main Worker
  // ----------------------------------
  const workerIndex = cheapHash(cleanId) % MAIN_WORKERS.length;
  const target = `${MAIN_WORKERS[workerIndex]}/${finalId}`;

  const fetchHeaders = {};
  if (range) fetchHeaders["Range"] = range;

  // ----------------------------------
  // 6. 上游請求
  // ----------------------------------
  let upstream;
  try {
    upstream = await fetch(target, { headers: fetchHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ message: "Proxy fetch failed." }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // ----------------------------------
  // 7. 建立 Response + 設置 Cache-Control（給瀏覽器）
  // ----------------------------------
  const headers = new Headers(upstream.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);

  const response = new Response(upstream.body, {
    status: upstream.status,
    headers,
  });

  // ----------------------------------
  // 8. 放入 Cache（僅儲存完整文件 200 / 非 Range）
  // ----------------------------------
  if (upstream.status === 200 && !range) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch (_) {
      // Cache API 錯誤直接忽略，不阻擋主流程
    }
  }

  return response;
}
