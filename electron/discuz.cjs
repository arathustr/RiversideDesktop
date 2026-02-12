const crypto = require("node:crypto");

const { app, BrowserWindow, net, session, shell } = require("electron");

const BASE_URL = "https://bbs.uestc.edu.cn";
const PARTITION = "persist:riverside_discuz";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let legacySession = null;
async function getLegacySession() {
  if (legacySession) return legacySession;
  if (!app.isReady()) await app.whenReady();
  legacySession = session.fromPartition(PARTITION);
  return legacySession;
}

let loginWindow = null;
let loginMonitorTimer = null;
let loginMonitorStopAt = 0;

const absoluteUrl = (urlOrPath) => {
  if (!urlOrPath) return null;
  const s = String(urlOrPath);
  if (/^https?:\/\//i.test(s)) {
    // Some Discuz templates still output http URLs; prefer https for this site to avoid mixed-content/CSP issues.
    try {
      const u = new URL(s);
      const base = new URL(BASE_URL);
      if (u.protocol === "http:" && u.hostname === base.hostname) {
        u.protocol = "https:";
        return u.toString();
      }
    } catch {
      // ignore
    }
    return s;
  }
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${BASE_URL}${s}`;
  return `${BASE_URL}/${s}`;
};

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const decodeHtmlEntities = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : _m;
    })
    .replace(/&#(\d+);/g, (_m, num) => {
      const n = Number.parseInt(num, 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : _m;
    });
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

const attrFromTag = (tag, name) => {
  if (!tag) return null;
  const re = new RegExp(`${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = String(tag).match(re);
  const raw = m ? m[1] || m[2] || m[3] || "" : "";
  return raw ? decodeHtmlEntities(raw) : null;
};

const parseDiscuzTimeToIso = (value) => {
  const raw = decodeHtmlEntities(String(value || "")).replace(/\u00a0/g, " ").trim();
  const s = raw.replace(/\s+/g, " ");

  const cstIso = (year, month, day, hour = 0, minute = 0, second = 0) => {
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    const utc = Date.UTC(year, month - 1, day, hour - 8, minute, second);
    return new Date(utc).toISOString();
  };

  // Absolute timestamps.
  let m =
    s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/) ||
    s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) {
    return cstIso(
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
  }

  const now = new Date();

  // Relative timestamps (Chinese + English fallbacks).
  if (/(?:\u521a\u521a|\u521a\u624d|just\s*now)/i.test(s)) return now.toISOString();

  m = s.match(/(\d+)\s*(?:\u79d2|secs?)\s*(?:\u524d|ago)?/i);
  if (m) return new Date(Date.now() - Number(m[1]) * 1000).toISOString();

  m = s.match(/(\d+)\s*(?:\u5206\u949f|min(?:ute)?s?)\s*(?:\u524d|ago)?/i);
  if (m) return new Date(Date.now() - Number(m[1]) * 60_000).toISOString();

  m = s.match(/(\d+)\s*(?:\u5c0f\u65f6|hours?)\s*(?:\u524d|ago)?/i);
  if (m) return new Date(Date.now() - Number(m[1]) * 3_600_000).toISOString();

  m = s.match(/(\d+)\s*(?:\u5929|days?)\s*(?:\u524d|ago)?/i);
  if (m) return new Date(Date.now() - Number(m[1]) * 86_400_000).toISOString();

  // "昨天 12:34" / "前天 12:34" / "02-11 12:34" / "12:34"
  const cstNow = new Date(Date.now() + 8 * 3_600_000);

  m = s.match(/(?:\u6628\u5929)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const d = new Date(cstNow.getTime() - 86_400_000);
    return cstIso(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      Number(m[1]),
      Number(m[2]),
      Number(m[3] || 0)
    );
  }

  m = s.match(/(?:\u524d\u5929)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const d = new Date(cstNow.getTime() - 2 * 86_400_000);
    return cstIso(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      Number(m[1]),
      Number(m[2]),
      Number(m[3] || 0)
    );
  }

  m = s.match(/(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return cstIso(
      cstNow.getUTCFullYear(),
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
      Number(m[5] || 0)
    );
  }

  m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    return cstIso(
      cstNow.getUTCFullYear(),
      cstNow.getUTCMonth() + 1,
      cstNow.getUTCDate(),
      Number(m[1]),
      Number(m[2]),
      Number(m[3] || 0)
    );
  }

  return null;
};

