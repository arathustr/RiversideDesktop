const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { app, BrowserWindow, dialog, net, session, shell } = require("electron");

const BASE_URL = "https://river-side.cc";
const PARTITION = "persist:riverside";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let forumSession = null;
async function getForumSession() {
  if (forumSession) return forumSession;
  if (!app.isReady()) await app.whenReady();
  forumSession = session.fromPartition(PARTITION);
  return forumSession;
}

let loginWindow = null;
let loginMonitorTimer = null;
let loginMonitorStopAt = 0;

let csrfCache = { token: null, expiresAt: 0 };
let sessionCache = { value: null, expiresAt: 0 };

const SESSION_CACHE_TTL_MS = 60 * 1000;
const CATEGORIES_CACHE_TTL_MS = 10 * 60 * 1000;
const EMOJIS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let categoriesCache = { value: null, expiresAt: 0 };
let emojisCache = { value: null, expiresAt: 0 };

const absoluteUrl = (urlOrPath) => {
  if (!urlOrPath) return null;
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return `${BASE_URL}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
};

const avatarUrlFromTemplate = (avatarTemplate, size = 96) => {
  if (!avatarTemplate) return null;
  const path = avatarTemplate.replace("{size}", String(size));
  return absoluteUrl(path);
};

const stripHtmlToText = (html) => {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
};

const guessMimeType = (fileName) => {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
};

function buildMultipartBody({ fields = {}, files = [] }) {
  const boundary = `----riverside-${crypto.randomBytes(16).toString("hex")}`;
  const crlf = "\r\n";
  /** @type {Buffer[]} */
  const chunks = [];

  for (const [name, value] of Object.entries(fields)) {
    if (value == null) continue;
    chunks.push(
      Buffer.from(
        `--${boundary}${crlf}` +
          `Content-Disposition: form-data; name="${name}"${crlf}${crlf}` +
          `${String(value)}${crlf}`,
        "utf8"
      )
    );
  }

  for (const f of files) {
    if (!f) continue;
    const fieldName = f.fieldName || "files[]";
    const fileName = String(f.fileName || "upload");
    const contentType = f.contentType || guessMimeType(fileName);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || "");

    chunks.push(
      Buffer.from(
        `--${boundary}${crlf}` +
          `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName.replaceAll(
            '"',
            '\\"'
          )}"${crlf}` +
          `Content-Type: ${contentType}${crlf}${crlf}`,
        "utf8"
      )
    );
    chunks.push(data);
    chunks.push(Buffer.from(crlf, "utf8"));
  }

  chunks.push(Buffer.from(`--${boundary}--${crlf}`, "utf8"));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(chunks),
  };
}

