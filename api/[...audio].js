// api/[...audio].js （放在 Vercel /api 目錄，catch-all 路由）

const MAIN_WORKERS = [
  "https://support.audio-main-worker.workers.dev",
];

async function hashString(str) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  const hashArray = new Uint32Array(digest);
  return hashArray[0];
}

export const config = {
  runtime: "edge",
};

export default async function handler(request) {
  const url = new URL(request.url);

  // ✅ 雙模式：先 query string，再 pathname
  let audioId = url.searchParams.get("id");
  if (!audioId) {
    const parts = url.pathname.split("/").filter(Boolean);
    // 確保只取最後一個元素作為 ID
    audioId = parts.pop(); 
  }

  if (!audioId) {
    return new Response("Missing audio ID", { status: 400 });
  }

  // 負載均衡：選擇目標 Worker
  const idx = (await hashString(audioId)) % MAIN_WORKERS.length;
  const target = `${MAIN_WORKERS[idx]}/${encodeURIComponent(audioId)}`;

  // 處理 Range 標頭 (用於音頻/視頻分段請求)
  const range = request.headers.get("range");
  const fetchHeaders = range
    ? { Range: range }
    : undefined;

  try {
    // 1. 代理請求到上游 Worker
    const res = await fetch(target, { headers: fetchHeaders });
    
    // 2. 準備響應標頭
    const responseHeaders = {
      // 確保 Content-Type 正確傳遞
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      // 設置 Vercel 緩存策略 (10 天)
      "Cache-Control": "public, max-age=864000", 
      // 允許分段請求
      "Accept-Ranges": "bytes",
    };
    
    // 3. 處理 Content-Range 和 Content-Length 
    // 必須從上游響應中複製所有相關標頭以正確處理 206 Partial Content
    if (res.headers.has("Content-Range")) {
      responseHeaders["Content-Range"] = res.headers.get("Content-Range");
    }
    if (res.headers.has("Content-Length")) {
        responseHeaders["Content-Length"] = res.headers.get("Content-Length");
    }


    // 4. 關鍵修正：直接傳回 res.body 進行串流，避免記憶體緩衝整個檔案
    return new Response(res.body, { 
      status: res.status, // 保留上游的狀態碼 (可能是 200 或 206)
      headers: responseHeaders 
    });
    
  } catch (err) {
    console.error("Fetch failed:", err.message);
    return new Response(
      JSON.stringify({ message: "Proxy fetch failed" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