const looksLikeLegacyLoggedOut = (html) => {
  const raw = String(html || "");
  if (!raw) return false;
  if (/\bdiscuz_uid\s*=\s*['"]?0['"]?/i.test(raw)) return true;
  if (/member\.php\?mod=logging&action=login/i.test(raw) && /loginform_/i.test(raw)) return true;
  if (/<form\b[^>]*id=["']loginform_/i.test(raw)) return true;
  return false;
};

async function legacyRequest(urlOrPath, init = {}) {
  const url = absoluteUrl(urlOrPath);
  const headers = /** @type {Record<string, string>} */ ({
    "User-Agent": UA,
    Accept: init.accept || (init.headers && init.headers.Accept) || "*/*",
    ...(init.headers || {}),
  });

  const method = String(init.method || "GET").toUpperCase();
  let body = init.body ?? null;
  if (body instanceof URLSearchParams) body = body.toString();

  const ses = await getLegacySession();
  const timeoutMs = Number.isFinite(init.timeoutMs) ? Number(init.timeoutMs) : 25_000;
  const redirect = init.redirect || "follow";

  return new Promise((resolve, reject) => {
    let done = false;
    const req = net.request({
      method,
      url,
      headers,
      session: ses,
      credentials: "include",
      redirect,
    });

    const timer = setTimeout(() => {
      try {
        req.abort();
      } catch {
        // ignore
      }
      if (done) return;
      done = true;
      reject(new Error(`Legacy request timeout after ${timeoutMs}ms: ${url}`));
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

async function fetchHtml(urlOrPath, init = {}) {
  const res = await legacyRequest(urlOrPath, init);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${absoluteUrl(urlOrPath)}`);
    err.status = res.status;
    err.body = res.text;
    throw err;
  }
  return res.text || "";
}

const extractFormHtml = (html, formId) => {
  if (!formId) return html;
  const re = new RegExp(
    `<form\\b[^>]*id=["']${escapeRegExp(formId)}["'][^>]*>[\\s\\S]*?<\\/form>`,
    "i"
  );
  const m = String(html || "").match(re);
  return m ? m[0] : html;
};

const parseHiddenInputs = (formHtml) => {
  const html = String(formHtml || "");
  const out = /** @type {Record<string, string>} */ ({});
  const tags = html.match(/<input\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const type = (attrFromTag(tag, "type") || "").toLowerCase();
    if (type && type !== "hidden") continue;
    const name = attrFromTag(tag, "name");
    if (!name) continue;
    const value = attrFromTag(tag, "value") || "";
    out[name] = value;
  }
  return out;
};

const parseSelectOptions = (formHtml, selectName) => {
  const html = String(formHtml || "");
  const re = new RegExp(
    `<select\\b[^>]*name=["']${escapeRegExp(selectName)}["'][^>]*>([\\s\\S]*?)<\\/select>`,
    "i"
  );
  const m = html.match(re);
  if (!m) return [];
  const inner = m[1] || "";
  const opts = [];
  for (const om of inner.matchAll(/<option\b[^>]*value=["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/option>/gi)) {
    const value = decodeHtmlEntities(om[1] || "").trim();
    const label = stripHtmlToText(decodeHtmlEntities(om[2] || "")).trim();
    if (!value) continue;
    opts.push({ value, label });
  }
  return opts;
};

const parseFormAction = (formHtml) => {
  const m = String(formHtml || "").match(/<form\b[^>]*>/i);
  const tag = m ? m[0] : null;
  const action = attrFromTag(tag, "action");
  return action ? decodeHtmlEntities(action) : null;
};

const legacyAvatarUrl = (uid, size = "small") => {
  const n = Number(uid);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${BASE_URL}/uc_server/avatar.php?uid=${Math.abs(n)}&size=${encodeURIComponent(size)}`;
};

const extractImageSrc = (html) => {
  if (!html) return null;
  const tag = String(html).match(/<img\b[^>]*>/i)?.[0] || null;
  const src = attrFromTag(tag, "src");
  return src ? absoluteUrl(src) : null;
};

const stableNumberFromText = (text) => {
  const s = String(text || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
};

const extractThreadTitle = (rowHtml, tid) => {
  const row = String(rowHtml || "");
  const tidStr = tid != null ? String(Math.abs(Number(tid))) : "";

  const xstTag = row.match(/<a\b[^>]*class="[^"]*\bxst\b[^"]*"[^>]*>/i)?.[0] || null;
  const strong =
    row.match(/<a[^>]*class="[^"]*\bxst\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
    row.match(/<a[^>]*class="[^"]*\bs\b[^"]*\bxst\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
    "";
  const strongTitle = stripHtmlToText(decodeHtmlEntities(strong)).trim();
  if (strongTitle && !/^\d+$/.test(strongTitle)) return strongTitle;

  // Some templates truncate the visible title but keep the full subject in `title=""`.
  const attrTitleRaw = attrFromTag(xstTag, "title");
  const attrTitle = stripHtmlToText(decodeHtmlEntities(attrTitleRaw || "")).trim();
  if (attrTitle && !/^\d+$/.test(attrTitle)) return attrTitle;

  for (const mm of row.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeHtmlEntities(mm[1] || "");
    if (!/(?:viewthread|thread-)/i.test(href)) continue;
    if (tidStr) {
      const hasTid = new RegExp(`(?:^|[?&])tid=${escapeRegExp(tidStr)}(?:&|$)`, "i").test(href);
      const hasRewrite = new RegExp(`thread-${escapeRegExp(tidStr)}-`, "i").test(href);
      if (!hasTid && !hasRewrite) continue;
    }
    const text = stripHtmlToText(decodeHtmlEntities(mm[2] || "")).trim();
    if (text && !/^\d+$/.test(text)) return text;

    const tag = String(mm[0] || "").match(/<a\b[^>]*>/i)?.[0] || null;
    const t2Raw = attrFromTag(tag, "title");
    const t2 = stripHtmlToText(decodeHtmlEntities(t2Raw || "")).trim();
    if (t2 && !/^\d+$/.test(t2)) return t2;
  }

  return "";
};

function parseCurrentUserFromAnyPage(html) {
  const raw = String(html || "");
  const uidRaw =
    raw.match(/discuz_uid\s*=\s*'(\d+)'/i)?.[1] ||
    raw.match(/\b(?:member_uid|uid)\s*[:=]\s*['"]?(\d+)/i)?.[1] ||
    raw.match(/home\.php\?mod=space(?:&amp;|&)uid=(\d+)[^>]*class="vwmy"/i)?.[1] ||
    raw.match(/home\.php\?mod=space(?:&amp;|&)uid=(\d+)/i)?.[1] ||
    "0";
  const uid = Number(uidRaw);
  if (!Number.isFinite(uid) || uid <= 0) return null;

  const usernameRaw =
    raw.match(/discuz_uname\s*=\s*'([^']+)'/i)?.[1] ||
    raw.match(/class="vwmy"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i)?.[1] ||
    raw.match(/title="(?:访问|璁块棶)[^"]*"[^>]*>\s*([^<]{1,80})\s*<\/a>/i)?.[1] ||
    raw.match(/class="xw1"[^>]*>\s*([^<]{1,80})\s*<\/a>/i)?.[1] ||
    "";
  const username = decodeHtmlEntities(usernameRaw).trim() || String(uid);

  const avatarRaw =
    raw.match(/class="avt[^"]*">[\s\S]*?<img[^>]*src="([^"]+)"/i)?.[1] ||
    raw.match(/<img[^>]*src="([^"]*(?:avatar\.php\?uid=\d+[^"]*|_avatar_(?:small|middle|big)\.jpg[^"]*))"/i)?.[1] ||
    null;
  const avatarUrl = avatarRaw ? absoluteUrl(decodeHtmlEntities(avatarRaw)) : legacyAvatarUrl(uid, "middle");

  return { id: uid, username, name: username, avatarUrl };
}

function parseSpaceUserFromAnyPage(html, seed) {
  const seedUid = seed?.uid != null ? Number(seed.uid) : null;
  const raw = String(html || "");

  // Common Discuz "message" pages (not a real profile).
  if (/<title>\s*(?:\u63d0\u793a\u4fe1\u606f|message)\b/i.test(raw) && /id="messagetext"/i.test(raw)) return null;

  // Discuz space pages often include a dedicated `space_uid` JS variable; use it when possible.
  const uidFromVarRaw =
    raw.match(/\bspace_uid\s*=\s*['"](\d+)['"]/i)?.[1] ||
    raw.match(/\bspaceuid\s*=\s*['"](\d+)['"]/i)?.[1] ||
    null;
  const uidFromVar = uidFromVarRaw ? Number(uidFromVarRaw) : null;

  // If the caller requested a specific uid, ensure the page matches it (otherwise we might be looking at a redirect or a login prompt).
  if (
    seedUid != null &&
    Number.isFinite(seedUid) &&
    seedUid > 0 &&
    uidFromVar != null &&
    Number.isFinite(uidFromVar) &&
    uidFromVar > 0 &&
    uidFromVar !== seedUid
  ) {
    return null;
  }

  // As a fallback, try to parse from avatar URLs on the space page (usually the profile owner's avatar).
  const uidFromAvatarRaw =
    raw.match(/(?:uc_server\/)?avatar\.php\?uid=(\d+)/i)?.[1] ||
    raw.match(/avatar\.php\?uid=(\d+)/i)?.[1] ||
    null;
  const uidFromAvatar = uidFromAvatarRaw ? Number(uidFromAvatarRaw) : null;

  const uidFromLinkRaw =
    raw.match(/home\.php\?mod=space(?:&amp;|&)uid=(\d+)[^>]*class="[^"]*\b(?:xw1|mt)\b/i)?.[1] ||
    raw.match(/home\.php\?mod=space(?:&amp;|&)uid=(\d+)[^>]*class="vwmy"/i)?.[1] ||
    raw.match(/home\.php\?mod=space(?:&amp;|&)uid=(\d+)/i)?.[1] ||
    null;
  const uidFromLink = uidFromLinkRaw ? Number(uidFromLinkRaw) : null;

  const uid =
    seedUid != null && Number.isFinite(seedUid) && seedUid > 0
      ? seedUid
      : uidFromVar != null && Number.isFinite(uidFromVar) && uidFromVar > 0
        ? uidFromVar
        : uidFromAvatar != null && Number.isFinite(uidFromAvatar) && uidFromAvatar > 0
          ? uidFromAvatar
          : uidFromLink != null && Number.isFinite(uidFromLink) && uidFromLink > 0
            ? uidFromLink
            : null;
  if (!uid) return null;

  const titleNameRaw =
    raw.match(/<title>\s*([^<]{1,80}?)\s*-\s*[\s\S]*?Powered by Discuz!/i)?.[1] ||
    raw.match(/<title>\s*([^<]{1,80}?)\s*-\s*[\s\S]*?<\/title>/i)?.[1] ||
    "";

  const usernameRaw =
    raw.match(/<h2 class="mt">\s*([^<]{1,80})/i)?.[1] ||
    raw.match(/class="hm"\s*>\s*<h2>\s*([^<]{1,80})/i)?.[1] ||
    raw.match(/home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*>([^<]{1,80})<\/a>/i)?.[1] ||
    titleNameRaw ||
    String(uid);

  const username = decodeHtmlEntities(usernameRaw).trim() || String(uid);
  const avatarUrl = legacyAvatarUrl(uid, "middle");

  return { id: uid, username, name: username, avatarUrl };
}

async function getSession() {
  try {
    let html = "";
    try {
      html = await fetchHtml("/forum.php", { headers: { Accept: "text/html" } });
    } catch {
      html = await fetchHtml("/home.php", { headers: { Accept: "text/html" } });
    }

    let u = parseCurrentUserFromAnyPage(html);
    if (!u) {
      try {
        const html2 = await fetchHtml("/home.php", { headers: { Accept: "text/html" } });
        u = parseCurrentUserFromAnyPage(html2);
      } catch {
        // ignore
      }
    }

    if (!u) {
      // If the server page clearly indicates "guest", do not trust cookies to claim "logged in".
      if (looksLikeLegacyLoggedOut(html)) return { loggedIn: false, currentUser: null };

      const ses = await getLegacySession();
      const cookies = await ses.cookies.get({ url: BASE_URL });
      const uidCookie = cookies.find(
        (c) => /_uid$/i.test(String(c.name || "")) && /^\d+$/.test(String(c.value || ""))
      );
      const authCookie = cookies.find((c) => /_auth$/i.test(String(c.name || "")));
      if (uidCookie && authCookie) {
        const uid = Number(uidCookie.value);
        if (Number.isFinite(uid) && uid > 0) {
          const usernameCookie = cookies.find(
            (c) => /_(?:uname|username)$/i.test(String(c.name || "")) && String(c.value || "").length > 0
          );
          let username = usernameCookie?.value ? String(usernameCookie.value) : String(uid);
          try {
            username = decodeURIComponent(username);
          } catch {
            // ignore
          }
          u = {
            id: uid,
            username,
            name: username,
            avatarUrl: legacyAvatarUrl(uid, "middle"),
          };
        }
      }
    }

    if (!u) return { loggedIn: false, currentUser: null };
    // Discuz may issue session cookies unless "auto login" is checked. Try to persist auth cookies so
    // the desktop client stays logged in across app restarts.
    try {
      await persistLegacyAuthCookies();
    } catch {
      // ignore (best-effort)
    }
    return { loggedIn: true, currentUser: u };
  } catch (e) {
    return { loggedIn: false, currentUser: null, error: String(e?.message || e) };
  }
}

let legacyAuthCookiePersistedAt = 0;
async function persistLegacyAuthCookies(opts = {}) {
  const now = Date.now();
  const throttleMs = 2 * 60 * 1000;
  const force = !!opts.force;
  if (!force && legacyAuthCookiePersistedAt && now - legacyAuthCookiePersistedAt < throttleMs) return;
  legacyAuthCookiePersistedAt = now;

  const days = Number.isFinite(opts.days) ? Math.max(1, Math.min(90, Number(opts.days))) : 30;
  const expires = Math.floor(now / 1000 + days * 86400);

  const ses = await getLegacySession();
  const cookies = await ses.cookies.get({ url: BASE_URL });
  const sessionCookies = cookies.filter((c) => {
    if (!c) return false;
    if (!String(c.name || "").trim()) return false;
    if (!String(c.value || "")) return false;
    return !!c.session || !c.expirationDate;
  });

  // Prefer persisting the cookies that are most likely to keep Discuz logged in, but fall back to
  // persisting all session cookies for this domain (some setups rely on additional cookies).
  const important = sessionCookies.filter((c) =>
    /_(?:auth|uid|saltkey)$/i.test(String(c.name || "")) || /^(?:cf_clearance|__cf_bm)$/i.test(String(c.name || ""))
  );
  const targets = important.length > 0 ? important : sessionCookies;

  const normalizeSameSite = (value) => {
    const v = String(value || "").trim();
    if (!v) return null;
    if (v === "lax" || v === "strict" || v === "no_restriction") return v;
    // Avoid passing unexpected values to Electron; omit when unknown.
    return null;
  };

  for (const c of targets) {
    if (!c) continue;
    const name = String(c.name || "").trim();
    const value = String(c.value || "");
    if (!name || !value) continue;

    const base = {
      url: BASE_URL,
      name,
      value,
      expirationDate: expires,
    };

    const attempt1 = {
      ...base,
      domain: c.domain || undefined,
      path: c.path || undefined,
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: normalizeSameSite(c.sameSite) || undefined,
    };

    const attempt2 = {
      ...base,
      path: c.path || "/",
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
    };

    const attempt3 = { ...base, secure: !!c.secure };

    const attempts = [attempt1, attempt2, attempt3, base];
    for (const details of attempts) {
      try {
        await ses.cookies.set(details);
        break;
      } catch {
        // try next shape
      }
    }
  }
}

function stopLoginMonitor() {
  if (loginMonitorTimer) {
    try {
      clearInterval(loginMonitorTimer);
    } catch {
      // ignore
    }
  }
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
        try {
          await persistLegacyAuthCookies({ force: true });
        } catch {
          // ignore
        }
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
    title: "登录 清水河畔（旧版）",
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

  loginWindow.loadURL(`${BASE_URL}/member.php?mod=logging&action=login`).catch(() => {});
  loginWindow.webContents.on("did-finish-load", () => {
    try {
      // Help ensure cookie persistence by checking Discuz's "auto login" option by default.
      loginWindow?.webContents
        ?.executeJavaScript(
          `(() => {
            try {
              const cb = document.querySelector('input[name="cookietime"]');
              if (cb && cb instanceof HTMLInputElement && !cb.checked) cb.checked = true;
            } catch {}
          })();`,
          true
        )
        .catch(() => {});
    } catch {
      // ignore
    }
  });
  startLoginMonitor();
}

async function logout() {
  const ses = await getLegacySession();
  await ses.clearStorageData({
    storages: ["cookies", "localstorage", "sessionstorage", "indexdb", "serviceworkers", "cachestorage"],
  });
}

function stableColorHexFromInt(n) {
  const h = crypto.createHash("md5").update(String(n)).digest("hex");
  return h.slice(0, 6);
}

async function listForumTree() {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const html = await fetchHtml("/forum.php", { headers: { Accept: "text/html" } });

  /** @type {{ gid:number; name:string; forums: { fid:number; name:string; url:string }[] }[]} */
  const groups = [];

  const starts = [];
  for (const m of html.matchAll(/<div id="category_(\d+)"\s+class="bm_c"/gi)) {
    const gid = Number(m[1]);
    if (!Number.isFinite(gid) || gid <= 0) continue;
    starts.push({ gid, index: m.index ?? 0 });
  }

  for (let i = 0; i < starts.length; i++) {
    const { gid, index } = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const block = html.slice(index, end);

    const head = html.slice(Math.max(0, index - 2500), index);
    const nameRaw = Array.from(head.matchAll(/<h2>\s*<a[^>]*gid=(\d+)[^>]*>([^<]+)<\/a>\s*<\/h2>/gi))
      .filter((x) => Number(x[1]) === gid)
      .map((x) => x[2])[0];
    const name = decodeHtmlEntities(nameRaw || `G${gid}`).trim();

    const forums = [];
    const seenFids = new Set();
    const addForum = (fid, name, parentFid = null) => {
      const n = Number(fid);
      if (!Number.isFinite(n) || n <= 0) return;
      if (seenFids.has(n)) return;
      seenFids.add(n);
      const fname = decodeHtmlEntities(name || "").trim() || `F${n}`;
      const url = `${BASE_URL}/forum.php?mod=forumdisplay&fid=${n}`;
      forums.push({ fid: n, name: fname, url, parentFid });
    };

    // Prefer parsing full forum blocks so we can include subforums (e.g. 密语区).
    const dlBlocks = Array.from(block.matchAll(/<dl\b[^>]*id="forum_(\d+)"[^>]*>([\s\S]*?)<\/dl>/gi));
    if (dlBlocks.length > 0) {
      for (const dm of dlBlocks) {
        const fid = Number(dm[1]);
        const dl = dm[2] || "";
        const mainNameRaw =
          dl.match(/<dt>[\s\S]*?<a[^>]*forumdisplay&fid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
          dl.match(/<a[^>]*forumdisplay&fid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
          "";
        addForum(fid, mainNameRaw, null);

        for (const sm of dl.matchAll(/<a[^>]*forumdisplay&fid=(\d+)[^>]*>([^<]+)<\/a>/gi)) {
          const sfid = Number(sm[1]);
          if (!Number.isFinite(sfid) || sfid <= 0) continue;
          if (sfid === fid) continue;
          addForum(sfid, sm[2] || "", fid);
        }
      }
    } else {
      for (const fm of block.matchAll(/<dt>\s*<a[^>]*forumdisplay&fid=(\d+)[^>]*>([^<]+)<\/a>/gi)) {
        addForum(fm[1], fm[2] || "", null);
      }
    }

    groups.push({ gid, name, forums });
  }

  return { loggedIn: true, groups };
}

async function listForumThreads(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const fid = Number(payload?.fid);
  if (!Number.isFinite(fid) || fid <= 0) throw new Error("fid is required");

  const page = Number(payload?.page || 1);
  const html = await fetchHtml(
    `/forum.php?mod=forumdisplay&fid=${encodeURIComponent(String(fid))}&page=${encodeURIComponent(String(page))}`,
    { headers: { Accept: "text/html" } }
  );

  const forumNameRaw =
    html.match(/<div id="pt"[\s\S]*?<a[^>]*forumdisplay&fid=\d+[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/div>/i)?.[1] ||
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    "";
  const forumName = stripHtmlToText(decodeHtmlEntities(forumNameRaw)).trim() || `FID ${fid}`;

  /** @type {any[]} */
  const threads = [];

  for (const tm of html.matchAll(/<tbody\b[^>]*id="normalthread_(\d+)"[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    const tid = Number(tm[1]);
    if (!Number.isFinite(tid) || tid <= 0) continue;
    const row = tm[2] || "";

    const title = extractThreadTitle(row, tid) || `TID ${tid}`;

    const authorUidRaw =
      row.match(/(?:home\.php\?mod=space(?:&amp;|&)uid=|space-uid-)(\d+)/i)?.[1] ||
      row.match(/\buid=(\d+)/i)?.[1] ||
      null;
    const authorUid = authorUidRaw ? Number(authorUidRaw) : null;
    const authorNameRaw =
      row.match(/home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      row.match(/space-uid-\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      "";
    const authorName = decodeHtmlEntities(authorNameRaw).trim() || (authorUid ? String(authorUid) : "");

    const repliesRaw = row.match(/<td class="num"[^>]*>[\s\S]*?<a[^>]*>(\d+)<\/a>/i)?.[1] || "0";
    const viewsRaw = row.match(/<td class="num"[^>]*>[\s\S]*?<em>(\d+)<\/em>/i)?.[1] || "0";
    const replies = Number(repliesRaw) || 0;
    const views = Number(viewsRaw) || 0;

    const lastAtRaw = row.match(/<span[^>]*title="([^"]+)"/i)?.[1] || null;
    const lastPostedAt =
      (lastAtRaw ? parseDiscuzTimeToIso(decodeHtmlEntities(lastAtRaw)) : null) || new Date().toISOString();

    const author =
      authorUid && authorName
        ? {
            id: authorUid,
            username: authorName,
            name: authorName,
            avatarUrl: legacyAvatarUrl(authorUid, "small"),
          }
        : null;

    threads.push({
      id: -tid,
      title,
      slug: String(tid),
      excerpt: "",
      likeCount: 0,
      liked: false,
      replyCount: replies,
      views,
      lastPostedAt,
      createdAt: lastPostedAt,
      category: { id: -fid, name: forumName, color: stableColorHexFromInt(fid), textColor: "ffffff" },
      author,
      url: `${BASE_URL}/forum.php?mod=viewthread&tid=${tid}`,
      legacy: { source: "discuz", tid, fid },
    });
  }

  return { loggedIn: true, forum: { fid, name: forumName }, threads };
}

async function listLatest(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const viewRaw = String(payload?.view || "newthread").trim().toLowerCase();
  const view = ["newthread", "hot", "digest", "new", "so"].includes(viewRaw) ? viewRaw : "newthread";
  const page = Math.max(1, Math.min(50, Number(payload?.page || 1)));

  const html = await fetchHtml(
    `/forum.php?mod=guide&view=${encodeURIComponent(view)}&page=${encodeURIComponent(String(page))}`,
    { headers: { Accept: "text/html" } }
  );

  /** @type {any[]} */
  const threads = [];

  for (const tm of html.matchAll(/<tbody\b[^>]*id="normalthread_(\d+)"[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    const tid = Number(tm[1]);
    if (!Number.isFinite(tid) || tid <= 0) continue;
    const row = tm[2] || "";

    const title = extractThreadTitle(row, tid) || `TID ${tid}`;

    const fidRaw = row.match(/forumdisplay&fid=(\d+)/i)?.[1] || null;
    const fid = fidRaw ? Number(fidRaw) : null;

    const forumNameRaw = row.match(/forumdisplay&fid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] || "";
    const forumName = decodeHtmlEntities(forumNameRaw).trim() || (fid ? `FID ${fid}` : "旧版");

    const authorUidRaw =
      row.match(/(?:home\.php\?mod=space(?:&amp;|&)uid=|space-uid-)(\d+)/i)?.[1] ||
      row.match(/\buid=(\d+)/i)?.[1] ||
      null;
    const authorUid = authorUidRaw ? Number(authorUidRaw) : null;
    const authorNameRaw =
      row.match(/home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      row.match(/space-uid-\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      "";
    const authorName = decodeHtmlEntities(authorNameRaw).trim() || (authorUid ? String(authorUid) : "");

    const repliesRaw = row.match(/<td class="num"[^>]*>[\s\S]*?<a[^>]*>(\d+)<\/a>/i)?.[1] || "0";
    const viewsRaw = row.match(/<td class="num"[^>]*>[\s\S]*?<em>(\d+)<\/em>/i)?.[1] || "0";
    const replies = Number(repliesRaw) || 0;
    const views = Number(viewsRaw) || 0;

    const lastAtRaw = row.match(/<span[^>]*title="([^"]+)"/i)?.[1] || null;
    const lastPostedAt =
      (lastAtRaw ? parseDiscuzTimeToIso(decodeHtmlEntities(lastAtRaw)) : null) || new Date().toISOString();

    const author =
      authorUid && authorName
        ? {
            id: authorUid,
            username: authorName,
            name: authorName,
            avatarUrl: legacyAvatarUrl(authorUid, "small"),
          }
        : null;

    threads.push({
      id: -tid,
      title,
      slug: String(tid),
      excerpt: "",
      likeCount: 0,
      liked: false,
      replyCount: replies,
      views,
      lastPostedAt,
      createdAt: lastPostedAt,
      category: fid
        ? { id: -fid, name: forumName, color: stableColorHexFromInt(fid), textColor: "ffffff" }
        : { id: -1, name: forumName, color: "64748b", textColor: "ffffff" },
      author,
      url: `${BASE_URL}/forum.php?mod=viewthread&tid=${tid}`,
      legacy: { source: "discuz", tid, fid: fid || null, view, page },
    });
  }

  threads.sort(
    (a, b) => (Date.parse(b.lastPostedAt || "") || 0) - (Date.parse(a.lastPostedAt || "") || 0)
  );

  return { loggedIn: true, view, page, threads };
}

async function getThread(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const tid = Number(payload?.tid);
  if (!Number.isFinite(tid) || tid <= 0) throw new Error("tid is required");
  const page = Number(payload?.page || 1);

  const html = await fetchHtml(
    `/forum.php?mod=viewthread&tid=${encodeURIComponent(String(tid))}&page=${encodeURIComponent(String(page))}`,
    { headers: { Accept: "text/html" } }
  );

  const titleRaw =
    html.match(/<span[^>]*id="thread_subject"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
    html.match(/<h1[^>]*class="ts"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    "";
  const title = stripHtmlToText(decodeHtmlEntities(titleRaw)).trim() || `TID ${tid}`;

  const fidRaw =
    html.match(/action=reply(?:&amp;|&)fid=(\d+)(?:&amp;|&)tid=/i)?.[1] ||
    html.match(/forumdisplay&fid=(\d+)/i)?.[1] ||
    null;
  const fid = fidRaw ? Number(fidRaw) : null;

  /** @type {any[]} */
  const posts = [];
  const postMatches = Array.from(html.matchAll(/<div\b[^>]*id="post_(\d+)"[^>]*>/gi));
  for (let i = 0; i < postMatches.length; i++) {
    const pid = Number(postMatches[i][1]);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const start = postMatches[i].index ?? 0;
    const end = i + 1 < postMatches.length ? postMatches[i + 1].index ?? html.length : html.length;
    const block = html.slice(start, end);

    const headerBlock =
      block.match(/<div class="authi">[\s\S]*?<\/div>/i)?.[0] ||
      block.match(/<div class="pi">[\s\S]*?<\/div>/i)?.[0] ||
      "";

    const authorUidRaw =
      headerBlock.match(/(?:home\.php\?mod=space(?:&amp;|&)uid=|space-uid-)(\d+)/i)?.[1] ||
      block.match(/(?:home\.php\?mod=space(?:&amp;|&)uid=|space-uid-)(\d+)[^>]*class="xw1"/i)?.[1] ||
      null;
    const authorUid = authorUidRaw ? Number(authorUidRaw) : null;
    const authorNameRaw =
      headerBlock.match(/home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*class="xw1"[^>]*>([^<]+)<\/a>/i)?.[1] ||
      headerBlock.match(/space-uid-\d+[^>]*class="xw1"[^>]*>([^<]+)<\/a>/i)?.[1] ||
      headerBlock.match(/<a[^>]*class="xw1"[^>]*>([^<]+)<\/a>/i)?.[1] ||
      block.match(/<div class="authi">[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)?.[1] ||
      "";
    const authorName = decodeHtmlEntities(authorNameRaw).trim() || (authorUid ? String(authorUid) : "");

    const avatarRaw =
      block.match(/<div class="avatar"[\s\S]*?<img[^>]*src="([^"]+)"/i)?.[1] ||
      block.match(/<img[^>]*src="([^"]*(?:avatar\.php\?uid=\d+[^"]*|_avatar_(?:small|middle|big)\.jpg[^"]*))"/i)?.[1] ||
      null;
    const avatarUrl = avatarRaw
      ? absoluteUrl(decodeHtmlEntities(avatarRaw))
      : authorUid
        ? legacyAvatarUrl(authorUid, "middle")
        : null;

    const createdRaw =
      block.match(/id="authorposton\d+"[^>]*>[\s\S]*?<span[^>]*title="([^"]+)"/i)?.[1] ||
      block.match(/<span[^>]*title="(\d{4}-\d{1,2}-\d{1,2}[^"]*)"/i)?.[1] ||
      null;
    const createdAt =
      (createdRaw ? parseDiscuzTimeToIso(decodeHtmlEntities(createdRaw)) : null) || new Date().toISOString();

    const msgMatch = block.match(new RegExp(`<td\\b[^>]*id="postmessage_${pid}"[^>]*>([\\s\\S]*?)<\\/td>`, "i"));
    const cooked = msgMatch ? (msgMatch[1] || "").trim() : "";

    posts.push({
      id: pid,
      from: sess.currentUser?.id && authorUid && sess.currentUser.id === authorUid ? "me" : "them",
      userId: authorUid,
      username: authorName || "unknown",
      avatarUrl,
      cooked,
      createdAt,
      postNumber: i + 1,
      legacy: { source: "discuz", pid, tid, fid },
    });
  }

  return { loggedIn: true, thread: { tid, fid, title, page }, posts };
}

async function resolveFindpost(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const ptid = Number(payload?.ptid);
  const pid = Number(payload?.pid);
  if (!Number.isFinite(ptid) || ptid <= 0) throw new Error("ptid is required");
  if (!Number.isFinite(pid) || pid <= 0) throw new Error("pid is required");

  const res = await legacyRequest(
    `/forum.php?mod=redirect&goto=findpost&ptid=${encodeURIComponent(String(ptid))}&pid=${encodeURIComponent(String(pid))}`,
    { method: "GET", headers: { Accept: "text/html" }, redirect: "manual" }
  );

  const loc = res?.headers?.location || res?.headers?.Location || null;
  const location = Array.isArray(loc) ? loc[0] : loc;
  const url = location ? absoluteUrl(String(location)) : `${BASE_URL}/forum.php?mod=viewthread&tid=${ptid}`;

  const mPage = String(url).match(/[?&]page=(\d+)/i);
  const page = mPage ? Number(mPage[1]) : 1;
  return { loggedIn: true, tid: ptid, pid, page, url };
}

async function getNewThreadForm(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const fid = Number(payload?.fid);
  if (!Number.isFinite(fid) || fid <= 0) throw new Error("fid is required");

  const html = await fetchHtml(`/forum.php?mod=post&action=newthread&fid=${encodeURIComponent(String(fid))}`, {
    headers: { Accept: "text/html" },
  });

  const form = extractFormHtml(html, "postform");
  const action = parseFormAction(form);
  const hidden = parseHiddenInputs(form);
  const typeOptions = parseSelectOptions(form, "typeid");

  return { loggedIn: true, fid, action, hidden, typeOptions };
}

async function createThread(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const fid = Number(payload?.fid);
  if (!Number.isFinite(fid) || fid <= 0) throw new Error("fid is required");

  const subject = String(payload?.subject || "").trim();
  const message = String(payload?.message || "").trim();
  const typeid = payload?.typeid != null ? String(payload.typeid).trim() : "";
  if (!subject) throw new Error("subject is required");
  if (!message) throw new Error("message is required");

  const formRes = await getNewThreadForm({ fid });
  if (!formRes?.loggedIn) return { loggedIn: false };
  const action = formRes.action || `/forum.php?mod=post&action=newthread&fid=${fid}&topicsubmit=yes`;
  const hidden = formRes.hidden || {};

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) params.set(k, String(v ?? ""));
  params.set("subject", subject);
  params.set("message", message);
  if (typeid && typeid !== "0") params.set("typeid", typeid);
  params.set("topicsubmit", "true");

  const res = await legacyRequest(action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/forum.php?mod=post&action=newthread&fid=${fid}`,
    },
    body: params,
    timeoutMs: 40_000,
  });

  if (!res.ok) {
    const err = new Error(`Create thread failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = res.text;
    throw err;
  }

  const html = res.text || "";
  const tidRaw = html.match(/viewthread&tid=(\d+)/i)?.[1] || html.match(/tid=(\d+)/i)?.[1] || null;
  const tid = tidRaw ? Number(tidRaw) : null;
  const url = tid ? `${BASE_URL}/forum.php?mod=viewthread&tid=${tid}` : null;
  return { loggedIn: true, tid, url };
}

async function getReplyForm(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const tid = Number(payload?.tid);
  const fid = Number(payload?.fid);
  const repquote = payload?.repquotePid != null ? Number(payload.repquotePid) : null;
  if (!Number.isFinite(tid) || tid <= 0) throw new Error("tid is required");
  if (!Number.isFinite(fid) || fid <= 0) throw new Error("fid is required");

  const url = repquote
    ? `/forum.php?mod=post&action=reply&fid=${encodeURIComponent(String(fid))}&tid=${encodeURIComponent(String(tid))}&repquote=${encodeURIComponent(String(repquote))}`
    : `/forum.php?mod=post&action=reply&fid=${encodeURIComponent(String(fid))}&tid=${encodeURIComponent(String(tid))}`;

  const html = await fetchHtml(url, { headers: { Accept: "text/html" } });
  const form = extractFormHtml(html, "postform");
  const action = parseFormAction(form);
  const hidden = parseHiddenInputs(form);
  return { loggedIn: true, tid, fid, repquotePid: repquote, action, hidden };
}

async function replyThread(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const tid = Number(payload?.tid);
  const fid = Number(payload?.fid);
  const repquotePid = payload?.repquotePid != null ? Number(payload.repquotePid) : null;
  const message = String(payload?.message || "").trim();
  if (!Number.isFinite(tid) || tid <= 0) throw new Error("tid is required");
  if (!Number.isFinite(fid) || fid <= 0) throw new Error("fid is required");
  if (!message) throw new Error("message is required");

  const formRes = await getReplyForm({ tid, fid, repquotePid });
  if (!formRes?.loggedIn) return { loggedIn: false };

  const action =
    formRes.action ||
    `/forum.php?mod=post&action=reply&fid=${fid}&tid=${tid}${repquotePid ? `&repquote=${repquotePid}` : ""}&replysubmit=yes`;
  const hidden = formRes.hidden || {};

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) params.set(k, String(v ?? ""));
  params.set("message", message);
  params.set("replysubmit", "true");

  const res = await legacyRequest(action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/forum.php?mod=post&action=reply&fid=${fid}&tid=${tid}`,
    },
    body: params,
    timeoutMs: 40_000,
  });

  if (!res.ok) {
    const err = new Error(`Reply failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = res.text;
    throw err;
  }

  return { loggedIn: true, ok: true };
}

async function listPmThreads() {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const html = await fetchHtml("/home.php?mod=space&do=pm&filter=privatepm", {
    headers: { Accept: "text/html" },
  });
  if (looksLikeLegacyLoggedOut(html)) return { loggedIn: false };

  /** @type {any[]} */
  const threads = [];
  for (const m of html.matchAll(/<dl\b([^>]*)id="pmlist_(\d+)"([^>]*)>([\s\S]*?)<\/dl>/gi)) {
    const attrs = `${m[1] || ""} ${m[3] || ""}`;
    const block = m[4] || "";

    // Discuz uses `pmlist_{plid}` as the container id. Do NOT treat it as `touid`,
    // otherwise the PM preview will look correct but opening/sending will break.
    const plidRaw = m[2] || null;
    const plid = plidRaw ? Number(plidRaw) : null;

    const touidFromViewLink =
      block.match(
        /home\.php\?mod=space(?:&amp;|&)do=pm(?:&amp;|&)subop=view[^"'#]*(?:&amp;|&)touid=(\d+)/i
      )?.[1] || null;
    const touidFromDeleteInput = block.match(/name="deletepm_deluid\[\]"[^>]*value="(\d+)"/i)?.[1] || null;

    const uidMatches = Array.from(
      block.matchAll(/(?:home\.php\?mod=space(?:&amp;|&)uid=|space-uid-)(\d+)/gi)
    )
      .map((x) => Number(x[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    const meUid = sess.currentUser?.id != null ? Number(sess.currentUser.id) : null;
    const touidFromUidLink =
      uidMatches.find((n) => (meUid != null ? n !== meUid : true)) ?? uidMatches[0] ?? null;

    const touidRaw =
      touidFromViewLink ||
      touidFromDeleteInput ||
      (touidFromUidLink != null ? String(touidFromUidLink) : null) ||
      block.match(/(?:^|[?&]|&amp;)touid=(\d+)/i)?.[1] ||
      null;
    const touid = touidRaw ? Number(touidRaw) : null;
    if (!touid || !Number.isFinite(touid) || touid <= 0) continue;

    const usernameRaw =
      block.match(/class="xw1"[^>]*>\s*([^<]+)\s*<\/a>/i)?.[1] ||
      block.match(/<a[^>]*home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      "";
    const username = decodeHtmlEntities(usernameRaw).trim() || String(touid);

    const avatarRaw =
      block.match(/<img[^>]*src="([^"]*(?:avatar\.php\?uid=\d+[^"]*|_avatar_(?:small|middle|big)\.jpg[^"]*))"/i)?.[1] ||
      extractImageSrc(block) ||
      null;
    const avatarUrl =
      (avatarRaw ? absoluteUrl(decodeHtmlEntities(avatarRaw)) : null) || legacyAvatarUrl(touid, "small");

    const snippetRaw =
      block.match(/<p[^>]*class="maxh"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ||
      block.match(/<dd[^>]*class="[^"]*ntc_body[^"]*"[^>]*>([\s\S]*?)<\/dd>/i)?.[1] ||
      block.match(/<br\s*\/?>\s*([\s\S]*?)\s*&nbsp;/i)?.[1] ||
      "";
    const lastMessagePreview = stripHtmlToText(decodeHtmlEntities(snippetRaw)).trim();

    const timeRaw =
      block.match(/<span[^>]*class="[^"]*\bxg1\b[^"]*"[^>]*title="([^"]+)"/i)?.[1] ||
      block.match(/<span[^>]*class="[^"]*\bxg1\b[^"]*"[^>]*>([^<]+)<\/span>/i)?.[1] ||
      block.match(/title="(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}[^"]*)"/i)?.[1] ||
      "";
    const lastMessageAt = timeRaw ? parseDiscuzTimeToIso(decodeHtmlEntities(timeRaw)) : null;

    const classValue = attrFromTag(`<dl ${attrs}>`, "class") || "";
    // Some templates use generic "new" class for layout; avoid treating it as unread.
    const unread =
      /\bnewpm\b/i.test(classValue) || /\bnewpm_avt\b/i.test(block) || /\bid="pmnew_\d+"/i.test(block) ? 1 : 0;

    threads.push({
      id: -touid,
      kind: "dm",
      title: username,
      description: "旧版私信",
      participants: [{ id: touid, username, name: username, avatarUrl: avatarUrl || null }],
      avatarUrl: avatarUrl || null,
      lastMessageAt,
      lastMessagePreview,
      unread,
      isGroup: false,
      url: `${BASE_URL}/home.php?mod=space&do=pm&subop=view&touid=${touid}${plid && Number.isFinite(plid) && plid > 0 ? `&plid=${plid}` : ""}#last`,
      legacy: { source: "discuz", touid, plid: plid && Number.isFinite(plid) && plid > 0 ? plid : undefined },
    });
  }

  threads.sort(
    (a, b) => (Date.parse(b.lastMessageAt || "") || 0) - (Date.parse(a.lastMessageAt || "") || 0)
  );

  return { loggedIn: true, threads };
}

async function getPmMessages(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const touid = Number(payload?.touid);
  if (!Number.isFinite(touid) || touid <= 0) throw new Error("touid is required");

  const plidRaw = payload?.plid != null ? Number(payload.plid) : null;
  const plid = plidRaw != null && Number.isFinite(plidRaw) && plidRaw > 0 ? Math.trunc(plidRaw) : null;

  const pageRaw = payload?.page != null ? Number(payload.page) : null;
  const page = pageRaw != null && Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : null;
  const baseUrl = `/home.php?mod=space&do=pm&subop=view&touid=${encodeURIComponent(String(touid))}${
    plid != null ? `&plid=${encodeURIComponent(String(plid))}` : ""
  }`;
  const url = page ? `${baseUrl}&page=${encodeURIComponent(String(page))}#last` : `${baseUrl}#last`;

  const html = await fetchHtml(url, { headers: { Accept: "text/html" } });
  if (looksLikeLegacyLoggedOut(html)) return { loggedIn: false };

  let form = extractFormHtml(html, "pmform");
  if (!/name=["']message["']/i.test(form) || !/(?:ac=pm|do=pm)/i.test(form)) {
    const fm =
      html.match(/<form\b[^>]*action="[^"]*(?:spacecp[^"]*ac=pm|ac=pm[^"]*spacecp)[^"]*"[\s\S]*?<\/form>/i) ||
      html.match(/<form\b[^>]*>[\s\S]*?name=["']message["'][\s\S]*?<\/form>/i) ||
      null;
    if (fm) form = fm[0];
  }
  const action = parseFormAction(form);
  const hidden = parseHiddenInputs(form);
  if (!hidden.formhash) {
    const fh =
      html.match(/name="formhash"\s+value="([^"]+)"/i)?.[1] ||
      html.match(/\bformhash\s*=\s*'([^']+)'/i)?.[1] ||
      html.match(/\bformhash\s*=\s*"([^"]+)"/i)?.[1] ||
      null;
    if (fh) hidden.formhash = decodeHtmlEntities(fh);
  }

  const pageCandidates = Array.from(html.matchAll(/[?&]page=(\d+)/gi))
    .map((x) => Number(x[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const pageFromStrong = Number(html.match(/<strong>(\d+)<\/strong>/i)?.[1] || 0);
  const currentPage =
    page && Number.isFinite(page) && page > 0
      ? page
      : pageFromStrong > 0
        ? pageFromStrong
        : pageCandidates.length > 0
          ? Math.max(...pageCandidates)
          : 1;
  const prevPage =
    pageCandidates
      .filter((n) => n < currentPage)
      .sort((a, b) => b - a)[0] || (currentPage > 1 ? currentPage - 1 : null);

  /** @type {any[]} */
  const messages = [];
  let seq = 0;
  const usedIds = new Set();

  let listHtml = html;
  const ulMatch = html.match(/<ul\b[^>]*id=["']pm_ul_post["'][^>]*>([\s\S]*?)<\/ul>/i);
  if (ulMatch) {
    listHtml = ulMatch[1] || "";
  } else {
    const startIdx = html.search(/id=["']pm_ul_post["']/i);
    if (startIdx >= 0) {
      const after = html.slice(startIdx);
      const stopIdx = after.search(/id=["']pmform["']|name=["']pmform["']|<form\b/i);
      listHtml = stopIdx > 0 ? after.slice(0, stopIdx) : after;
    }
  }

  const blocks = [];
  for (const m of listHtml.matchAll(/<li\b[^>]*class="[^"]*\bpm_(?:me|them)\b[^"]*"[^>]*>[\s\S]*?<\/li>/gi)) {
    blocks.push(m[0] || "");
  }
  if (blocks.length === 0) {
    for (const m of listHtml.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)) blocks.push(m[0] || "");
  }
  if (blocks.length === 0) {
    for (const m of listHtml.matchAll(/<dl\b[^>]*>[\s\S]*?<\/dl>/gi)) blocks.push(m[0] || "");
  }
  if (blocks.length === 0) {
    for (const m of listHtml.matchAll(/<div\b[^>]*class="[^"]*\bpm_(?:me|them)\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi)) {
      blocks.push(m[0] || "");
    }
  }
  if (blocks.length === 0) {
    // Some templates don't wrap each message in a neatly closed tag. Slice by start tags as a fallback.
    const markers = Array.from(
      listHtml.matchAll(/<(?:li|div|dl)\b[^>]*class="[^"]*\bpm_(?:me|them)\b[^"]*"[^>]*>/gi)
    );
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index ?? 0;
      const end = i + 1 < markers.length ? markers[i + 1].index ?? listHtml.length : listHtml.length;
      const slice = listHtml.slice(start, end);
      if (slice) blocks.push(slice);
    }
  }

  for (const rawBlock of blocks) {
    const block = rawBlock || "";
    if (/id="pmform"/i.test(block) || /name="pmform"/i.test(block)) continue;
    if (/<textarea\b/i.test(block)) continue;

    const wrapperTag = block.match(/<(?:li|dl)\b[^>]*>/i)?.[0] || "";
    const classValue = attrFromTag(wrapperTag, "class") || "";

    const uidRaw =
      block.match(/(?:home\.php\?mod=space(?:&amp;|&)uid=|space-uid-)(\d+)/i)?.[1] ||
      block.match(/\buid=(\d+)/i)?.[1] ||
      null;
    let uid = uidRaw ? Number(uidRaw) : null;
    if (!Number.isFinite(uid) || uid <= 0) uid = null;

    let from = sess.currentUser?.id && uid && sess.currentUser.id === uid ? "me" : "them";
    if (/\b(?:pm_me|self|mine)\b/i.test(classValue)) from = "me";
    if (/\b(?:pm_them|other)\b/i.test(classValue)) from = "them";
    if (!uid) uid = from === "me" ? (sess.currentUser?.id ?? null) : touid;
    const avatarRaw =
      block.match(/<img[^>]*src="([^"]*(?:avatar\.php\?uid=\d+[^"]*|_avatar_(?:small|middle|big)\.jpg[^"]*))"/i)?.[1] ||
      extractImageSrc(block) ||
      null;
    const avatarUrl =
      (avatarRaw ? absoluteUrl(decodeHtmlEntities(avatarRaw)) : null) ||
      (uid ? legacyAvatarUrl(uid, "small") : null);

    const usernameRaw =
      block.match(/<span[^>]*class="[^"]*\bxi2\b[^"]*\bxw1\b[^"]*"[^>]*>([^<]+)<\/span>/i)?.[1] ||
      block.match(/class="xw1"[^>]*>\s*([^<]+)\s*<\/a>/i)?.[1] ||
      block.match(/home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      block.match(/space-uid-\d+[^>]*>([^<]+)<\/a>/i)?.[1] ||
      "";
    const username = decodeHtmlEntities(usernameRaw).trim() || (uid ? String(uid) : "unknown");

    const timeRaw =
      block.match(/<span[^>]*class="[^"]*\bxg1\b[^"]*"[^>]*title="([^"]+)"/i)?.[1] ||
      block.match(/<span[^>]*class="[^"]*\bxg1\b[^"]*"[^>]*>([^<]+)<\/span>/i)?.[1] ||
      block.match(/title="(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}[^"]*)"/i)?.[1] ||
      "";
    const createdAt =
      (timeRaw ? parseDiscuzTimeToIso(decodeHtmlEntities(timeRaw)) : null) || new Date().toISOString();

    let msgRaw =
      block.match(/<div[^>]*class="[^"]*\bpmb\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      block.match(/<div[^>]*class="[^"]*\bpm_c\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      block.match(/<div[^>]*class="[^"]*\bpm_msg\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      block.match(/<div[^>]*class="[^"]*\bpm_message\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      block.match(/<dd[^>]*class="[^"]*(?:pm_c|xg2|ntc_body|pmm)[^"]*"[^>]*>([\s\S]*?)<\/dd>/i)?.[1] ||
      "";
    if (!msgRaw) {
      const ddMatches = Array.from(block.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)).map((x) => x[1] || "");
      for (let i = ddMatches.length - 1; i >= 0; i--) {
        const candidate = ddMatches[i];
        const plain = stripHtmlToText(decodeHtmlEntities(candidate));
        if (!plain) continue;
        // Skip common action links like "reply/delete" shown in some templates.
        if (/^(?:发送|回复|删除|操作|reply|delete)/i.test(plain) && plain.length <= 24) continue;
        msgRaw = candidate;
        break;
      }
    }
    const cooked = decodeHtmlEntities(String(msgRaw || "").replace(/<br\s*\/?>/gi, "<br/>")).trim();
    if (!cooked) continue;

    const pmidRaw =
      block.match(/\bpmlist_(\d+)/i)?.[1] ||
      block.match(/\bpmid=(\d+)/i)?.[1] ||
      block.match(/\bid="pm_(\d+)"/i)?.[1] ||
      null;
    const pmid = pmidRaw ? Number(pmidRaw) : null;

    const baseMs = Date.parse(createdAt) || 0;
    const tail = stableNumberFromText(`${uid || 0}|${username}|${stripHtmlToText(cooked).slice(0, 120)}`) % 997;
    let id =
      pmid != null && Number.isFinite(pmid) && pmid > 0
        ? pmid
        : baseMs
          ? baseMs * 1000 + tail
          : Math.floor(Date.now() * 1000 + ((seq++) % 1000));
    while (usedIds.has(id)) id += 1;
    usedIds.add(id);

    messages.push({
      id,
      from,
      userId: uid,
      username,
      avatarUrl,
      cooked,
      createdAt,
      legacy: { source: "discuz", touid, plid: plid != null ? plid : undefined },
    });
  }

  messages.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || (a.id - b.id));

  return { loggedIn: true, touid, plid, page: currentPage || null, prevPage, action, hidden, messages };
}

async function sendPmMessage(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const touid = Number(payload?.touid);
  const plidRaw = payload?.plid != null ? Number(payload.plid) : null;
  const plid = plidRaw != null && Number.isFinite(plidRaw) && plidRaw > 0 ? Math.trunc(plidRaw) : null;
  const message = String(payload?.message || "").trim();
  if (!Number.isFinite(touid) || touid <= 0) throw new Error("touid is required");
  if (!message) throw new Error("message is required");

  let viewHtml = "";
  try {
    const viewUrl = `/home.php?mod=space&do=pm&subop=view&touid=${encodeURIComponent(String(touid))}${
      plid != null ? `&plid=${encodeURIComponent(String(plid))}` : ""
    }#last`;
    viewHtml = await fetchHtml(
      viewUrl,
      { headers: { Accept: "text/html" } }
    );
  } catch {
    viewHtml = await fetchHtml("/home.php", { headers: { Accept: "text/html" } });
  }
  if (looksLikeLegacyLoggedOut(viewHtml)) return { loggedIn: false };

  let form = extractFormHtml(viewHtml, "pmform");
  if (!/name=["']message["']/i.test(form) || !/(?:ac=pm|do=pm)/i.test(form)) {
    const fm =
      viewHtml.match(/<form\b[^>]*action="[^"]*(?:spacecp[^"]*ac=pm|ac=pm[^"]*spacecp)[^"]*"[\s\S]*?<\/form>/i) ||
      viewHtml.match(/<form\b[^>]*>[\s\S]*?name=["']message["'][\s\S]*?<\/form>/i) ||
      null;
    if (fm) form = fm[0];
  }

  let action =
    parseFormAction(form) ||
    `/home.php?mod=spacecp&ac=pm&op=send&touid=${encodeURIComponent(String(touid))}&pmsubmit=yes`;
  if (action && !/inajax=1/i.test(action)) action += (action.includes("?") ? "&" : "?") + "inajax=1";

  const hidden = parseHiddenInputs(form);
  if (!hidden.formhash) {
    const fh =
      viewHtml.match(/name="formhash"\s+value="([^"]+)"/i)?.[1] ||
      viewHtml.match(/\bformhash\s*=\s*'([^']+)'/i)?.[1] ||
      viewHtml.match(/\bformhash\s*=\s*"([^"]+)"/i)?.[1] ||
      null;
    if (fh) hidden.formhash = decodeHtmlEntities(fh);
  }
  if (!hidden.formhash) throw new Error("Missing formhash");

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) params.set(k, String(v ?? ""));
  params.set("message", message);
  params.set("pmsubmit", "true");
  if (!params.get("handlekey")) params.set("handlekey", "pm_send");
  if (!params.get("touid")) params.set("touid", String(touid));
  if (plid != null && !params.get("plid")) params.set("plid", String(plid));

  const res = await legacyRequest(action, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/home.php?mod=space&do=pm&subop=view&touid=${touid}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: params,
    timeoutMs: 25_000,
  });

  if (!res.ok) {
    const err = new Error(`Send PM failed: HTTP ${res.status}`);
    err.status = res.status;
    err.body = res.text;
    throw err;
  }

  const text = String(res.text || "");
  if (/loginform_/i.test(text) || /member\.php\?mod=logging/i.test(text)) {
    return { loggedIn: false };
  }

  const errBox =
    text.match(/<div[^>]*class="[^"]*\balert_error\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    text.match(/<div[^>]*id="messagetext"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
    null;
  const errText = errBox ? stripHtmlToText(decodeHtmlEntities(errBox)).trim() : "";
  if (errText && /抱歉|错误|无权|权限|失败|验证码|安全提问|请输入/i.test(errText) && !/成功/i.test(errText)) {
    throw new Error(`Send PM rejected: ${errText}`);
  }

  return { loggedIn: true, ok: true };
}

async function searchUsers(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };
  const term = String(payload?.term || "").trim();
  const limit = Math.max(1, Math.min(10, Number(payload?.limit || 8)));
  if (!term) return { loggedIn: true, users: [] };

  const users = [];
  const isUid = /^\d+$/.test(term);
  try {
    const html = await fetchHtml(
      isUid
        ? `/home.php?mod=space&uid=${encodeURIComponent(term)}`
        : `/home.php?mod=space&username=${encodeURIComponent(term)}`,
      { headers: { Accept: "text/html" } }
    );
    const u = parseSpaceUserFromAnyPage(html, { uid: isUid ? Number(term) : null });
    if (u) users.push(u);
  } catch {
    // ignore
  }

  return { loggedIn: true, users: users.slice(0, limit) };
}

async function getUser(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };
  const uid = payload?.uid != null ? String(payload.uid).trim() : "";
  const username = payload?.username != null ? String(payload.username).trim() : "";
  if (!uid && !username) throw new Error("uid or username is required");

  const html = await fetchHtml(
    uid
      ? `/home.php?mod=space&uid=${encodeURIComponent(uid)}`
      : `/home.php?mod=space&username=${encodeURIComponent(username)}`,
    { headers: { Accept: "text/html" } }
  );
  if (looksLikeLegacyLoggedOut(html)) return { loggedIn: false };

  const u = parseSpaceUserFromAnyPage(html, { uid: uid ? Number(uid) : null });
  if (!u) throw new Error("User not found");
  return { loggedIn: true, user: u };
}

async function listUserCreatedTopics(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  let uid = payload?.uid != null ? Number(payload.uid) : null;
  let username = payload?.username != null ? String(payload.username).trim() : "";

  if ((!uid || !Number.isFinite(uid) || uid <= 0) && !username) {
    throw new Error("uid or username is required");
  }

  if ((!uid || !Number.isFinite(uid) || uid <= 0) && username) {
    try {
      const u = await getUser({ username });
      const id = Number((u?.user || {}).id);
      if (Number.isFinite(id) && id > 0) uid = id;
    } catch {
      // ignore
    }
  }

  const urls = [];
  if (uid && Number.isFinite(uid) && uid > 0) {
    urls.push(`/home.php?mod=space&uid=${encodeURIComponent(String(uid))}&do=thread&view=me&type=thread`);
    urls.push(`/home.php?mod=space&uid=${encodeURIComponent(String(uid))}&do=thread&view=me`);
  }
  if (username) {
    urls.push(
      `/home.php?mod=space&username=${encodeURIComponent(username)}&do=thread&view=me&type=thread`
    );
    urls.push(`/home.php?mod=space&username=${encodeURIComponent(username)}&do=thread&view=me`);
  }

  let html = "";
  for (const url of urls) {
    try {
      const h = await fetchHtml(url, { headers: { Accept: "text/html" } });
      if (looksLikeLegacyLoggedOut(h)) return { loggedIn: false };

      // Ensure we didn't get redirected to another user's space (common when username lookup fails).
      if (uid && Number.isFinite(uid) && uid > 0) {
        const suidRaw =
          h.match(/\bspace_uid\s*=\s*['"](\d+)['"]/i)?.[1] || h.match(/\bspaceuid\s*=\s*['"](\d+)['"]/i)?.[1] || null;
        const suid = suidRaw ? Number(suidRaw) : null;
        if (suid != null && Number.isFinite(suid) && suid > 0 && suid !== uid) continue;
      }

      if (h && /viewthread[^>]*tid=/i.test(h)) {
        html = h;
        break;
      }
      if (!html) html = h;
    } catch {
      // ignore
    }
  }

  if (!html) return { loggedIn: true, posts: [] };

  /** @type {any[]} */
  const posts = [];
  const seenTid = new Set();

  for (const tm of html.matchAll(/<tbody\b[^>]*id="normalthread_(\d+)"[^>]*>([\s\S]*?)<\/tbody>/gi)) {
    const tid = Number(tm[1]);
    if (!Number.isFinite(tid) || tid <= 0 || seenTid.has(tid)) continue;
    seenTid.add(tid);

    const row = tm[2] || "";
    const title = extractThreadTitle(row, tid) || `TID ${tid}`;
    const fidRaw = row.match(/forumdisplay&fid=(\d+)/i)?.[1] || null;
    const fid = fidRaw ? Number(fidRaw) : null;
    const forumNameRaw = row.match(/forumdisplay&fid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] || "";
    const forumName = decodeHtmlEntities(forumNameRaw).trim() || (fid ? `FID ${fid}` : "旧版");
    const replies = Number(row.match(/<td class="num"[^>]*>[\s\S]*?<a[^>]*>(\d+)<\/a>/i)?.[1] || "0") || 0;
    const views = Number(row.match(/<td class="num"[^>]*>[\s\S]*?<em>(\d+)<\/em>/i)?.[1] || "0") || 0;
    const timeRaw =
      row.match(/<span[^>]*title="([^"]+)"/i)?.[1] ||
      row.match(/<em[^>]*>([^<]+)<\/em>/i)?.[1] ||
      "";
    const lastPostedAt = (timeRaw ? parseDiscuzTimeToIso(timeRaw) : null) || new Date().toISOString();

    posts.push({
      id: -tid,
      title,
      slug: String(tid),
      excerpt: "",
      likeCount: 0,
      liked: false,
      replyCount: replies,
      views,
      lastPostedAt,
      createdAt: lastPostedAt,
      category: fid
        ? { id: -fid, name: forumName, color: stableColorHexFromInt(fid), textColor: "ffffff" }
        : { id: -1, name: forumName, color: "64748b", textColor: "ffffff" },
      author: sess.currentUser
        ? {
            id: sess.currentUser.id,
            username: sess.currentUser.username,
            name: sess.currentUser.name || sess.currentUser.username,
            avatarUrl: sess.currentUser.avatarUrl || legacyAvatarUrl(sess.currentUser.id, "small"),
          }
        : null,
      url: `${BASE_URL}/forum.php?mod=viewthread&tid=${tid}`,
      legacy: { source: "discuz", tid, fid: fid || null },
    });
  }

  if (posts.length === 0) {
    for (const mm of html.matchAll(/<a\b[^>]*href="([^"]*viewthread[^"]*tid=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const tid = Number(mm[2]);
      if (!Number.isFinite(tid) || tid <= 0 || seenTid.has(tid)) continue;
      const title = stripHtmlToText(decodeHtmlEntities(mm[3] || "")).trim();
      if (!title || /^\d+$/.test(title)) continue;
      seenTid.add(tid);

      posts.push({
        id: -tid,
        title,
        slug: String(tid),
        excerpt: "",
        likeCount: 0,
        liked: false,
        replyCount: 0,
        views: 0,
        lastPostedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        category: null,
        author: sess.currentUser
          ? {
              id: sess.currentUser.id,
              username: sess.currentUser.username,
              name: sess.currentUser.name || sess.currentUser.username,
              avatarUrl: sess.currentUser.avatarUrl || legacyAvatarUrl(sess.currentUser.id, "small"),
            }
          : null,
        url: `${BASE_URL}/forum.php?mod=viewthread&tid=${tid}`,
        legacy: { source: "discuz", tid, fid: null },
      });

      if (posts.length >= 120) break;
    }
  }

  posts.sort((a, b) => (Date.parse(b.lastPostedAt || b.createdAt) || 0) - (Date.parse(a.lastPostedAt || a.createdAt) || 0));
  return { loggedIn: true, posts: posts.slice(0, 120) };
}

async function listNotifications(payload) {
  const sess = await getSession();
  if (!sess.loggedIn) return { loggedIn: false };

  const limit = Math.max(10, Math.min(80, Number(payload?.limit || 60)));

  const types = Array.isArray(payload?.kinds) ? payload.kinds : ["mention", "reply"];
  const wantMention = types.includes("mention");
  const wantReply = types.includes("reply");

  const pages = [];
  if (wantReply) pages.push({ kind: "reply", url: "/home.php?mod=space&do=notice&view=mypost&type=post" });
  if (wantMention) pages.push({ kind: "mention", url: "/home.php?mod=space&do=notice&view=mypost&type=at" });

  /** @type {any[]} */
  const out = [];
  for (const p of pages) {
    let html = "";
    try {
      html = await fetchHtml(p.url, { headers: { Accept: "text/html" } });
    } catch {
      continue;
    }

    for (const m of html.matchAll(/<dl\b[^>]*notice="(\d+)"[^>]*>[\s\S]*?<\/dl>/gi)) {
      const noticeId = Number(m[1] || 0);
      const block = m[0] || "";

      const timeTitle = block.match(/<span[^>]*title="([^"]+)"/i)?.[1] || null;
      const createdAt =
        (timeTitle ? parseDiscuzTimeToIso(decodeHtmlEntities(timeTitle)) : null) || new Date().toISOString();

      const authorUidRaw = block.match(/home\.php\?mod=space(?:&amp;|&)uid=(\d+)/i)?.[1] || null;
      const authorUid = authorUidRaw ? Number(authorUidRaw) : null;
      const usernameRaw =
        block.match(/home\.php\?mod=space(?:&amp;|&)uid=\d+[^>]*>([^<]+)<\/a>/i)?.[1] || null;
      const username = usernameRaw ? decodeHtmlEntities(usernameRaw).trim() : null;
      const avatarRaw =
        block.match(/<img[^>]*src="([^"]*(?:avatar\.php\?uid=\d+[^"]*|_avatar_(?:small|middle|big)\.jpg[^"]*))"/i)?.[1] ||
        extractImageSrc(block) ||
        null;
      const avatarUrl = avatarRaw
        ? absoluteUrl(decodeHtmlEntities(avatarRaw))
        : authorUid
          ? legacyAvatarUrl(authorUid, "small")
          : null;

      const linkRaw = block.match(/goto=findpost&ptid=(\d+)&pid=(\d+)/i);
      const ptid = linkRaw ? Number(linkRaw[1]) : null;
      const pid = linkRaw ? Number(linkRaw[2]) : null;

      const titleRaw =
        block.match(/(?:viewthread|goto=findpost)[^>]*>([\s\S]*?)<\/a>\s*(?:&nbsp;|\s)/i)?.[1] ||
        block.match(/<a[^>]*target="_blank"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
        "";
      const title = stripHtmlToText(decodeHtmlEntities(titleRaw)).trim() || null;

      const url = ptid && pid ? `${BASE_URL}/forum.php?mod=redirect&goto=findpost&ptid=${ptid}&pid=${pid}` : null;

      const stableFallback = stableNumberFromText(`${p.kind}|${createdAt}|${url || ""}|${title || ""}`);
      const uniqueBase = noticeId > 0 ? noticeId : stableFallback;
      const kindTag = p.kind === "mention" ? 1 : p.kind === "reply" ? 2 : 9;
      const stableId = -(Math.abs(uniqueBase * 10 + kindTag) || stableFallback || 1);

      out.push({
        id: stableId,
        kind: p.kind,
        read: false,
        createdAt,
        username: username || null,
        userId: authorUid || null,
        avatarUrl,
        title,
        excerpt: null,
        topicId: ptid ? -ptid : null,
        postNumber: pid || null,
        chatChannelId: null,
        chatMessageId: null,
        url,
        legacy: { source: "discuz", noticeId, ptid, pid },
      });
    }
  }

  const dedup = new Map();
  for (const n of out) {
    const key = `${n.url || ""}|${n.createdAt || ""}|${n.kind}`;
    if (!dedup.has(key)) dedup.set(key, n);
  }

  const list = Array.from(dedup.values())
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, limit);

  return { loggedIn: true, notifications: list };
}

function openExternal(url) {
  if (!url) return Promise.resolve();
  return shell.openExternal(String(url));
}

function registerIpc(ipcMain) {
  ipcMain.handle("legacy:getSession", async () => getSession());
  ipcMain.handle("legacy:openLogin", async () => openLogin());
  ipcMain.handle("legacy:logout", async () => logout());
  ipcMain.handle("legacy:listForumTree", async () => listForumTree());
  ipcMain.handle("legacy:listLatest", async (_ev, payload) => listLatest(payload));
  ipcMain.handle("legacy:listForumThreads", async (_ev, payload) => listForumThreads(payload));
  ipcMain.handle("legacy:getThread", async (_ev, payload) => getThread(payload));
  ipcMain.handle("legacy:resolveFindpost", async (_ev, payload) => resolveFindpost(payload));
  ipcMain.handle("legacy:getNewThreadForm", async (_ev, payload) => getNewThreadForm(payload));
  ipcMain.handle("legacy:createThread", async (_ev, payload) => createThread(payload));
  ipcMain.handle("legacy:getReplyForm", async (_ev, payload) => getReplyForm(payload));
  ipcMain.handle("legacy:replyThread", async (_ev, payload) => replyThread(payload));
  ipcMain.handle("legacy:listPmThreads", async () => listPmThreads());
  ipcMain.handle("legacy:getPmMessages", async (_ev, payload) => getPmMessages(payload));
  ipcMain.handle("legacy:sendPmMessage", async (_ev, payload) => sendPmMessage(payload));
  ipcMain.handle("legacy:searchUsers", async (_ev, payload) => searchUsers(payload));
  ipcMain.handle("legacy:getUser", async (_ev, payload) => getUser(payload));
  ipcMain.handle("legacy:listUserCreatedTopics", async (_ev, payload) => listUserCreatedTopics(payload));
  ipcMain.handle("legacy:listNotifications", async (_ev, payload) => listNotifications(payload));
  ipcMain.handle("legacy:openExternal", async (_ev, url) => openExternal(url));
}

module.exports = { registerIpc };