async function forumRequest(urlOrPath, init = {}) {
  const url = absoluteUrl(urlOrPath);
  const headers = /** @type {Record<string, string>} */ ({
    "User-Agent": UA,
    ...(init.headers || {}),
  });

  const method = String(init.method || "GET").toUpperCase();

  let body = init.body ?? null;
  if (body instanceof URLSearchParams) body = body.toString();

  const ses = await getForumSession();
  const timeoutMs = Number.isFinite(init.timeoutMs) ? Number(init.timeoutMs) : 25_000;

  return new Promise((resolve, reject) => {
    let done = false;
    const req = net.request({
      method,
      url,
      headers,
      session: ses,
      credentials: "include",
      redirect: "follow",
    });

    const timer = setTimeout(() => {
      try {
        req.abort();
      } catch {
        // ignore
      }
      if (done) return;
      done = true;
      reject(new Error(`Request timeout after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);

    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("error", (err) => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        reject(err);
      });
      res.on("end", () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          text,
        });
      });
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      reject(err);
    });

    if (body != null) req.write(body);
    req.end();
  });
}

async function fetchJson(urlOrPath, init = {}) {
  const res = await forumRequest(urlOrPath, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers || {}) },
  });

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${absoluteUrl(urlOrPath)}`);
    err.status = res.status;
    err.body = res.text;
    throw err;
  }

  try {
    return JSON.parse(res.text);
  } catch (e) {
    const err = new Error(`Invalid JSON for ${absoluteUrl(urlOrPath)}`);
    err.body = res.text.slice(0, 2000);
    err.cause = e;
    throw err;
  }
}

async function getCsrfToken() {
  if (csrfCache.token && Date.now() < csrfCache.expiresAt) return csrfCache.token;

  const res = await forumRequest("/", { headers: { Accept: "text/html" } });
  const html = res.text;
  const m = html.match(/<meta name="csrf-token" content="([^"]+)"\s*\/?>/i);
  if (!m) {
    const err = new Error("CSRF token not found");
    err.body = html.slice(0, 1000);
    throw err;
  }

  csrfCache = { token: m[1], expiresAt: Date.now() + 5 * 60 * 1000 };
  return csrfCache.token;
}

async function getSession() {
  try {
    const json = await fetchJson("/session/current.json");
    const u = json?.current_user;
    if (!u) return { loggedIn: false, currentUser: null };

    return {
      loggedIn: true,
      currentUser: {
        id: u.id,
        username: u.username,
        name: u.name || "",
        title: u.title || "",
        avatarUrl: avatarUrlFromTemplate(u.avatar_template, 96),
        unreadNotifications: u.unread_notifications ?? 0,
      },
    };
  } catch (e) {
    if (e && e.status === 404) return { loggedIn: false, currentUser: null };
    return { loggedIn: false, currentUser: null, error: String(e?.message || e) };
  }
}

async function getSessionCached() {
  if (sessionCache.value && Date.now() < sessionCache.expiresAt) return sessionCache.value;
  const sess = await getSession();
  sessionCache = { value: sess, expiresAt: Date.now() + SESSION_CACHE_TTL_MS };
  return sess;
}

async function getCategoriesCached() {
  if (categoriesCache.value && Date.now() < categoriesCache.expiresAt) return categoriesCache.value;
  const json = await fetchJson("/categories.json?include_subcategories=true");
  categoriesCache = { value: json, expiresAt: Date.now() + CATEGORIES_CACHE_TTL_MS };
  return json;
}

async function getEmojisCached() {
  if (emojisCache.value && Date.now() < emojisCache.expiresAt) return emojisCache.value;

  let json = null;
  try {
    const candidates = [path.join(app.getAppPath(), "emoji.json"), path.join(__dirname, "..", "emoji.json")];
    for (const p of candidates) {
      try {
        if (!fs.existsSync(p)) continue;
        const raw = fs.readFileSync(p, "utf8");
        json = JSON.parse(raw || "{}");
        break;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  if (!json) {
    json = await fetchJson("/emojis.json");
  }
  const list = [];
  if (json && typeof json === "object") {
    for (const [group, arr] of Object.entries(json)) {
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        const name = e?.name;
        const url = e?.url;
        if (!name || !url) continue;
        list.push({ name: String(name), url: absoluteUrl(url), group: String(group) });
      }
    }
  }

  emojisCache = { value: list, expiresAt: Date.now() + EMOJIS_CACHE_TTL_MS };
  return list;
}

async function listEmojis() {
  const emojis = await getEmojisCached();
  return { ok: true, emojis };
}

function notificationKindFromRaw(raw) {
  const t = Number(raw?.notification_type ?? raw?.notificationType ?? NaN);
  if (t === 1 || t === 15) return "mention";
  if (t === 2 || t === 3) return "reply";

  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  const key = String(
    data?.notification_type ||
      data?.notificationType ||
      data?.type ||
      raw?.notification_type_name ||
      raw?.notificationTypeName ||
      ""
  ).toLowerCase();
  if (key.includes("mention")) return "mention";
  if (key.includes("reply") || key.includes("replied") || key.includes("quote") || key.includes("quoted"))
    return "reply";
  return "other";
}

function mapNotificationFromRaw(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = Number(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};

  const createdAt = raw.created_at ?? raw.createdAt ?? new Date().toISOString();
  const read = !!raw.read;
  const kind = notificationKindFromRaw(raw);

  const username =
    data.display_username ??
    data.displayUsername ??
    data.username ??
    raw.username ??
    data.original_username ??
    data.originalUsername ??
    null;
  const userId = raw.user_id ?? data.user_id ?? data.userId ?? null;
  const avatarTemplate =
    raw.avatar_template ??
    data.avatar_template ??
    data.avatarTemplate ??
    data.user_avatar_template ??
    data.userAvatarTemplate ??
    null;
  const avatarUrl = avatarUrlFromTemplate(avatarTemplate, 64);

  const topicId = raw.topic_id ?? data.topic_id ?? data.topicId ?? null;
  const postNumber = raw.post_number ?? data.post_number ?? data.postNumber ?? null;
  const slug = raw.slug ?? data.slug ?? null;

  const chatChannelId =
    raw.chat_channel_id ??
    data.chat_channel_id ??
    data.chatChannelId ??
    data.channel_id ??
    data.channelId ??
    null;
  const chatMessageId =
    raw.chat_message_id ??
    data.chat_message_id ??
    data.chatMessageId ??
    data.message_id ??
    data.messageId ??
    null;

  const title =
    raw.fancy_title ??
    raw.fancyTitle ??
    data.fancy_title ??
    data.fancyTitle ??
    data.topic_title ??
    data.topicTitle ??
    data.chat_channel_title ??
    data.chatChannelTitle ??
    data.title ??
    raw.title ??
    null;

  const excerptRaw =
    data.excerpt ?? data.post_excerpt ?? data.postExcerpt ?? data.message_excerpt ?? data.messageExcerpt ?? null;
  const excerpt = excerptRaw ? stripHtmlToText(excerptRaw).slice(0, 200) : null;

  const urlPath = raw.url ?? raw.path ?? data.url ?? data.path ?? null;
  let url = urlPath ? absoluteUrl(urlPath) : null;
  if (!url && topicId && slug) {
    url = `${BASE_URL}/t/${encodeURIComponent(String(slug))}/${encodeURIComponent(String(topicId))}${
      postNumber ? `/${encodeURIComponent(String(postNumber))}` : ""
    }`;
  }
  if (!url && topicId) {
    url = `${BASE_URL}/t/${encodeURIComponent(String(topicId))}${postNumber ? `/${encodeURIComponent(String(postNumber))}` : ""}`;
  }

  const parsedChat = { channelId: null, messageId: null };
  if (url && url.includes("/chat/")) {
    const m1 = url.match(/\/chat\/c\/[^/]+\/(\d+)(?:\/(\d+))?/i);
    if (m1) {
      parsedChat.channelId = Number(m1[1]) || null;
      parsedChat.messageId = m1[2] ? Number(m1[2]) || null : null;
    }
    const m2 = url.match(/\/chat\/c\/-\/(\d+)(?:\/(\d+))?/i);
    if (m2) {
      parsedChat.channelId = Number(m2[1]) || parsedChat.channelId;
      parsedChat.messageId = m2[2] ? Number(m2[2]) || parsedChat.messageId : parsedChat.messageId;
    }
  }

  const finalChatChannelId =
    typeof chatChannelId === "number" ? chatChannelId : Number(chatChannelId) || parsedChat.channelId || null;
  const finalChatMessageId =
    typeof chatMessageId === "number" ? chatMessageId : Number(chatMessageId) || parsedChat.messageId || null;

  return {
    id,
    kind,
    read,
    createdAt,
    username: username ? String(username) : null,
    userId: typeof userId === "number" ? userId : Number(userId) || null,
    avatarUrl,
    title: title ? String(title) : null,
    excerpt,
    topicId: typeof topicId === "number" ? topicId : Number(topicId) || null,
    postNumber: typeof postNumber === "number" ? postNumber : Number(postNumber) || null,
    chatChannelId: finalChatChannelId,
    chatMessageId: finalChatMessageId,
    url,
  };
}

async function listNotifications(opts = {}) {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false, notifications: [] };

  const limitRaw = Number(opts?.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(80, Math.max(10, limitRaw)) : 50;

  const params = new URLSearchParams();
  params.set("limit", String(limit));

  const json = await fetchJson(`/notifications.json?${params.toString()}`);
  const raw = Array.isArray(json?.notifications) ? json.notifications : [];
  const mapped = raw.map(mapNotificationFromRaw).filter(Boolean);

  const wantsUnreadOnly = !!opts?.unreadOnly;
  const unreadOnly = wantsUnreadOnly ? mapped.filter((n) => !n.read) : mapped;

  const onlyKinds = Array.isArray(opts?.kinds) ? opts.kinds.map((k) => String(k)) : null;
  const filtered = onlyKinds ? unreadOnly.filter((n) => onlyKinds.includes(String(n.kind))) : unreadOnly;

  return {
    loggedIn: true,
    currentUser: sess.currentUser,
    notifications: filtered,
    unreadCount: mapped.filter((n) => !n.read).length,
  };
}

async function markNotificationRead({ id } = {}) {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false };

  const nid = Number(id);
  if (!Number.isFinite(nid) || nid <= 0) throw new Error("notification id is required");

  const csrf = await getCsrfToken();
  const body = new URLSearchParams();
  body.set("id", String(nid));

  const headers = {
    Accept: "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-CSRF-Token": csrf,
    "X-Requested-With": "XMLHttpRequest",
  };

  const candidates = [
    { method: "PUT", path: "/notifications/mark-read.json" },
    { method: "PUT", path: "/notifications/mark-read" },
    { method: "POST", path: "/notifications/mark-read.json" },
    { method: "POST", path: "/notifications/mark-read" },
  ];

  for (const c of candidates) {
    try {
      const res = await forumRequest(c.path, { method: c.method, headers, body });
      if (res.ok) return { loggedIn: true, ok: true };
      if (res.status === 404) continue;
    } catch {
      // ignore (try next)
    }
  }

  throw new Error("Mark notification read failed");
}

async function markAllNotificationsRead() {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false };

  const csrf = await getCsrfToken();
  const headers = {
    Accept: "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-CSRF-Token": csrf,
    "X-Requested-With": "XMLHttpRequest",
  };

  const candidates = [
    { method: "PUT", path: "/notifications/mark-read.json" },
    { method: "PUT", path: "/notifications/mark-read" },
    { method: "POST", path: "/notifications/mark-read.json" },
    { method: "POST", path: "/notifications/mark-read" },
  ];

  for (const c of candidates) {
    try {
      const res = await forumRequest(c.path, { method: c.method, headers, body: new URLSearchParams() });
      if (res.ok) return { loggedIn: true, ok: true };
      if (res.status === 404) continue;
    } catch {
      // ignore
    }
  }

  throw new Error("Mark all notifications read failed");
}

function stopLoginMonitor() {
  if (!loginMonitorTimer) return;
  clearInterval(loginMonitorTimer);
  loginMonitorTimer = null;
  loginMonitorStopAt = 0;
}

function startLoginMonitor() {
  if (loginMonitorTimer) return;

  loginMonitorStopAt = Date.now() + 10 * 60 * 1000;
  loginMonitorTimer = setInterval(async () => {
    try {
      if (!loginWindow || loginWindow.isDestroyed()) {
        stopLoginMonitor();
        return;
      }

      if (loginMonitorStopAt && Date.now() > loginMonitorStopAt) {
        stopLoginMonitor();
        return;
      }

      const sess = await getSession();
      if (sess.loggedIn) {
        loginWindow.close();
        stopLoginMonitor();
      }
    } catch {
      // ignore
    }
  }, 3500);
}

async function openLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 920,
    height: 720,
    resizable: true,
    title: "登录 River Side",
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  loginWindow.on("closed", () => {
    stopLoginMonitor();
    loginWindow = null;
  });

  loginWindow.loadURL(`${BASE_URL}/login`).catch(() => {});
  startLoginMonitor();
}

async function logout() {
  csrfCache = { token: null, expiresAt: 0 };
  sessionCache = { value: null, expiresAt: 0 };
  categoriesCache = { value: null, expiresAt: 0 };
  emojisCache = { value: null, expiresAt: 0 };
  const ses = await getForumSession();
  await ses.clearStorageData({
    storages: ["cookies", "localstorage", "sessionstorage", "indexdb", "serviceworkers", "cachestorage"],
  });
}

async function pickImages() {
  const res = await dialog.showOpenDialog({
    title: "选择图片",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
      },
    ],
  });

  return { canceled: res.canceled, filePaths: res.filePaths || [] };
}

