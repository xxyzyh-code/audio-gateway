export const config = {
  runtime: "edge",
};

async function hashString(str) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str)
  );
  const hashArray = new Uint32Array(digest);
  return hashArray[0];
}

const MAIN_WORKERS = [
  "https://support.audio-main-worker.workers.dev",
];

export default async function handler(request) {
  const url = new URL(request.url);

  // -----------------------------
  // 抽取 audioId（query > path）
  // -----------------------------
  let audioId = url.searchParams.get("id");
  if (!audioId) {
    const parts = url.pathname.split("/").filter(Boolean);
    audioId = parts.pop();
  }

  if (!audioId) {
    return new Response("Missing audio ID", { status: 400 });
  }

  // -----------------------------
  // 🔥 修正：先解碼，再重新編碼一次
  // -----------------------------
  const cleanId = decodeURIComponent(audioId);
  const finalId = encodeURIComponent(cleanId);

  // -----------------------------
  // Hash 分配主 worker
  // -----------------------------
  const idx = (await hashString(cleanId)) % MAIN_WORKERS.length;
  const target = `${MAIN_WORKERS[idx]}/${finalId}`;

  // -----------------------------
  // Range 支援
  // -----------------------------
  const range = request.headers.get("range");
  const fetchHeaders = range ? { Range: range } : {};

  // -----------------------------
  // 代理
  // -----------------------------
  const upstream = await fetch(target, { headers: fetchHeaders });

  const headers = new Headers(upstream.headers);
  headers.set("Accept-Ranges", "bytes");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
