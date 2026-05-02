export const config = {
  api: {
    bodyParser: false,
  },
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function backendUrl(req) {
  const backendOrigin = process.env.BACKEND_ORIGIN;
  if (!backendOrigin) {
    throw new Error("BACKEND_ORIGIN is not configured.");
  }

  const pathValue = req.query.path;
  const pathParts = Array.isArray(pathValue) ? pathValue : [pathValue].filter(Boolean);
  const url = new URL(pathParts.map(encodeURIComponent).join("/"), `${backendOrigin.replace(/\/$/, "")}/`);

  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

export default async function handler(req, res) {
  let url;
  try {
    url = backendUrl(req);
  } catch (error) {
    res.status(500).json({ detail: error.message });
    return;
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else {
      headers.set(key, value);
    }
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? req : undefined,
    duplex: hasBody ? "half" : undefined,
  });

  res.status(response.status);
  response.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  });

  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(Buffer.from(value));
    }
  }
  res.end();
}