async function uploadFile({ filePath, type }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  if (!filePath) throw new Error("filePath is required");

  const absPath = path.resolve(String(filePath));
  const fileName = path.basename(absPath);
  const data = await fs.promises.readFile(absPath);

  const csrf = await getCsrfToken();

  const tryTypes = Array.from(
    new Set([type, "chat_message", "composer"].filter((t) => typeof t === "string" && t.trim()))
  );

  /** @type {any} */
  let lastErr = null;

  for (const t of tryTypes) {
    const form = buildMultipartBody({
      fields: {
        type: t,
        synchronous: "true",
      },
      files: [
        {
          fieldName: "files[]",
          fileName,
          contentType: guessMimeType(fileName),
          data,
        },
      ],
    });

    try {
      const res = await forumRequest("/uploads.json", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": form.contentType,
          "X-CSRF-Token": csrf,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: form.body,
        timeoutMs: 60_000,
      });

      const text = res.text;
      if (!res.ok) {
        const err = new Error(`Upload failed (${t}): HTTP ${res.status}`);
        err.status = res.status;
        err.body = text;
        throw err;
      }

      const json = JSON.parse(text);
      const upload = json?.upload || (Array.isArray(json?.uploads) ? json.uploads[0] : null) || json;
      if (!upload?.id) throw new Error("Upload response missing id");

      return {
        loggedIn: true,
        upload: {
          id: upload.id,
          url: absoluteUrl(upload.url),
          shortUrl: upload.short_url || upload.shortUrl || null,
          originalFilename: upload.original_filename || upload.originalFilename || fileName,
          width: upload.width ?? null,
          height: upload.height ?? null,
          filesize: upload.filesize ?? null,
        },
      };
    } catch (e) {
      lastErr = e;
      if (e && (e.status === 422 || e.status === 400)) continue;
      throw e;
    }
  }

  throw lastErr || new Error("Upload failed");
}

function decodeDataUrlOrBase64(input) {
  const raw = String(input || "").trim();
  if (!raw) return { dataBase64: "", mimeType: null };
  const m = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) return { dataBase64: m[2], mimeType: m[1] };
  return { dataBase64: raw, mimeType: null };
}

async function uploadBytes({ dataBase64, fileName, mimeType, type }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const parsed = decodeDataUrlOrBase64(dataBase64);
  const base64 = parsed.dataBase64;
  const ct = String(mimeType || parsed.mimeType || "").trim() || null;

  if (!base64) throw new Error("dataBase64 is required");

  const safeFileName = String(fileName || "").trim() || "upload.png";
  const data = Buffer.from(base64, "base64");

  const csrf = await getCsrfToken();

  const tryTypes = Array.from(
    new Set([type, "chat_message", "composer"].filter((t) => typeof t === "string" && t.trim()))
  );

  /** @type {any} */
  let lastErr = null;

  for (const t of tryTypes) {
    const form = buildMultipartBody({
      fields: {
        type: t,
        synchronous: "true",
      },
      files: [
        {
          fieldName: "files[]",
          fileName: safeFileName,
          contentType: ct || guessMimeType(safeFileName),
          data,
        },
      ],
    });

    try {
      const res = await forumRequest("/uploads.json", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": form.contentType,
          "X-CSRF-Token": csrf,
          "X-Requested-With": "XMLHttpRequest",
        },
        body: form.body,
        timeoutMs: 60_000,
      });

      const text = res.text;
      if (!res.ok) {
        const err = new Error(`Upload failed (${t}): HTTP ${res.status}`);
        err.status = res.status;
        err.body = text;
        throw err;
      }

      const json = JSON.parse(text);
      const upload = json?.upload || (Array.isArray(json?.uploads) ? json.uploads[0] : null) || json;
      if (!upload?.id) throw new Error("Upload response missing id");

      return {
        loggedIn: true,
        upload: {
          id: upload.id,
          url: absoluteUrl(upload.url),
          shortUrl: upload.short_url || upload.shortUrl || null,
          originalFilename: upload.original_filename || upload.originalFilename || safeFileName,
          width: upload.width ?? null,
          height: upload.height ?? null,
          filesize: upload.filesize ?? null,
        },
      };
    } catch (e) {
      lastErr = e;
      if (e && (e.status === 422 || e.status === 400)) continue;
      throw e;
    }
  }

  throw lastErr || new Error("Upload failed");
}

let profileWindow = null;

async function openProfileSettings() {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  if (profileWindow && !profileWindow.isDestroyed()) {
    profileWindow.focus();
    return { loggedIn: true };
  }

  const username = sess.currentUser.username;

  profileWindow = new BrowserWindow({
    width: 980,
    height: 760,
    resizable: true,
    title: "个人资料设置",
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  profileWindow.on("closed", () => {
    profileWindow = null;
  });

  profileWindow
    .loadURL(`${BASE_URL}/u/${encodeURIComponent(username)}/preferences/profile`)
    .catch(() => {});

  return { loggedIn: true };
}

async function getMyProfile() {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const username = sess.currentUser.username;
  const json = await fetchJson(`/u/${encodeURIComponent(username)}.json`);
  const u = json?.user || {};

  return {
    loggedIn: true,
    profile: {
      username,
      name: u.name || "",
      title: u.title || "",
      bioRaw: u.bio_raw || "",
      avatarUrl: avatarUrlFromTemplate(u.avatar_template, 128) || sess.currentUser.avatarUrl || null,
    },
  };
}

async function updateMyProfile({ name, title, bioRaw }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const csrf = await getCsrfToken();
  const username = sess.currentUser.username;

  const body = new URLSearchParams();
  if (name != null) body.set("name", String(name));
  if (title != null) body.set("title", String(title));
  if (bioRaw != null) body.set("bio_raw", String(bioRaw));

  const res = await forumRequest(`/u/${encodeURIComponent(username)}.json`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-Token": csrf,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });

  const text = res.text;
  if (!res.ok) {
    const err = new Error(`Update profile failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  return { loggedIn: true, result: JSON.parse(text) };
}

async function updateMyAvatar({ filePath }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };
  if (!filePath) throw new Error("filePath is required");

  const up = await uploadFile({ filePath, type: "avatar" });
  const uploadId = up?.upload?.id;
  if (!uploadId) throw new Error("Upload missing id");

  const csrf = await getCsrfToken();
  const username = sess.currentUser.username;

  const tryTypes = ["custom", "uploaded"];
  /** @type {any} */
  let lastErr = null;

  for (const t of tryTypes) {
    const body = new URLSearchParams();
    body.set("upload_id", String(uploadId));
    body.set("type", t);

    const res = await forumRequest(`/u/${encodeURIComponent(username)}/preferences/avatar/pick.json`, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-Token": csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
    });

    const text = res.text;
    if (res.ok) {
      return { loggedIn: true, upload: up.upload, result: JSON.parse(text) };
    }

    const err = new Error(`Update avatar failed (${t}): HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    lastErr = err;
    if (res.status === 422 || res.status === 400) continue;
    throw err;
  }

  throw lastErr || new Error("Update avatar failed");
}

function buildUsersMap(users = []) {
  const map = new Map();
  for (const u of users) map.set(u.id, u);
  return map;
}

function mapCategory(c, override = {}) {
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    slug: override.slug ?? c.slug,
    description: c.description || "",
    color: c.color || "",
    textColor: c.text_color || "",
    position: c.position ?? 0,
    parentId: c.parent_category_id ?? null,
    permission: c.permission ?? null,
  };
}

async function listPrivateMessages() {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, conversations: [] };

  const username = sess.currentUser.username;
  const json = await fetchJson(`/topics/private-messages/${encodeURIComponent(username)}.json`);

  const usersMap = buildUsersMap(json.users || []);
  const topics = json?.topic_list?.topics || [];

  const conversations = topics.map((t) => {
    const participantIds = (t.participants || [])
      .map((p) => p.user_id)
      .filter((id) => typeof id === "number");
    const participants = participantIds
      .map((id) => usersMap.get(id))
      .filter(Boolean)
      .map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name || "",
        avatarUrl: avatarUrlFromTemplate(u.avatar_template, 64),
      }));

    const counterpart = participants.find((p) => p.username !== username) || participants[0] || null;

    return {
      id: t.id,
      title: counterpart ? (counterpart.name || counterpart.username) : t.title,
      topicTitle: t.title,
      counterpart,
      participants,
      lastPostedAt: t.last_posted_at,
      unread: t.unread_posts ?? 0,
      isGroup: (t.allowed_user_count || 0) > 2,
    };
  });

  return { loggedIn: true, currentUser: sess.currentUser, conversations };
}

const CHAT_KINDS = /** @type {const} */ ({
  public: "public",
  dm: "dm",
});

function mapChatUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name || "",
    avatarUrl: avatarUrlFromTemplate(u.avatar_template, 64),
  };
}

function getDmChannelTitle(channel, currentUser) {
  const meId = currentUser?.id;
  const users = channel?.chatable?.users || [];
  const others = users.filter((u) => u && u.id !== meId);
  const names = others.map((u) => u.name || u.username).filter(Boolean);
  if (names.length === 0) return channel?.unicode_title || channel?.title || "私聊";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} · ${names[1]}`;
  return `${names[0]} · ${names[1]} +${names.length - 2}`;
}

function mapChatChannel(channel, currentUser, kind) {
  const id = channel?.id;
  const last = channel?.last_message || null;
  const lastMessageAt = last?.created_at || last?.createdAt || null;
  const lastReadId = channel?.current_user_membership?.last_read_message_id ?? 0;
  const lastId = last?.id ?? 0;
  const unread = lastId && lastId > lastReadId ? 1 : 0;

  const participants =
    kind === CHAT_KINDS.dm
      ? (channel?.chatable?.users || []).map(mapChatUser).filter(Boolean)
      : [];

  const isGroup =
    kind === CHAT_KINDS.dm ? !!(channel?.chatable?.group || participants.length > 2) : false;

  const title =
    kind === CHAT_KINDS.dm
      ? getDmChannelTitle(channel, currentUser)
      : channel?.unicode_title || channel?.title || `频道 ${String(id)}`;

  const others = participants.filter((p) => p && p.id !== currentUser?.id);
  const avatarUrl =
    kind === CHAT_KINDS.dm && others.length === 1 ? others[0].avatarUrl || null : null;

  const lastMessagePreview =
    last?.excerpt || last?.message || stripHtmlToText(last?.cooked) || "";

  return {
    id,
    kind,
    title,
    description: channel?.description || "",
    participants,
    avatarUrl,
    lastMessageAt,
    lastMessagePreview,
    unread,
    isGroup,
    url: `${BASE_URL}/chat/c/-/${encodeURIComponent(String(id))}`,
  };
}

async function listChatChannels() {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false, channels: [] };

  let json;
  try {
    json = await fetchJson("/chat/api/me/channels");
  } catch (e) {
    if (e && (e.status === 404 || e.status === 403)) {
      return { loggedIn: true, currentUser: sess.currentUser, channels: [] };
    }
    throw e;
  }

  const publicChannels = Array.isArray(json?.public_channels) ? json.public_channels : [];
  const dmChannels = Array.isArray(json?.direct_message_channels)
    ? json.direct_message_channels
    : [];

  const channels = [
    ...publicChannels.map((c) => mapChatChannel(c, sess.currentUser, CHAT_KINDS.public)),
    ...dmChannels.map((c) => mapChatChannel(c, sess.currentUser, CHAT_KINDS.dm)),
  ]
    .filter((c) => c && typeof c.id === "number")
    .sort((a, b) => {
      const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return tb - ta;
    });

  return { loggedIn: true, currentUser: sess.currentUser, channels };
}

function mapChatMessagesFromRaw(rawMessages, meId) {
  const temp = rawMessages.map((m) => {
    const u = m.user || {};
    const userId = m.user_id ?? u.id;
    const username = m.username ?? u.username ?? "system";
    const avatarTemplate = m.avatar_template ?? u.avatar_template;

    const uploadsRaw =
      m.uploads ??
      m.message_uploads ??
      m.messageUploads ??
      m.chat_message_uploads ??
      m.chatMessageUploads ??
      null;

    const uploads = Array.isArray(uploadsRaw)
      ? uploadsRaw
          .map((up) => {
            if (!up) return null;
            const url =
              up.url ||
              up.original_url ||
              up.originalUrl ||
              up.href ||
              up.full_url ||
              up.fullUrl ||
              null;
            if (!url) return null;
            const thumb =
              up.thumbnail_url || up.thumbnailUrl || up.thumb_url || up.thumbUrl || null;
            return {
              url: absoluteUrl(url),
              thumbnailUrl: thumb ? absoluteUrl(thumb) : null,
              originalFilename:
                up.original_filename ||
                up.originalFilename ||
                up.filename ||
                up.fileName ||
                null,
              width: up.width ?? null,
              height: up.height ?? null,
            };
          })
          .filter(Boolean)
      : [];

    const replyObjRaw =
      m.in_reply_to ??
      m.in_reply_to_message ??
      m.in_reply_to_chat_message ??
      m.inReplyTo ??
      m.inReplyToMessage ??
      m.reply_to ??
      null;

    const replyObj =
      replyObjRaw && typeof replyObjRaw === "object"
        ? replyObjRaw.chat_message ||
          replyObjRaw.chatMessage ||
          replyObjRaw.message ||
          replyObjRaw
        : null;

    const replyId =
      m.in_reply_to_id ??
      m.in_reply_to_message_id ??
      m.in_reply_to_chat_message_id ??
      m.inReplyToId ??
      replyObj?.id ??
      replyObj?.message_id ??
      replyObj?.chat_message_id ??
      replyObj?.chatMessageId ??
      (typeof replyObjRaw === "number" || typeof replyObjRaw === "string" ? replyObjRaw : null) ??
      null;

    /** @type {any} */
    let replyTo = null;
    if (replyId != null) {
      const r = replyObj || {};
      const ru = r.user || {};
      const replyUsername = r.username ?? r.user_username ?? r.userUsername ?? ru.username ?? null;
      const replyAvatarTemplate =
        r.avatar_template ??
        r.avatarTemplate ??
        r.user_avatar_template ??
        r.userAvatarTemplate ??
        ru.avatar_template ??
        null;
      const replyExcerptRaw = r.excerpt ?? r.message ?? r.cooked ?? "";
      const replyExcerpt = stripHtmlToText(replyExcerptRaw).slice(0, 140);
      if (replyUsername) {
        replyTo = {
          messageId: typeof replyId === "number" ? replyId : Number(replyId),
          username: replyUsername,
          avatarUrl: avatarUrlFromTemplate(replyAvatarTemplate, 48),
          excerpt: replyExcerpt,
        };
      }
    }

    return {
      msg: {
        id: m.id,
        from: userId === meId ? "me" : username === "system" ? "system" : "them",
        userId: typeof userId === "number" ? userId : null,
        username,
        avatarUrl: avatarUrlFromTemplate(avatarTemplate, 64),
        cooked: m.cooked ?? m.message ?? "",
        createdAt: m.created_at ?? m.createdAt ?? new Date().toISOString(),
        replyTo,
        uploads,
      },
      replyId,
    };
  });

  const byId = new Map(temp.map((t) => [t.msg.id, t.msg]));
  for (const t of temp) {
    if (t.msg.replyTo) continue;
    if (t.replyId == null) continue;
    const rid = typeof t.replyId === "number" ? t.replyId : Number(t.replyId);
    if (!Number.isFinite(rid) || rid <= 0) continue;
    const ref = byId.get(rid);
    if (!ref) continue;
    t.msg.replyTo = {
      messageId: rid,
      username: ref.username,
      avatarUrl: ref.avatarUrl,
      excerpt: stripHtmlToText(ref.cooked).slice(0, 140),
    };
  }

  const messages = temp.map((t) => t.msg);

  messages.sort((a, b) => (a.id || 0) - (b.id || 0));
  return messages;
}

async function getChatMessages(channelId, opts = {}) {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false, messages: [] };

  const params = new URLSearchParams();
  params.set("page_size", String(opts.pageSize ?? 50));
  const wantsCursor = !!(opts?.direction || opts?.targetMessageId != null);
  if (opts.direction) params.set("direction", String(opts.direction));
  if (opts.targetMessageId != null) params.set("target_message_id", String(opts.targetMessageId));

  let json = null;
  try {
    json = await fetchJson(
      `/chat/api/channels/${encodeURIComponent(String(channelId))}/messages?${params.toString()}`
    );
  } catch (e) {
    if (wantsCursor && e && e.status === 400) {
      const fallbackParams = new URLSearchParams();
      fallbackParams.set("page_size", String(opts.pageSize ?? 50));
      json = await fetchJson(
        `/chat/api/channels/${encodeURIComponent(String(channelId))}/messages?${fallbackParams.toString()}`
      );
    } else {
      throw e;
    }
  }

  const meId = sess.currentUser.id;
  const rawMessages = Array.isArray(json?.messages) ? json.messages : [];
  const messages = mapChatMessagesFromRaw(rawMessages, meId);

  return {
    loggedIn: true,
    currentUser: sess.currentUser,
    meta: json?.meta || null,
    messages,
  };
}

async function sendChatMessage({ channelId, message, uploadIds, replyToMessageId }) {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false };

  const csrf = await getCsrfToken();
  const body = new URLSearchParams();
  body.set("message", message ?? "");
  body.set("client_created_at", new Date().toISOString());
  const replyId = replyToMessageId == null ? null : Number(replyToMessageId);
  if (Number.isFinite(replyId) && replyId > 0) {
    body.set("in_reply_to_id", String(replyId));
    body.set("in_reply_to_message_id", String(replyId));
  }
  if (Array.isArray(uploadIds)) {
    for (const id of uploadIds) {
      if (id == null) continue;
      body.append("upload_ids[]", String(id));
    }
  }

  let res = null;
  try {
    res = await forumRequest(`/chat/api/channels/${encodeURIComponent(String(channelId))}/messages`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-Token": csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
    });
  } catch (e) {
    res = null;
  }

  if (!res || res.status === 404) {
    res = await forumRequest(`/chat/${encodeURIComponent(String(channelId))}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-Token": csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
    });
  }

  const text = res.text;
  if (!res.ok) {
    const err = new Error(`Send chat message failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  /** @type {any} */
  let payload = null;
  try {
    payload = JSON.parse(text || "{}");
  } catch {
    payload = null;
  }

  const pickObject = (v) => (v && typeof v === "object" ? v : null);

  const candidates = [
    pickObject(payload?.message),
    pickObject(payload?.chat_message),
    pickObject(payload?.chatMessage),
    pickObject(payload?.data?.message),
    pickObject(payload?.data?.chat_message),
    pickObject(payload?.result?.message),
    pickObject(payload?.result?.chat_message),
  ].filter(Boolean);

  /** @type {any} */
  let rawMsg = null;
  for (const c of candidates) {
    if (!c) continue;
    rawMsg = c.chat_message || c.chatMessage || c.message || c;
    if (rawMsg && typeof rawMsg === "object") break;
    rawMsg = null;
  }

  const meId = sess.currentUser.id;
  const mapped = rawMsg ? mapChatMessagesFromRaw([rawMsg], meId)[0] || null : null;

  const fallbackId =
    payload?.message_id ??
    payload?.messageId ??
    payload?.chat_message_id ??
    payload?.chatMessageId ??
    payload?.id ??
    mapped?.id ??
    null;

  return {
    loggedIn: true,
    message: mapped,
    messageId: typeof fallbackId === "number" ? fallbackId : Number(fallbackId) || null,
  };
}

async function markChatChannelRead({ channelId, messageId } = {}) {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false };

  const id = String(channelId || "").trim();
  if (!id) throw new Error("channelId is required");

  const csrf = await getCsrfToken();
  const body = new URLSearchParams();
  const mid = messageId == null ? null : Number(messageId);
  if (Number.isFinite(mid) && mid > 0) body.set("message_id", String(mid));

  const headers = {
    Accept: "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/chat/c/-/${encodeURIComponent(id)}`,
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-CSRF-Token": csrf,
    "X-Requested-With": "XMLHttpRequest",
  };

  const candidates = [
    { method: "PUT", path: `/chat/api/channels/${encodeURIComponent(id)}/mark-read` },
    { method: "PUT", path: `/chat/api/channels/${encodeURIComponent(id)}/mark_read` },
    { method: "PUT", path: `/chat/api/channels/${encodeURIComponent(id)}/read` },
    { method: "POST", path: `/chat/api/channels/${encodeURIComponent(id)}/mark-read` },
    { method: "POST", path: `/chat/api/channels/${encodeURIComponent(id)}/mark_read` },
    { method: "POST", path: `/chat/api/channels/${encodeURIComponent(id)}/read` },
  ];

  for (const c of candidates) {
    try {
      const res = await forumRequest(c.path, { method: c.method, headers, body });
      if (res.ok) return { loggedIn: true, ok: true };
      if (res.status === 404) continue;
    } catch {
      // ignore and try next
    }
  }

  return { loggedIn: true, ok: false };
}

async function getTopic(topicId) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const json = await fetchJson(`/t/${encodeURIComponent(String(topicId))}.json`);

  const participants = (json?.details?.participants || []).map((p) => ({
    id: p.id,
    username: p.username,
    name: p.name || "",
    avatarUrl: avatarUrlFromTemplate(p.avatar_template, 64),
  }));

  const meId = sess.currentUser.id;
  const streamPosts = Array.isArray(json?.post_stream?.posts) ? json.post_stream.posts : [];
  const postByNumber = new Map(streamPosts.map((p) => [p.post_number, p]));

  const messages = streamPosts.map((p) => {
    const replyToPostNumber = p.reply_to_post_number;
    const repliedPost =
      typeof replyToPostNumber === "number" ? postByNumber.get(replyToPostNumber) || null : null;

    const replyToUser = repliedPost
      ? {
          username: repliedPost.username,
          avatar_template: repliedPost.avatar_template,
        }
      : p.reply_to_user || null;

    const replyTo =
      typeof replyToPostNumber === "number" && replyToUser?.username
        ? {
            postNumber: replyToPostNumber,
            username: replyToUser.username,
            avatarUrl: avatarUrlFromTemplate(replyToUser.avatar_template, 48),
            excerpt: repliedPost ? stripHtmlToText(repliedPost.cooked).slice(0, 140) : "",
          }
        : null;

    return {
      id: p.id,
      postNumber: p.post_number ?? null,
      from: p.user_id === meId ? "me" : p.username === "system" ? "system" : "them",
      userId: p.user_id ?? null,
      username: p.username,
      avatarUrl: avatarUrlFromTemplate(p.avatar_template, 64),
      cooked: p.cooked,
      createdAt: p.created_at,
      replyTo,
    };
  });

  return {
    loggedIn: true,
    currentUser: sess.currentUser,
    topic: {
      id: json.id,
      title: json.title,
      slug: json.slug,
      participants,
    },
    messages,
  };
}

async function replyTopic({ topicId, raw, uploadIds, replyToPostNumber }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const csrf = await getCsrfToken();
  const body = new URLSearchParams();
  body.set("topic_id", String(topicId));
  body.set("raw", raw);
  const replyToNumber = replyToPostNumber == null ? null : Number(replyToPostNumber);
  if (Number.isFinite(replyToNumber) && replyToNumber > 0) {
    body.set("reply_to_post_number", String(replyToNumber));
  }
  if (Array.isArray(uploadIds)) {
    for (const id of uploadIds) {
      if (id == null) continue;
      body.append("upload_ids[]", String(id));
    }
  }

  const res = await forumRequest("/posts.json", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/t/${encodeURIComponent(String(topicId))}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-Token": csrf,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });

  const text = res.text;
  if (!res.ok) {
    const err = new Error(`Reply failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  return JSON.parse(text);
}

async function listLatest(payload = {}) {
  const sess = await getSessionCached();
  if (!sess.loggedIn) return { loggedIn: false, posts: [] };

  const pageRaw = payload?.page != null ? Number(payload.page) : null;
  const page = pageRaw != null && Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const latest = await fetchJson(page > 1 ? `/latest.json?page=${encodeURIComponent(String(page))}` : "/latest.json");
  let categories = null;
  try {
    categories = await getCategoriesCached();
  } catch (e) {
    if (categoriesCache.value) {
      categories = categoriesCache.value;
    } else {
      categories = { category_list: { categories: [] } };
    }
  }

  const usersMap = buildUsersMap(latest.users || []);
  const rootCategories = categories?.category_list?.categories || [];

  const rawCategories = [];
  const seenCategoryIds = new Set();
  const walkCategory = (c) => {
    if (!c || typeof c.id !== "number") return;
    if (seenCategoryIds.has(c.id)) return;
    seenCategoryIds.add(c.id);
    rawCategories.push(c);
    const subs = Array.isArray(c.subcategory_list) ? c.subcategory_list : [];
    for (const s of subs) walkCategory(s);
  };
  for (const c of rootCategories) walkCategory(c);

  const categoriesMap = new Map(rawCategories.map((c) => [c.id, c]));

  const slugPathCache = new Map();
  const getCategorySlugPath = (cat) => {
    if (!cat) return "";
    if (slugPathCache.has(cat.id)) return slugPathCache.get(cat.id);

    const slug = String(cat.slug || "").trim();
    if (!slug) {
      slugPathCache.set(cat.id, "");
      return "";
    }

    const parentId = cat.parent_category_id;
    if (!parentId) {
      slugPathCache.set(cat.id, slug);
      return slug;
    }

    const parent = categoriesMap.get(parentId) || null;
    const parentPath = parent ? getCategorySlugPath(parent) : "";
    const path = parentPath ? `${parentPath}/${slug}` : slug;
    slugPathCache.set(cat.id, path);
    return path;
  };

  const categoryList = rawCategories
    .map((c) => mapCategory(c, { slug: getCategorySlugPath(c) }))
    .filter(Boolean)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const topics = latest?.topic_list?.topics || [];

  const posts = topics
    .filter((t) => t.archetype !== "private_message")
    .map((t) => {
      const op = (t.posters || [])[0];
      const u = op ? usersMap.get(op.user_id) : null;
      const c = categoriesMap.get(t.category_id);
      return {
        id: t.id,
        title: t.title,
        slug: t.slug,
        excerpt: t.excerpt || "",
        likeCount: t.like_count ?? 0,
        liked: t.liked ?? false,
        replyCount: t.reply_count ?? 0,
        views: t.views ?? 0,
        lastPostedAt: t.last_posted_at,
        createdAt: t.created_at,
        category: c
          ? { id: c.id, name: c.name, color: c.color, textColor: c.text_color }
          : null,
        author: u
          ? {
              id: u.id,
              username: u.username,
              name: u.name || "",
              avatarUrl: avatarUrlFromTemplate(u.avatar_template, 64),
            }
          : null,
        url: `${BASE_URL}/t/${t.slug}/${t.id}`,
      };
    });

  return { loggedIn: true, posts, categories: categoryList };
}

async function listUserCreatedTopics({ username } = {}) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, posts: [] };

  const uName = String(username || "").trim();
  if (!uName) throw new Error("username is required");

  const [created, categories] = await Promise.all([
    fetchJson(`/topics/created-by/${encodeURIComponent(uName)}.json`),
    fetchJson("/categories.json?include_subcategories=true"),
  ]);

  const usersMap = buildUsersMap(created.users || []);
  const rootCategories = categories?.category_list?.categories || [];

  const rawCategories = [];
  const seenCategoryIds = new Set();
  const walkCategory = (c) => {
    if (!c || typeof c.id !== "number") return;
    if (seenCategoryIds.has(c.id)) return;
    seenCategoryIds.add(c.id);
    rawCategories.push(c);
    const subs = Array.isArray(c.subcategory_list) ? c.subcategory_list : [];
    for (const s of subs) walkCategory(s);
  };
  for (const c of rootCategories) walkCategory(c);

  const categoriesMap = new Map(rawCategories.map((c) => [c.id, c]));

  const topics = created?.topic_list?.topics || [];
  const posts = topics
    .filter((t) => t.archetype !== "private_message")
    .map((t) => {
      const op = (t.posters || [])[0];
      const u = op ? usersMap.get(op.user_id) : null;
      const c = categoriesMap.get(t.category_id) || null;

      const replyCount =
        t.reply_count ??
        (Number.isFinite(t.posts_count) ? Math.max(0, Number(t.posts_count) - 1) : 0);

      return {
        id: t.id,
        title: t.title,
        slug: t.slug,
        excerpt: t.excerpt || "",
        likeCount: t.like_count ?? 0,
        liked: t.liked ?? false,
        replyCount,
        views: t.views ?? 0,
        lastPostedAt: t.last_posted_at || null,
        createdAt: t.created_at,
        category: c ? { id: c.id, name: c.name, color: c.color, textColor: c.text_color } : null,
        author: u
          ? {
              id: u.id,
              username: u.username,
              name: u.name || "",
              avatarUrl: avatarUrlFromTemplate(u.avatar_template, 64),
            }
          : null,
        url: `${BASE_URL}/t/${t.slug}/${t.id}`,
      };
    });

  return { loggedIn: true, posts };
}

async function listCategoryTopics({ categoryId, slug, page } = {}) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, posts: [] };

  const id = Number(categoryId);
  if (!Number.isFinite(id)) throw new Error("categoryId is required");

  const pageRaw = page != null ? Number(page) : null;
  const pageNum = pageRaw != null && Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageQs = pageNum > 1 ? `?page=${encodeURIComponent(String(pageNum))}` : "";

  const categorySlug = String(slug || "").trim();
  let json = null;

  if (categorySlug) {
    const slugPath = categorySlug
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join("/");

    try {
      json = await fetchJson(`/c/${slugPath}/${encodeURIComponent(String(id))}.json${pageQs}`);
    } catch (e) {
      json = null;
    }
  }

  if (!json) {
    json = await fetchJson(`/c/${encodeURIComponent(String(id))}.json${pageQs}`);
  }
  const usersMap = buildUsersMap(json.users || []);

  const categoriesMap = new Map();
  if (json?.category?.id) categoriesMap.set(json.category.id, json.category);

  const topics = json?.topic_list?.topics || [];
  const posts = topics
    .filter((t) => t.archetype !== "private_message")
    .map((t) => {
      const op = (t.posters || [])[0];
      const u = op ? usersMap.get(op.user_id) : null;
      const c = categoriesMap.get(t.category_id) || null;
      return {
        id: t.id,
        title: t.title,
        slug: t.slug,
        excerpt: t.excerpt || "",
        likeCount: t.like_count ?? 0,
        liked: t.liked ?? false,
        replyCount: t.reply_count ?? 0,
        views: t.views ?? 0,
        lastPostedAt: t.last_posted_at,
        createdAt: t.created_at,
        category: c
          ? { id: c.id, name: c.name, color: c.color, textColor: c.text_color }
          : null,
        author: u
          ? {
              id: u.id,
              username: u.username,
              name: u.name || "",
              avatarUrl: avatarUrlFromTemplate(u.avatar_template, 64),
            }
          : null,
        url: `${BASE_URL}/t/${t.slug}/${t.id}`,
      };
    });

  return { loggedIn: true, category: mapCategory(json.category), posts };
}

async function getTopicFirstPostId(topicId) {
  const json = await fetchJson(`/t/${encodeURIComponent(String(topicId))}.json`);
  const first = json?.post_stream?.posts?.[0];
  if (!first?.id) throw new Error("Cannot find first post id");
  return first.id;
}

async function setLikeOnTopic({ topicId, liked }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const csrf = await getCsrfToken();
  const firstPostId = await getTopicFirstPostId(topicId);

  if (liked) {
    const res = await forumRequest("/post_actions.json", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-Token": csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: new URLSearchParams({
        id: String(firstPostId),
        post_action_type_id: "2",
      }),
    });
    const text = res.text;
    if (!res.ok) throw new Error(`Like failed: HTTP ${res.status}`);
    return { loggedIn: true, liked: true, post: JSON.parse(text) };
  }

  const res = await forumRequest(
    `/post_actions/${encodeURIComponent(String(firstPostId))}.json?post_action_type_id=2`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "X-CSRF-Token": csrf,
        "X-Requested-With": "XMLHttpRequest",
      },
    }
  );
  const text = res.text;
  if (!res.ok) throw new Error(`Unlike failed: HTTP ${res.status}`);
  return { loggedIn: true, liked: false, post: JSON.parse(text) };
}

function mapBasicUser(u, size = 64) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    name: u.name || "",
    title: u.title || "",
    avatarUrl: avatarUrlFromTemplate(u.avatar_template || u.avatarTemplate, size),
  };
}

async function searchUsers({ term, limit } = {}) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, users: [] };

  const q = String(term || "").trim();
  if (!q) return { loggedIn: true, users: [] };

  const params = new URLSearchParams();
  params.set("term", q);
  if (Number.isFinite(limit)) params.set("limit", String(limit));

  const json = await fetchJson(`/u/search/users.json?${params.toString()}`);
  const raw = Array.isArray(json?.users) ? json.users : Array.isArray(json) ? json : [];
  const users = raw.map((u) => mapBasicUser(u, 64)).filter(Boolean);
  return { loggedIn: true, users };
}

async function getUserByUsername(username) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, user: null };

  const u = String(username || "").trim();
  if (!u) throw new Error("username is required");

  const json = await fetchJson(`/u/${encodeURIComponent(u)}.json`);
  const raw = json?.user || json?.users?.[0] || null;
  const base = mapBasicUser(raw, 96);
  const user = base
    ? {
        ...base,
        bioRaw: raw?.bio_raw || raw?.bioRaw || "",
        bioCooked: raw?.bio_cooked || raw?.bioCooked || "",
        location: raw?.location || "",
        website: raw?.website || raw?.website_name || "",
        createdAt: raw?.created_at || null,
        lastSeenAt: raw?.last_seen_at || null,
        trustLevel: Number.isFinite(raw?.trust_level) ? raw.trust_level : null,
      }
    : null;
  if (!user) throw new Error("User not found");
  return { loggedIn: true, user };
}

async function tryCreateDirectMessageChannel({ userIds = [], usernames = [] }) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, channelId: null };

  const csrf = await getCsrfToken();
  const ids = Array.from(new Set((userIds || []).filter((n) => typeof n === "number")));
  const names = Array.from(
    new Set((usernames || []).map((s) => String(s || "").trim()).filter(Boolean))
  );

  if (names.length === 0 && ids.length === 0) {
    return { loggedIn: true, channelId: null, reason: "target user is required" };
  }

  const usernamesCsv = names.join(",");
  const commonHeaders = {
    Accept: "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/chat`,
    "X-CSRF-Token": csrf,
    "X-Requested-With": "XMLHttpRequest",
  };

  const parseErrorReason = (text) => {
    if (!text) return null;
    try {
      const j = JSON.parse(text);
      const errors = Array.isArray(j?.errors) ? j.errors.filter(Boolean).join("；") : "";
      const msg = j?.error || j?.message || j?.error_type || j?.errorType || "";
      return errors || msg || null;
    } catch {
      if (/not found/i.test(text)) return "Not Found";
      if (/forbidden/i.test(text)) return "Forbidden";
      return null;
    }
  };

  const attempts = [];

  if (usernamesCsv) {
    attempts.push({
      path: `/chat/direct_messages.json?usernames=${encodeURIComponent(usernamesCsv)}`,
      method: "GET",
      body: null,
      headers: { ...commonHeaders },
    });
  }

  // Discourse Chat API (newer): /chat/api/direct-message-channels
  attempts.push({
    path: "/chat/api/direct-message-channels",
    method: "POST",
    body: JSON.stringify({ target_usernames: names, upsert: true }),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json",
    },
  });

  attempts.push({
    path: "/chat/api/direct-message-channels.json",
    method: "POST",
    body: JSON.stringify({ target_usernames: names, upsert: true }),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json",
    },
  });

  attempts.push({
    path: "/chat/api/direct-message-channels",
    method: "POST",
    body: (() => {
      const b = new URLSearchParams();
      for (const n of names) b.append("target_usernames[]", n);
      b.set("upsert", "true");
      return b;
    })(),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
  });

  attempts.push({
    path: "/chat/api/direct-message-channels.json",
    method: "POST",
    body: (() => {
      const b = new URLSearchParams();
      for (const n of names) b.append("target_usernames[]", n);
      b.set("upsert", "true");
      return b;
    })(),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
  });

  // Discourse Chat API (newer)
  attempts.push({
    path: "/chat/api/direct_messages",
    method: "POST",
    body: JSON.stringify({ target_usernames: names, upsert: true }),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json",
    },
  });

  attempts.push({
    path: "/chat/api/direct_messages",
    method: "POST",
    body: (() => {
      const b = new URLSearchParams();
      for (const n of names) b.append("target_usernames[]", n);
      b.set("upsert", "true");
      return b;
    })(),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
  });

  // Compatibility: some sites still accept legacy params
  attempts.push({
    path: "/chat/api/direct_messages",
    method: "POST",
    body: JSON.stringify({ usernames: usernamesCsv, upsert: true, user_ids: ids }),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json",
    },
  });

  attempts.push({
    path: "/chat/api/direct_messages",
    method: "POST",
    body: (() => {
      const b = new URLSearchParams();
      if (usernamesCsv) b.set("usernames", usernamesCsv);
      for (const id of ids) b.append("user_ids[]", String(id));
      b.set("upsert", "true");
      return b;
    })(),
    headers: {
      ...commonHeaders,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
  });

  /** @type {string|null} */
  let lastReason = null;

  for (const a of attempts) {
    try {
      const res = await forumRequest(a.path, {
        method: a.method,
        headers: a.headers,
        body: a.body,
      });
      if (!res.ok) {
        lastReason = parseErrorReason(res.text) || lastReason;
        continue;
      }
      let json = null;
      try {
        json = JSON.parse(res.text || "{}");
      } catch {
        json = null;
      }
      const channelId = json?.channel?.id ?? json?.direct_message_channel?.id ?? null;
      if (typeof channelId === "number") return { loggedIn: true, channelId };
    } catch {
      // try next
    }
  }

  return { loggedIn: true, channelId: null, reason: lastReason };
}

async function ensureDmWith({ username, userId } = {}) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false, channelId: null, channels: [] };

  const u = String(username || "").trim();
  if (!u) throw new Error("username is required");

  const existing = await listChatChannels();
  const found = (existing.channels || []).find(
    (c) => c.kind === CHAT_KINDS.dm && c.participants?.some((p) => p?.username?.toLowerCase() === u.toLowerCase())
  );
  if (found?.id) return { loggedIn: true, channelId: found.id, channels: existing.channels || [] };

  let targetUserId = typeof userId === "number" ? userId : null;
  try {
    const prof = await getUserByUsername(u);
    targetUserId = prof?.user?.id ?? targetUserId;
  } catch {
    // ignore
  }

  const created = await tryCreateDirectMessageChannel({
    userIds: targetUserId ? [targetUserId] : [],
    usernames: [u],
  });

  const after = await listChatChannels();
  const found2 = (after.channels || []).find(
    (c) => c.kind === CHAT_KINDS.dm && c.participants?.some((p) => p?.username?.toLowerCase() === u.toLowerCase())
  );

  return {
    loggedIn: true,
    channelId: found2?.id ?? created?.channelId ?? null,
    channels: after.channels || [],
    reason: created?.reason ?? null,
  };
}

async function createTopic({ title, raw, categoryId, uploadIds } = {}) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const t = String(title || "").trim();
  const r = String(raw || "").trim();
  if (!t) throw new Error("title is required");
  if (!r && !(Array.isArray(uploadIds) && uploadIds.length)) throw new Error("raw is required");

  const catId = categoryId == null ? null : Number(categoryId);
  if (catId == null || !Number.isFinite(catId)) {
    throw new Error("请选择板块后再发布（未选择板块可能会被发到“未分类”，从而被站点拒绝）");
  }

  const csrf = await getCsrfToken();
  const body = new URLSearchParams();
  body.set("title", t);
  body.set("raw", r || "");
  body.set("category", String(catId));
  body.set("created_at", new Date().toISOString());
  if (Array.isArray(uploadIds)) {
    for (const id of uploadIds) {
      if (id == null) continue;
      body.append("upload_ids[]", String(id));
    }
  }

  const res = await forumRequest("/posts.json", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/new-topic`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-Token": csrf,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    timeoutMs: 60_000,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(res.text || "{}");
      const errors = Array.isArray(j?.errors) ? j.errors.filter(Boolean).join("；") : "";
      const errType = j?.error_type || j?.errorType || "";
      const errMsg = j?.error || j?.message || "";
      detail = errors || errMsg || errType || "";
    } catch {
      detail = "";
    }

    const prefix =
      res.status === 403 ? "发帖被拒绝（可能没有权限或板块不允许发主题）" : "发帖失败";
    const err = new Error(
      detail ? `${prefix}：${detail}（HTTP ${res.status}）` : `${prefix}（HTTP ${res.status}）`
    );
    err.status = res.status;
    err.body = res.text;
    throw err;
  }

  const json = JSON.parse(res.text || "{}");
  const topicId = json?.topic_id ?? json?.topicId ?? null;
  const slug = json?.topic_slug ?? json?.topicSlug ?? null;
  const url =
    topicId && slug ? `${BASE_URL}/t/${slug}/${topicId}` : topicId ? `${BASE_URL}/t/${topicId}` : null;

  return { loggedIn: true, topicId, url, post: json };
}

async function openExternal(url) {
  if (!url) return;
  await shell.openExternal(url);
}

function registerIpc(ipcMain) {
  ipcMain.handle("app:pickImages", async () => pickImages());
  ipcMain.handle("forum:getSession", async () => getSession());
  ipcMain.handle("forum:openLogin", async () => openLogin());
  ipcMain.handle("forum:openProfileSettings", async () => openProfileSettings());
  ipcMain.handle("forum:logout", async () => logout());
  ipcMain.handle("forum:listEmojis", async () => listEmojis());
  ipcMain.handle("forum:listDMs", async () => listPrivateMessages());
  ipcMain.handle("forum:listChatChannels", async () => listChatChannels());
  ipcMain.handle("forum:getChatMessages", async (_ev, channelId, opts) =>
    getChatMessages(channelId, opts)
  );
  ipcMain.handle("forum:markChatChannelRead", async (_ev, payload) => markChatChannelRead(payload));
  ipcMain.handle("forum:sendChatMessage", async (_ev, payload) => sendChatMessage(payload));
  ipcMain.handle("forum:uploadFile", async (_ev, payload) => uploadFile(payload));
  ipcMain.handle("forum:uploadBytes", async (_ev, payload) => uploadBytes(payload));
  ipcMain.handle("forum:getMyProfile", async () => getMyProfile());
  ipcMain.handle("forum:updateMyProfile", async (_ev, payload) => updateMyProfile(payload));
  ipcMain.handle("forum:updateMyAvatar", async (_ev, payload) => updateMyAvatar(payload));
  ipcMain.handle("forum:getTopic", async (_ev, topicId) => getTopic(topicId));
  ipcMain.handle("forum:replyTopic", async (_ev, payload) => replyTopic(payload));
  ipcMain.handle("forum:listLatest", async (_ev, payload) => listLatest(payload));
  ipcMain.handle("forum:listCategoryTopics", async (_ev, payload) => listCategoryTopics(payload));
  ipcMain.handle("forum:listUserCreatedTopics", async (_ev, payload) =>
    listUserCreatedTopics(payload)
  );
  ipcMain.handle("forum:searchUsers", async (_ev, payload) => searchUsers(payload));
  ipcMain.handle("forum:getUser", async (_ev, username) => getUserByUsername(username));
  ipcMain.handle("forum:ensureDmWith", async (_ev, payload) => ensureDmWith(payload));
  ipcMain.handle("forum:createTopic", async (_ev, payload) => createTopic(payload));
  ipcMain.handle("forum:setLikeOnTopic", async (_ev, payload) => setLikeOnTopic(payload));
  ipcMain.handle("forum:listNotifications", async (_ev, opts) => listNotifications(opts));
  ipcMain.handle("forum:markNotificationRead", async (_ev, payload) => markNotificationRead(payload));
  ipcMain.handle("forum:markAllNotificationsRead", async () => markAllNotificationsRead());
  ipcMain.handle("app:openExternal", async (_ev, url) => openExternal(url));
}

module.exports = { registerIpc };
