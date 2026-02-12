<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import Sidebar from "@/components/Sidebar.vue";
import NotificationsModal from "@/components/NotificationsModal.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import TitleBar from "@/components/TitleBar.vue";
import TopicModal from "@/components/TopicModal.vue";
import LegacyThreadModal from "@/components/LegacyThreadModal.vue";
import LegacyNewThreadModal from "@/components/LegacyNewThreadModal.vue";
import UserCardModal from "@/components/UserCardModal.vue";
import UserSpaceModal from "@/components/UserSpaceModal.vue";
import NewTopicModal from "@/components/NewTopicModal.vue";
import PostTargetModal from "@/components/PostTargetModal.vue";
import WindowResizeHandles from "@/components/WindowResizeHandles.vue";
import ChatView from "@/views/ChatView.vue";
import ConnectView from "@/views/ConnectView.vue";
import DiscoverView from "@/views/DiscoverView.vue";
import type {
  BrowseCategory,
  ChatChannel,
  FeedPost,
  ForumMessage,
  ForumNotification,
  ForumUpload,
  ForumUser,
} from "@/data/forum";

type Section = "chat" | "discover";
type SiteMode = "new" | "old" | "both";

const BASE_URL = "https://river-side.cc";
const LEGACY_BASE_URL = "https://bbs.uestc.edu.cn";

const loading = ref(false);
const error = ref<string | null>(null);

const me = ref<ForumUser | null>(null);
const isLoggedIn = computed(() => !!me.value);

const SITE_MODE_KEY = "riverside.siteMode";
const siteMode = ref<SiteMode>("new");

try {
  const raw = localStorage.getItem(SITE_MODE_KEY);
  if (raw === "new" || raw === "old" || raw === "both") siteMode.value = raw;
} catch {
  // ignore
}

const setSiteMode = (next: SiteMode) => {
  siteMode.value = next;
  try {
    localStorage.setItem(SITE_MODE_KEY, next);
  } catch {
    // ignore
  }
};

const useDiscourse = computed(() => siteMode.value !== "old");
const useLegacy = computed(() => siteMode.value !== "new");

const legacyMe = ref<ForumUser | null>(null);
const legacyLoggedIn = computed(() => !!legacyMe.value);
let legacySessionCheckedAt = 0;

const notificationsOpen = ref(false);
const notifications = ref<ForumNotification[]>([]);
const notificationsLoading = ref(false);
const notificationsError = ref<string | null>(null);
const notificationCount = computed(() => notifications.value.filter((n) => !n.read).length);

const LEGACY_NOTICE_READ_KEY = "riverside.legacy.noticeRead";
const LEGACY_PM_READ_KEY = "riverside.legacy.pmRead";
const LEGACY_PM_BOOTSTRAP_KEY = "riverside.legacy.pmReadBootstrapped";
const loadLegacyNoticeRead = () => {
  try {
    const raw = localStorage.getItem(LEGACY_NOTICE_READ_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return new Set<number>();
    return new Set(arr.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 2000));
  } catch {
    return new Set<number>();
  }
};

const legacyNoticeRead = ref<Set<number>>(loadLegacyNoticeRead());

const saveLegacyNoticeRead = () => {
  try {
    localStorage.setItem(LEGACY_NOTICE_READ_KEY, JSON.stringify(Array.from(legacyNoticeRead.value).slice(-2000)));
  } catch {
    // ignore
  }
};

const markLegacyNoticeRead = (id: number) => {
  const n = Math.abs(Number(id));
  if (!Number.isFinite(n) || n <= 0) return;
  legacyNoticeRead.value.add(n);
  saveLegacyNoticeRead();
};

const loadLegacyPmReadMap = () => {
  try {
    const raw = localStorage.getItem(LEGACY_PM_READ_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    if (!obj || typeof obj !== "object") return new Map<number, number>();
    const map = new Map<number, number>();
    for (const [k, v] of Object.entries(obj)) {
      const uid = Number(k);
      const ts = Number(v);
      if (Number.isFinite(uid) && uid > 0 && Number.isFinite(ts) && ts > 0) map.set(uid, ts);
    }
    return map;
  } catch {
    return new Map<number, number>();
  }
};

const saveLegacyPmReadMap = () => {
  try {
    const obj: Record<string, number> = {};
    for (const [uid, ts] of legacyPmReadMap.value.entries()) obj[String(uid)] = ts;
    localStorage.setItem(LEGACY_PM_READ_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
};

const legacyPmReadMap = ref<Map<number, number>>(loadLegacyPmReadMap());
const legacyPmReadBootstrapped = ref<boolean>(localStorage.getItem(LEGACY_PM_BOOTSTRAP_KEY) === "1");

const setLegacyPmReadBootstrapped = (next: boolean) => {
  legacyPmReadBootstrapped.value = !!next;
  try {
    localStorage.setItem(LEGACY_PM_BOOTSTRAP_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }
};

const section = ref<Section>("chat");

const CHAT_COLLAPSE_KEY = "riverside.chatCollapsed";
const chatCollapsed = ref(false);

try {
  chatCollapsed.value = localStorage.getItem(CHAT_COLLAPSE_KEY) === "1";
} catch {
  // ignore
}

const setChatCollapsed = (next: boolean) => {
  chatCollapsed.value = next;
  try {
    localStorage.setItem(CHAT_COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }

  if (next && (!isLoggedIn.value || section.value !== "chat")) return;
  window.riverside?.window.setCollapsed?.(next).catch(() => {});
};

const toggleChatCollapsed = () => setChatCollapsed(!chatCollapsed.value);

const channels = ref<ChatChannel[]>([]);
const selectedChannelId = ref<number | null>(null);
const activeChannel = computed(() => {
  if (selectedChannelId.value == null) return null;
  return channels.value.find((c) => c.id === selectedChannelId.value) ?? null;
});

const chatMe = computed<ForumUser>(() => {
  const src = channelSource(activeChannel.value);
  if (src === "discuz" && legacyMe.value) return legacyMe.value;
  if (me.value) return me.value;
  return (
    legacyMe.value || ({ id: 0, username: "me", name: "me", avatarUrl: null } as ForumUser)
  );
});

const chatAttachmentsEnabled = computed(() => channelSource(activeChannel.value) !== "discuz");
const chatMentionProvider = computed<"forum" | "legacy" | "none">(() =>
  channelSource(activeChannel.value) === "discuz" ? "legacy" : "forum"
);

const messages = ref<ForumMessage[]>([]);
const chatHistoryLoading = ref(false);
const chatHasMoreHistory = ref(true);
const legacyPmCursor = ref<null | { touid: number; plid: number | null; prevPage: number | null }>(null);

const posts = ref<FeedPost[]>([]);
const categories = ref<BrowseCategory[]>([]);

type DiscoverContext =
  | { type: "all" }
  | { type: "discourse-category"; categoryId: number; slug: string; mode: "category" | "latest-filter"; allowedIds: number[] }
  | { type: "legacy-group"; gid: number; fids: number[] }
  | { type: "legacy-forum"; fid: number };

const discoverContext = ref<DiscoverContext>({ type: "all" });
const discoverGeneration = ref(0);
const discoverLoadingMore = ref(false);
const discoverPageDiscourse = ref(1);
const discoverPageLegacy = ref(1);
const discoverHasMoreDiscourse = ref(true);
const discoverHasMoreLegacy = ref(true);

const discoverHasMore = computed(() => {
  const ctx = discoverContext.value;
  if (ctx.type === "discourse-category") return discoverHasMoreDiscourse.value;
  if (ctx.type === "legacy-group" || ctx.type === "legacy-forum") return discoverHasMoreLegacy.value;
  const wantDiscourse = useDiscourse.value;
  const wantLegacy = useLegacy.value && legacyLoggedIn.value;
  return (wantDiscourse && discoverHasMoreDiscourse.value) || (wantLegacy && discoverHasMoreLegacy.value);
});

type LegacyForum = { fid: number; name: string; url: string; parentFid?: number | null };
type LegacyGroup = { gid: number; name: string; forums: LegacyForum[] };
const legacyGroups = ref<LegacyGroup[]>([]);

const normalizeKey = (s: string) => String(s || "").trim().toLowerCase();

const stableColorHexFromInt = (n: number) => {
  const x = Math.imul(Number(n) || 0, 2654435761) >>> 0;
  return (x & 0xffffff).toString(16).padStart(6, "0");
};

const LEGACY_FORUM_ID_OFFSET = 1_000_000_000;
const legacyGroupCategoryId = (gid: number) => -Math.abs(Number(gid) || 0);
const legacyForumCategoryId = (fid: number) => -(LEGACY_FORUM_ID_OFFSET + Math.abs(Number(fid) || 0));
const legacyIsGroupCategoryId = (id: number) => id < 0 && id > -LEGACY_FORUM_ID_OFFSET;
const legacyIsForumCategoryId = (id: number) => id <= -LEGACY_FORUM_ID_OFFSET;
const legacyFidFromCategoryId = (id: number) => {
  if (!legacyIsForumCategoryId(id)) return null;
  const fid = -Number(id) - LEGACY_FORUM_ID_OFFSET;
  return Number.isFinite(fid) && fid > 0 ? fid : null;
};

const legacyBrowseCategories = computed<BrowseCategory[]>(() => {
  const out: BrowseCategory[] = [];
  for (let gi = 0; gi < legacyGroups.value.length; gi++) {
    const g = legacyGroups.value[gi];
    const gid = Number(g?.gid) || 0;
    if (!gid) continue;

    const groupId = legacyGroupCategoryId(gid);
    out.push({
      id: groupId,
      name: g.name,
      slug: `legacy-g${gid}`,
      description: "旧版分类",
      position: gi,
      parentId: null,
      permission: 0,
      color: stableColorHexFromInt(gid),
      textColor: "ffffff",
    });

    let pos = gi * 10_000;
    for (const f of Array.isArray(g.forums) ? g.forums : []) {
      const fid = Number((f as any)?.fid) || 0;
      if (!fid) continue;
      const parentFid = (f as any)?.parentFid != null ? Number((f as any).parentFid) : null;
      const parentId =
        parentFid != null && Number.isFinite(parentFid) && parentFid > 0
          ? legacyForumCategoryId(parentFid)
          : groupId;

      out.push({
        id: legacyForumCategoryId(fid),
        name: String((f as any)?.name || `F${fid}`),
        slug: `legacy-f${fid}`,
        description: "旧版板块",
        position: pos++,
        parentId,
        permission: 0,
        color: stableColorHexFromInt(fid),
        textColor: "ffffff",
      });
    }
  }
  return out;
});

const legacyGroupByName = computed(() => {
  const map = new Map<string, LegacyGroup>();
  for (const g of legacyGroups.value) map.set(normalizeKey(g.name), g);
  return map;
});

const legacyForumNameByFid = computed(() => {
  const map = new Map<number, string>();
  for (const g of legacyGroups.value) {
    for (const f of g.forums || []) map.set(f.fid, f.name);
  }
  return map;
});

const legacyGidByFid = computed(() => {
  const map = new Map<number, number>();
  for (const g of legacyGroups.value) {
    const gid = Number((g as any)?.gid) || 0;
    if (!gid) continue;
    for (const f of (g as any)?.forums || []) {
      const fid = Number((f as any)?.fid) || 0;
      if (fid) map.set(fid, gid);
    }
  }
  return map;
});

const sidebarCategories = computed<BrowseCategory[]>(() => {
  const out: BrowseCategory[] = [];
  if (useDiscourse.value) out.push(...categories.value);
  if (useLegacy.value) out.push(...legacyBrowseCategories.value);
  return out;
});

const selectedCategoryId = ref<number | null>(null);
const activeCategory = computed(() => {
  if (selectedCategoryId.value == null) return null;
  return sidebarCategories.value.find((c) => c.id === selectedCategoryId.value) ?? null;
});

type CategoryOption = { id: number; name: string };

const discoverCategoryOptions = computed<CategoryOption[]>(() => {
  const id = selectedCategoryId.value;
  if (id == null) return [];

  const current = sidebarCategories.value.find((c) => c.id === id) ?? null;
  if (!current) return [];

  const byId = new Map<number, BrowseCategory>();
  for (const c of sidebarCategories.value) byId.set(c.id, c);

  const sortByPosition = (a: BrowseCategory, b: BrowseCategory) => (a.position ?? 0) - (b.position ?? 0);

  const pid = (current as any)?.parentId ?? null;
  if (pid != null) {
    const parentId = Number(pid);
    if (!Number.isFinite(parentId)) return [];
    const parent = byId.get(parentId) ?? null;
    const siblings = sidebarCategories.value.filter((c) => (c as any)?.parentId === parentId).sort(sortByPosition);

    const opts: CategoryOption[] = [];
    if (parent) opts.push({ id: parent.id, name: `${parent.name}（全部）` });
    opts.push(...siblings.map((c) => ({ id: c.id, name: c.name })));
    return opts;
  }

  const children = sidebarCategories.value.filter((c) => (c as any)?.parentId === id).sort(sortByPosition);
  if (children.length === 0) return [];
  return [{ id, name: `全部 ${current.name}` }, ...children.map((c) => ({ id: c.id, name: c.name }))];
});

const topicModalId = ref<number | null>(null);
const topicModalInitialPostNumber = ref<number | null>(null);
const activeTopicPost = computed(() => {
  if (topicModalId.value == null) return null;
  return posts.value.find((p) => p.id === topicModalId.value) ?? null;
});

const legacyThreadSeed = ref<null | { tid: number; fid?: number | null; pid?: number | null; page?: number | null }>(null);
const openLegacyThread = (seed: { tid: number; fid?: number | null; pid?: number | null; page?: number | null }) => {
  legacyThreadSeed.value = { ...seed };
};
const closeLegacyThread = () => {
  legacyThreadSeed.value = null;
};

const userCard = ref<
  | null
  | {
      username: string;
      source?: Source;
      seed?: { userId?: number | null; avatarUrl?: string | null } | null;
    }
>(null);

const openUserCard = (payload: { username: string; userId?: number | null; avatarUrl?: string | null; source?: Source }) => {
  const u = String(payload.username || "").trim();
  if (!u || u === "system") return;
  const source: Source =
    payload.source === "discuz" || payload.source === "discourse" ? payload.source : "discourse";
  userCard.value = {
    username: u,
    source,
    seed: { userId: payload.userId ?? null, avatarUrl: payload.avatarUrl ?? null },
  };
};

const openUserFromChat = (payload: { username: string; userId?: number | null; avatarUrl?: string | null }) => {
  openUserCard({ ...payload, source: channelSource(activeChannel.value) });
};

const closeUserCard = () => {
  userCard.value = null;
};

const userSpace = ref<null | { username: string; source: Source; userId?: number | null }>(null);
const openUserSpace = (username: string, source: Source = "discourse", userId?: number | null) => {
  const u = String(username || "").trim();
  if (!u) return;
  userSpace.value = { username: u, source, userId: userId ?? null };
};
const closeUserSpace = () => {
  userSpace.value = null;
};

const openTopic = (topicId: number) => {
  const p = posts.value.find((x) => x && x.id === topicId) ?? null;
  const isLegacy = !!p && (p.source === "discuz" || p.legacy?.source === "discuz" || topicId < 0);
  if (isLegacy) {
    const tid =
      typeof p?.legacy?.tid === "number" && Number.isFinite(p.legacy.tid)
        ? Math.abs(p.legacy.tid)
        : Math.abs(topicId);
    const fid =
      typeof p?.legacy?.fid === "number" && Number.isFinite(p.legacy.fid)
        ? Math.abs(p.legacy.fid)
        : null;
    openLegacyThread({ tid, fid, page: 1 });
    return;
  }
  topicModalId.value = topicId;
};

const closeTopic = () => {
  topicModalId.value = null;
  topicModalInitialPostNumber.value = null;
};

const settingsOpen = ref(false);
const openSettings = () => {
  settingsOpen.value = true;
};
const closeSettings = () => {
  settingsOpen.value = false;
};

const openNotificationsModal = async () => {
  notificationsOpen.value = true;
  await refreshNotifications();
};

const closeNotificationsModal = () => {
  notificationsOpen.value = false;
  notificationsError.value = null;
};

const newTopicOpen = ref(false);
const legacyInitialGidForNewThread = (categoryId: number | null) => {
  if (categoryId == null) return null;
  const id = Number(categoryId);
  if (!Number.isFinite(id) || id >= 0) return null;
  if (legacyIsGroupCategoryId(id)) return Math.abs(id);
  const fid = legacyFidFromCategoryId(id);
  if (!fid) return null;
  return legacyGidByFid.value.get(fid) ?? null;
};
const openNewTopic = () => {
  if (siteMode.value === "old") {
    void openLegacyNewThread(legacyInitialGidForNewThread(selectedCategoryId.value));
    return;
  }
  if (siteMode.value === "both") {
    const id = selectedCategoryId.value;
    if (id != null && id < 0) {
      void openLegacyNewThread(legacyInitialGidForNewThread(id));
      return;
    }
    if (id != null && id > 0) {
      newTopicOpen.value = true;
      return;
    }
    postTargetOpen.value = true;
    return;
  }
  newTopicOpen.value = true;
};
const closeNewTopic = () => {
  newTopicOpen.value = false;
};
const onNewTopicPosted = async () => {
  newTopicOpen.value = false;
  await refreshAll();
};

const postTargetOpen = ref(false);
const closePostTarget = () => {
  postTargetOpen.value = false;
};
const onPostTarget = (target: "new" | "old") => {
  postTargetOpen.value = false;
  if (target === "new") {
    newTopicOpen.value = true;
    return;
  }
  void openLegacyNewThread(null);
};

const legacyNewThreadOpen = ref(false);
const legacyNewThreadInitialGid = ref<number | null>(null);
const closeLegacyNewThread = () => {
  legacyNewThreadOpen.value = false;
  legacyNewThreadInitialGid.value = null;
};
const openLegacyNewThread = async (gid: number | null) => {
  error.value = null;
  try {
    if (!legacyLoggedIn.value) throw new Error("请先登录旧版清水河畔（Discuz）。");
    if (legacyGroups.value.length === 0) {
      const tree = await window.riverside?.legacy.listForumTree?.();
      const groups = Array.isArray((tree as any)?.groups) ? ((tree as any).groups as LegacyGroup[]) : [];
      if (groups.length > 0) legacyGroups.value = groups;
    }
    legacyNewThreadInitialGid.value = gid != null ? Number(gid) : null;
    legacyNewThreadOpen.value = true;
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
};
const onLegacyNewThreadPosted = async (payload: { tid?: number | null; fid?: number | null; url?: string | null }) => {
  legacyNewThreadOpen.value = false;
  legacyNewThreadInitialGid.value = null;
  const tid = payload?.tid != null ? Number(payload.tid) : null;
  const fid = payload?.fid != null ? Number(payload.fid) : null;
  if (tid && Number.isFinite(tid) && tid > 0) {
    openLegacyThread({ tid, fid: fid && Number.isFinite(fid) && fid > 0 ? fid : null, page: 1 });
  }
  await refreshAll();
};

const onSectionChange = (next: Section) => {
  section.value = next;
  if (next !== "chat") setChatCollapsed(false);
};

const onSiteModeChange = (next: SiteMode) => {
  setSiteMode(next);
  void refreshAll();
};

const onTopicReplied = (topicId: number) => {
  posts.value = posts.value.map((p) =>
    p.id === topicId ? { ...p, replyCount: p.replyCount + 1 } : p
  );
};

let loginPollTimer: number | null = null;
let loginPollStopAt = 0;
let legacyLoginPollTimer: number | null = null;
let legacyLoginPollStopAt = 0;
let legacySessionInvalidStreak = 0;

const stopLoginPolling = () => {
  if (loginPollTimer == null) return;
  window.clearInterval(loginPollTimer);
  loginPollTimer = null;
  loginPollStopAt = 0;
};

const stopLegacyLoginPolling = () => {
  if (legacyLoginPollTimer == null) return;
  window.clearInterval(legacyLoginPollTimer);
  legacyLoginPollTimer = null;
  legacyLoginPollStopAt = 0;
};

const startLoginPolling = () => {
  if (loginPollTimer != null) return;
  loginPollStopAt = Date.now() + 3 * 60 * 1000;
  loginPollTimer = window.setInterval(async () => {
    try {
      if (loginPollStopAt && Date.now() > loginPollStopAt) {
        stopLoginPolling();
        return;
      }

      const sess = await window.riverside?.forum.getSession();
      if (sess?.loggedIn && sess.currentUser) {
        stopLoginPolling();
        await refreshAll();
      }
    } catch {
      // ignore
    }
  }, 3000);
};

const startLegacyLoginPolling = () => {
  if (legacyLoginPollTimer != null) return;
  legacyLoginPollStopAt = Date.now() + 5 * 60 * 1000;
  legacyLoginPollTimer = window.setInterval(async () => {
    try {
      if (!me.value) return;
      if (legacyLoginPollStopAt && Date.now() > legacyLoginPollStopAt) {
        stopLegacyLoginPolling();
        return;
      }
      const sess = await window.riverside?.legacy.getSession?.();
      if (sess?.loggedIn && sess.currentUser) {
        stopLegacyLoginPolling();
        legacyMe.value = tagUser(sess.currentUser as ForumUser, "discuz");
        legacySessionInvalidStreak = 0;
        legacySessionCheckedAt = Date.now();
        if (siteMode.value === "new") setSiteMode("both");
        await refreshAll();
      }
    } catch {
      // ignore
    }
  }, 2500);
};

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const stripHtmlToText = (html: string) => {
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

const decodeHtmlEntities = (s: string) =>
  String(s || "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const avatarUrlFromTemplate = (template?: string | null, size = 64) => {
  if (!template) return null;
  const path = template.replace("{size}", String(size));
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
};

type Source = "discourse" | "discuz";

const channelSource = (c: ChatChannel | null): Source => {
  const s = (c as any)?.source;
  if (s === "discuz" || s === "discourse") return s;
  if (c?.legacy?.source === "discuz") return "discuz";
  return c?.id != null && c.id < 0 ? "discuz" : "discourse";
};

const tagUser = (u: ForumUser | null, source: Source): ForumUser | null =>
  u ? ({ ...u, source } as ForumUser) : null;

const tagChannel = (c: ChatChannel, source: Source): ChatChannel => ({
  ...c,
  source,
  participants: Array.isArray(c.participants)
    ? c.participants.map((p) => (p ? ({ ...p, source } as ForumUser) : p)).filter(Boolean)
    : [],
});

const tagMessage = (m: ForumMessage, source: Source): ForumMessage => ({
  ...m,
  source,
});

const tagPost = (p: FeedPost, source: Source): FeedPost => ({
  ...p,
  source,
  author: p.author ? ({ ...p.author, source } as ForumUser) : null,
});

const mergePostsByKey = (current: FeedPost[], incoming: FeedPost[]) => {
  const byKey = new Map<string, FeedPost>();
  const keyOf = (p: FeedPost) => {
    const src = (p as any)?.source === "discuz" || (p as any)?.legacy?.source === "discuz" || p.id < 0 ? "discuz" : "discourse";
    return `${src}:${String(p.id)}`;
  };
  for (const p of current) byKey.set(keyOf(p), p);
  for (const p of incoming) {
    const k = keyOf(p);
    if (!byKey.has(k)) byKey.set(k, p);
  }
  return Array.from(byKey.values());
};

const tagNotification = (n: ForumNotification, source: Source): ForumNotification => ({
  ...n,
  source,
  legacy: n.legacy,
});

const mergeMessagesById = (current: ForumMessage[], incoming: ForumMessage[]) => {
  const byId = new Map<number, ForumMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) {
    const prev = byId.get(m.id);
    if (prev?.renderKey && !m.renderKey) {
      byId.set(m.id, { ...m, renderKey: prev.renderKey });
    } else {
      byId.set(m.id, m);
    }
  }

  const merged = Array.from(byId.values())
    .map((m) => ({
      ...m,
      renderKey:
        m.renderKey ||
        (Number.isInteger(m.id) ? `m:${String(m.id)}` : `o:${String(m.id)}`),
    }))
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  // Reconcile optimistic "localOnly" messages once the server version arrives.
  const serverMine = merged
    .filter((m) => Number.isInteger(m.id) && m.from === "me")
    .map((m) => ({
      id: m.id,
      t: Date.parse(m.createdAt) || 0,
      sig: (
        m.localSig ||
        buildMessageSignatureFromCooked(m.cooked, {
          hasUploads: Array.isArray(m.uploads) && m.uploads.length > 0,
        })
      ).trim(),
    }));

  const usedServer = new Set<number>();
  const localToServerKey = new Map<number, string>();
  const matchedLocalIds = new Set<number>();

  for (const m of merged) {
    if (!m.localOnly) continue;
    if (m.from !== "me") continue;
    if (Number.isInteger(m.id)) continue;

    const t = Date.parse(m.createdAt) || 0;
    const sig = (
      m.localSig ||
      buildMessageSignatureFromCooked(m.cooked, {
        hasUploads: Array.isArray(m.uploads) && m.uploads.length > 0,
      })
    ).trim();
    if (!sig) continue;

    const baseId =
      typeof m.localBaseId === "number" && Number.isInteger(m.localBaseId) ? m.localBaseId : null;

    const match = serverMine.find((s) => {
      if (usedServer.has(s.id)) return false;
      if (baseId != null && s.id <= baseId) return false;
      if (s.sig !== sig) return false;
      const dt = Math.abs((s.t || 0) - (t || 0));
      return dt < 45 * 1000;
    });
    if (!match) continue;

    usedServer.add(match.id);
    matchedLocalIds.add(m.id);
    localToServerKey.set(match.id, m.renderKey || `o:${String(m.id)}`);
  }

  return merged
    .filter((m) => !matchedLocalIds.has(m.id))
    .map((m) => {
      if (!Number.isInteger(m.id)) return m;
      const key = localToServerKey.get(m.id);
      if (!key) return m;
      return { ...m, renderKey: key, localOnly: false };
    });
};

const firstServerMessageId = (list: ForumMessage[]) => {
  for (let i = 0; i < list.length; i++) {
    const id = list[i]?.id;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) return id;
  }
  return null;
};

const lastServerMessageId = (list: ForumMessage[]) => {
  for (let i = list.length - 1; i >= 0; i--) {
    const id = list[i]?.id;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) return id;
  }
  return null;
};

const normalizeSig = (s: string) => String(s || "").replace(/\s+/g, " ").trim();

const buildMessageSignatureFromRaw = (raw: string, opts?: { hasUploads?: boolean }) => {
  const s = String(raw || "");
  const hasImage = /!\[[^\]]*]\(([^)]+)\)/.test(s) || !!opts?.hasUploads;
  const text = s.replaceAll(/!\[[^\]]*]\(([^)]+)\)/g, " ").replace(/\s+/g, " ").trim();
  return normalizeSig(`${text}${hasImage ? " [图片]" : ""}`);
};

const buildMessageSignatureFromCooked = (html: string, opts?: { hasUploads?: boolean }) => {
  let h = String(html || "");

  // Keep emoji text (Discourse can render emoji as <img class="emoji" alt="...">).
  const emojiImgRe = /<img\b[^>]*\bclass=(["'])[^"']*\bemoji\b[^"']*\1[^>]*>/gi;
  h = h.replace(emojiImgRe, (tag) => {
    const m = tag.match(/\balt=(["'])(.*?)\1/i);
    return m?.[2] ? decodeHtmlEntities(m[2]) : "";
  });

  const nonEmojiHtml = h.replaceAll(emojiImgRe, " ");
  const hasImage = /<img\b/i.test(nonEmojiHtml) || !!opts?.hasUploads;
  // Remove non-emoji images from text signature (but keep a marker).
  h = h.replace(/<img\b[^>]*>/gi, " ");

  const text = stripHtmlToText(h);
  return normalizeSig(`${text}${hasImage ? " [图片]" : ""}`);
};

const escapeAttr = (s: string) =>
  String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const cookOptimisticMessage = (raw: string) => {
  const chunks = String(raw || "")
    .split(/\n{2,}/g)
    .map((c) => c.trim())
    .filter(Boolean);

  const urlRe = /\bhttps?:\/\/[^\s<]+/gi;

  const renderTextChunk = (chunk: string) => {
    const escaped = escapeHtml(chunk);
    const withLinks = escaped.replace(urlRe, (m) => {
      const href = escapeAttr(m);
      return `<a href="${href}">${m}</a>`;
    });
    return `<p>${withLinks.replaceAll("\n", "<br>")}</p>`;
  };

  const parts: string[] = [];
  for (const c of chunks) {
    const m = c.match(/^!\[[^\]]*]\(([^)]+)\)$/);
    if (m && m[1]) {
      const href = escapeAttr(m[1]);
      parts.push(`<p><a class="lightbox" href="${href}"><img src="${href}" alt="image" /></a></p>`);
      continue;
    }
    parts.push(renderTextChunk(c));
  }
  return parts.join("");
};

let optimisticSeq = 0;
const nextOptimisticId = () => {
  optimisticSeq = (optimisticSeq + 1) % 1_000_000;
  const base = lastServerMessageId(messages.value) ?? 0;
  return base + optimisticSeq / 1_000_000;
};

const sortChannelsByRecent = (list: ChatChannel[]) =>
  [...list].sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return tb - ta;
  });

const legacyTouidFromChannel = (c: ChatChannel | null) => {
  if (!c) return null;
  if (channelSource(c) !== "discuz") return null;
  const n = Number((c as any)?.legacy?.touid ?? Math.abs(Number(c.id)));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.abs(n);
};

const markLegacyPmRead = (c: ChatChannel | null, fallbackIso?: string | null) => {
  const touid = legacyTouidFromChannel(c);
  if (!touid) return;
  const baseTs = c?.lastMessageAt ? Date.parse(c.lastMessageAt) || 0 : 0;
  const fallbackTs = fallbackIso ? Date.parse(fallbackIso) || 0 : 0;
  const ts = Math.max(baseTs, fallbackTs) || Date.now();
  const prev = legacyPmReadMap.value.get(touid) || 0;
  if (ts <= prev) return;
  legacyPmReadMap.value.set(touid, ts);
  saveLegacyPmReadMap();
};

const applyLegacyPmReadState = (list: ChatChannel[]) =>
  list.map((c) => {
    if (channelSource(c) !== "discuz") return c;
    const touid = legacyTouidFromChannel(c);
    if (!touid) return c;
    const seenTs = legacyPmReadMap.value.get(touid) || 0;
    const lastTs = c.lastMessageAt ? Date.parse(c.lastMessageAt) || 0 : 0;
    if (lastTs <= 0) return { ...c, unread: 0 };
    const unread = lastTs > seenTs ? 1 : 0;
    if (Number(c.unread || 0) === unread) return c;
    return { ...c, unread };
  });

const bootstrapLegacyPmReadIfNeeded = (legacyList: ChatChannel[]) => {
  if (legacyList.length === 0) return;
  if (legacyPmReadMap.value.size > 0) {
    if (!legacyPmReadBootstrapped.value) setLegacyPmReadBootstrapped(true);
    return;
  }
  for (const c of legacyList) markLegacyPmRead(c, c.lastMessageAt || null);
  setLegacyPmReadBootstrapped(true);
};

let channelsPollTimer: number | null = null;
let messagesPollTimer: number | null = null;
let notificationsPollTimer: number | null = null;
let channelsPollBusy = false;
let messagesPollBusy = false;
let notificationsPollBusy = false;
let rateLimitedUntil = 0;
const lastMarkedReadByChannel = new Map<number, number>();

const isRateLimitError = (e: any) => {
  const msg = String(e?.message || e || "");
  return (
    msg.includes("HTTP 429") ||
    msg.includes("Slow down") ||
    msg.includes("user_60_secs_limit")
  );
};

const backoffOnRateLimit = (ms = 6_000) => {
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + ms);
};

const stopRealtimePolling = () => {
  if (channelsPollTimer != null) window.clearInterval(channelsPollTimer);
  if (messagesPollTimer != null) window.clearInterval(messagesPollTimer);
  if (notificationsPollTimer != null) window.clearInterval(notificationsPollTimer);
  channelsPollTimer = null;
  messagesPollTimer = null;
  notificationsPollTimer = null;
  channelsPollBusy = false;
  messagesPollBusy = false;
  notificationsPollBusy = false;
  rateLimitedUntil = 0;
  lastMarkedReadByChannel.clear();
};

const pollChannelsOnce = async () => {
  if (!me.value) return;
  if (channelsPollBusy) return;
  if (Date.now() < rateLimitedUntil) return;
  channelsPollBusy = true;

  try {
    const existingLegacy = channels.value.filter((c) => channelSource(c) === "discuz");
    const existingDiscourse = channels.value.filter((c) => channelSource(c) === "discourse");

    let discoursePart: ChatChannel[] = useDiscourse.value ? existingDiscourse : [];
    if (useDiscourse.value) {
      try {
        const res = await window.riverside?.forum.listChatChannels();
        if (res?.loggedIn) {
          const next = Array.isArray((res as any)?.channels) ? ((res as any).channels as ChatChannel[]) : [];
          discoursePart = next.map((c) => tagChannel(c, "discourse"));
        }
      } catch (e: any) {
        if (isRateLimitError(e)) backoffOnRateLimit();
        // keep existing discoursePart
      }
    }

    let legacyPart: ChatChannel[] = useLegacy.value && legacyLoggedIn.value ? existingLegacy : [];
    if (useLegacy.value && legacyLoggedIn.value) {
      try {
        const res = await window.riverside?.legacy.listPmThreads?.();
        if ((res as any)?.loggedIn) {
          const next = Array.isArray((res as any)?.threads) ? ((res as any).threads as ChatChannel[]) : [];
          legacyPart = next.map((c) => tagChannel(c, "discuz"));
          bootstrapLegacyPmReadIfNeeded(legacyPart);
          legacyPart = applyLegacyPmReadState(legacyPart);
        }
      } catch {
        // keep existing legacyPart
      }
    } else {
      legacyPart = [];
    }

    const combined = sortChannelsByRecent([...discoursePart, ...applyLegacyPmReadState(legacyPart)]);
    const shouldOverrideUnread = section.value === "chat" && !chatCollapsed.value;
    const sid = selectedChannelId.value;
    channels.value =
      shouldOverrideUnread && sid != null
        ? combined.map((c) => (c.id === sid ? { ...c, unread: 0 } : c))
        : combined;
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
    // ignore (network jitter / rate limit)
  } finally {
    channelsPollBusy = false;
  }
};

const pollActiveMessagesOnce = async (opts?: { forceFull?: boolean }) => {
  if (!me.value) return;
  if (messagesPollBusy) return;
  const channelId = selectedChannelId.value;
  if (channelId == null) return;
  if (!opts?.forceFull && (section.value !== "chat" || chatCollapsed.value)) return;
  if (Date.now() < rateLimitedUntil) return;

  const chan = channels.value.find((c) => c.id === channelId) ?? null;
  if (!chan) return;
  const src = channelSource(chan);

  messagesPollBusy = true;
  try {
    if (src === "discuz") {
      if (!legacyLoggedIn.value) return;
      const touidRaw = (chan as any)?.legacy?.touid;
      const plidRaw = (chan as any)?.legacy?.plid;
      const touid = touidRaw != null ? Math.abs(Number(touidRaw)) : Math.abs(Number(channelId));
      const plid = plidRaw != null ? Math.abs(Number(plidRaw)) : null;
      if (!Number.isFinite(touid) || touid <= 0) return;

      const currentLastId = lastServerMessageId(messages.value);
      const res = await window.riverside?.legacy.getPmMessages?.({
        touid,
        plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : undefined,
      });
      if (!(res as any)?.loggedIn) return;

      const incomingRaw = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : [];
      const incoming = incomingRaw.map((m) => tagMessage(m, "discuz"));
      const incomingLastId = incoming.length > 0 ? incoming[incoming.length - 1].id : null;
      const hasNew = incomingLastId != null && (currentLastId == null || incomingLastId > currentLastId);
      const shouldUpdate = !!opts?.forceFull || hasNew;

      if (shouldUpdate && incoming.length > 0) {
        messages.value = mergeMessagesById(messages.value, incoming);
        const last = messages.value[messages.value.length - 1] || null;
        if (last) {
          const preview = stripHtmlToText(last.cooked).slice(0, 80);
          channels.value = sortChannelsByRecent(
            channels.value.map((c) =>
              c.id === channelId
                ? {
                    ...c,
                    lastMessageAt: last.createdAt || c.lastMessageAt,
                    lastMessagePreview: preview || c.lastMessagePreview,
                  }
                : c
            )
          );
        }
      }

      const shouldMarkRead = section.value === "chat" && !chatCollapsed.value;
      if (shouldMarkRead) {
        channels.value = channels.value.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c));
        const active = channels.value.find((c) => c.id === channelId) ?? chan;
        markLegacyPmRead(active, incomingLastId != null ? incoming[incoming.length - 1]?.createdAt : null);
      }

      return;
    }

    const currentLastId = lastServerMessageId(messages.value);
    const res = await window.riverside?.forum.getChatMessages(channelId, { pageSize: 50 });
    if (!res?.loggedIn) return;

    const incomingRaw = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : [];
    const incoming = incomingRaw.map((m) => tagMessage(m, "discourse"));
    const incomingLastId = incoming.length > 0 ? incoming[incoming.length - 1].id : null;
    const hasNew = incomingLastId != null && (currentLastId == null || incomingLastId > currentLastId);
    const shouldUpdate = !!opts?.forceFull || hasNew;

    if (shouldUpdate && incoming.length > 0) {
      messages.value = mergeMessagesById(messages.value, incoming);

      const last = messages.value[messages.value.length - 1] || null;
      if (last) {
        const preview = stripHtmlToText(last.cooked).slice(0, 80);
        channels.value = sortChannelsByRecent(
          channels.value.map((c) =>
            c.id === channelId
              ? {
                  ...c,
                  lastMessageAt: last.createdAt || c.lastMessageAt,
                  lastMessagePreview: preview || c.lastMessagePreview,
                }
              : c
          )
        );
      }
    }

    const shouldMarkRead = section.value === "chat" && !chatCollapsed.value;
    if (shouldMarkRead) {
      const lastNow = shouldUpdate ? lastServerMessageId(messages.value) : null;
      const prev = lastMarkedReadByChannel.get(channelId) ?? 0;
      if (lastNow != null && lastNow > prev) {
        window.riverside?.forum
          .markChatChannelRead?.(channelId, lastNow)
          .then(() => lastMarkedReadByChannel.set(channelId, lastNow))
          .catch((e: any) => {
            if (isRateLimitError(e)) backoffOnRateLimit();
          });
      }
      channels.value = channels.value.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c));
    }
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
    // ignore
  } finally {
    messagesPollBusy = false;
  }
};

const refreshNotifications = async (opts?: { silent?: boolean }) => {
  if (!me.value) return;
  if (notificationsPollBusy) return;
  if (Date.now() < rateLimitedUntil) return;
  notificationsPollBusy = true;

  if (!opts?.silent) {
    notificationsLoading.value = true;
    notificationsError.value = null;
  }

  try {
    const wantDiscourse = useDiscourse.value;
    const wantLegacy = useLegacy.value && legacyLoggedIn.value;

    const [a, b] = await Promise.all([
      wantDiscourse
        ? window.riverside?.forum.listNotifications?.({
            limit: 60,
            unreadOnly: false,
            kinds: ["mention", "reply"],
          })
        : Promise.resolve(null),
      wantLegacy
        ? window.riverside?.legacy.listNotifications?.({
            limit: 60,
            kinds: ["mention", "reply"],
          })
        : Promise.resolve(null),
    ]);

    const listA = Array.isArray((a as any)?.notifications) ? ((a as any).notifications as ForumNotification[]) : [];
    const listB = Array.isArray((b as any)?.notifications) ? ((b as any).notifications as ForumNotification[]) : [];

    const taggedA = wantDiscourse ? listA.map((n) => tagNotification(n, "discourse")) : [];
    const taggedB = wantLegacy
      ? listB.map((n) => {
          const id = typeof n?.id === "number" ? n.id : 0;
          const read = legacyNoticeRead.value.has(Math.abs(id));
          return tagNotification({ ...n, read }, "discuz");
        })
      : [];

    const merged = [...taggedA, ...taggedB]
      .filter((n) => n && typeof n.id === "number")
      .sort((x, y) => (Date.parse(y.createdAt) || 0) - (Date.parse(x.createdAt) || 0))
      .slice(0, 80);

    notifications.value = merged;
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
    if (!opts?.silent) notificationsError.value = String(e?.message || e);
  } finally {
    notificationsPollBusy = false;
    if (!opts?.silent) notificationsLoading.value = false;
  }
};

const startRealtimePolling = () => {
  if (channelsPollTimer != null || messagesPollTimer != null) return;

  channelsPollTimer = window.setInterval(() => void pollChannelsOnce(), 12000);
  messagesPollTimer = window.setInterval(() => void pollActiveMessagesOnce(), 3000);
  notificationsPollTimer = window.setInterval(() => void refreshNotifications({ silent: true }), 12000);
  void refreshNotifications({ silent: true });
};

const refreshAll = async () => {
  error.value = null;
  loading.value = true;
  try {
    const sess = await window.riverside?.forum.getSession();
    if (!sess?.loggedIn || !sess.currentUser) {
      // Avoid logging out on transient network errors.
      if ((sess as any)?.error && me.value) {
        error.value = "网络异常：已保留当前登录状态，稍后会自动恢复。";
        return;
      }

      stopLoginPolling();
      stopLegacyLoginPolling();
      stopRealtimePolling();

      me.value = null;
      legacyMe.value = null;
      legacyGroups.value = [];
      legacyPmCursor.value = null;

      channels.value = [];
      posts.value = [];
      messages.value = [];
      notifications.value = [];
      notificationsOpen.value = false;
      notificationsError.value = null;
      userCard.value = null;
      userSpace.value = null;
      selectedChannelId.value = null;
      selectedCategoryId.value = null;
      lastMarkedReadByChannel.clear();
      window.riverside?.window.setCollapsed?.(false).catch(() => {});
      return;
    }

    me.value = sess.currentUser;
    stopLoginPolling();

    // Legacy login status is optional. Avoid flipping to "logged out" on transient network errors.
    if (useLegacy.value) {
      const shouldCheckLegacy = Date.now() - legacySessionCheckedAt > 45_000 || !legacyMe.value;
      if (shouldCheckLegacy) {
        legacySessionCheckedAt = Date.now();
        try {
          const ls = await window.riverside?.legacy.getSession?.();
          if (ls?.loggedIn && ls.currentUser) {
            legacyMe.value = tagUser(ls.currentUser as ForumUser, "discuz");
            legacySessionInvalidStreak = 0;
          } else if (!ls?.loggedIn && (ls as any)?.error && legacyMe.value) {
            // keep previous legacyMe
            legacySessionInvalidStreak = 0;
          } else {
            legacySessionInvalidStreak++;
            if (legacySessionInvalidStreak >= 2) legacyMe.value = null;
          }
        } catch {
          // keep previous legacyMe
        }
      }
    } else {
      // Keep legacy session cached even when not actively browsing legacy.
      legacySessionInvalidStreak = 0;
    }

    const existingLegacyChannels = channels.value.filter((c) => channelSource(c) === "discuz");
    const existingDiscourseChannels = channels.value.filter((c) => channelSource(c) === "discourse");

    let discourseChannels: ChatChannel[] = useDiscourse.value ? existingDiscourseChannels : [];
    if (useDiscourse.value) {
      try {
        const chatRes = await window.riverside?.forum.listChatChannels();
        const next = Array.isArray((chatRes as any)?.channels)
          ? ((chatRes as any).channels as ChatChannel[])
          : [];
        if (next.length > 0) discourseChannels = next.map((c) => tagChannel(c, "discourse"));
      } catch (e: any) {
        if (isRateLimitError(e)) backoffOnRateLimit();
        // keep existing discourse channels
      }
    }

    let legacyChannels: ChatChannel[] =
      useLegacy.value && legacyLoggedIn.value ? existingLegacyChannels : [];
    if (useLegacy.value && legacyLoggedIn.value) {
      try {
        const pmRes = await window.riverside?.legacy.listPmThreads?.();
        const next = Array.isArray((pmRes as any)?.threads) ? ((pmRes as any).threads as ChatChannel[]) : [];
        if (next.length > 0) {
          legacyChannels = next.map((c) => tagChannel(c, "discuz"));
          bootstrapLegacyPmReadIfNeeded(legacyChannels);
          legacyChannels = applyLegacyPmReadState(legacyChannels);
        }
      } catch {
        // keep existing legacy channels
      }
    } else {
      legacyChannels = [];
    }

    channels.value = sortChannelsByRecent([...discourseChannels, ...applyLegacyPmReadState(legacyChannels)]);

    if (useLegacy.value && legacyLoggedIn.value && legacyGroups.value.length === 0) {
      try {
        const tree = await window.riverside?.legacy.listForumTree?.();
        const groups = Array.isArray((tree as any)?.groups) ? ((tree as any).groups as LegacyGroup[]) : [];
        if (groups.length > 0) legacyGroups.value = groups;
      } catch {
        // ignore
      }
    }

    try {
      await refreshNotifications({ silent: true });
    } catch {
      // ignore
    }

    const hasDiscoursePosts = posts.value.some((p) => (p as any)?.source === "discourse");
    const hasLegacyPosts = posts.value.some((p) => (p as any)?.source === "discuz");

    const shouldRefreshDiscover =
      section.value === "discover" ||
      posts.value.length === 0 ||
      (useDiscourse.value && categories.value.length === 0) ||
      (useDiscourse.value && !hasDiscoursePosts) ||
      (useLegacy.value && legacyLoggedIn.value && !hasLegacyPosts);

    if (shouldRefreshDiscover) {
      try {
        const nextPosts: FeedPost[] = [];

        if (useDiscourse.value) {
          const latestRes = await window.riverside?.forum.listLatest();
          const discoursePosts = Array.isArray((latestRes as any)?.posts)
            ? ((latestRes as any).posts as FeedPost[]).map((p) => tagPost(p, "discourse"))
            : [];
          nextPosts.push(...discoursePosts);

          categories.value = Array.isArray((latestRes as any)?.categories)
            ? ((latestRes as any).categories as BrowseCategory[])
            : categories.value;
        }

        if (useLegacy.value && legacyLoggedIn.value) {
          const legacyRes = await window.riverside?.legacy.listLatest?.({ view: "newthread", page: 1 });
          const legacyPosts = Array.isArray((legacyRes as any)?.threads)
            ? ((legacyRes as any).threads as FeedPost[]).map((p) => tagPost(p, "discuz"))
            : [];
          nextPosts.push(...legacyPosts);
        }

        if (nextPosts.length > 0) posts.value = nextPosts;
      } catch (e: any) {
        if (isRateLimitError(e)) backoffOnRateLimit();
        // ignore (rate limit). Keep existing cached discover data.
      }
    }

    if (section.value === "discover" && selectedCategoryId.value != null) {
      const cat = activeCategory.value;
      if (cat) {
        try {
          if (cat.id < 0) {
            if (!useLegacy.value || !legacyLoggedIn.value) throw new Error("legacy not available");

            const gid = Math.abs(cat.id);
            const g = legacyGroups.value.find((x) => Number(x?.gid) === gid) || null;
            if (!g) throw new Error("legacy group not loaded");

            const fids = Array.isArray(g.forums) ? g.forums.map((f) => Number(f?.fid)).filter((n) => n > 0) : [];
            const all: FeedPost[] = [];
            let cursor = 0;
            const workerCount = Math.max(1, Math.min(4, fids.length));
            const workers = Array.from({ length: workerCount }, async () => {
              while (cursor < fids.length) {
                const fid = fids[cursor++];
                try {
                  const res = await window.riverside?.legacy.listForumThreads?.({ fid, page: 1 });
                  const list = Array.isArray((res as any)?.threads) ? ((res as any).threads as FeedPost[]) : [];
                  for (const p of list) all.push(tagPost(p, "discuz"));
                } catch {
                  // ignore per-forum errors
                }
              }
            });
            await Promise.all(workers);

            posts.value = all
              .sort((a, b) => (Date.parse(b.lastPostedAt || b.createdAt) || 0) - (Date.parse(a.lastPostedAt || a.createdAt) || 0))
              .slice(0, 120);
          } else if (useDiscourse.value) {
            const res = await window.riverside?.forum.listCategoryTopics(cat.id, cat.slug);
            const list = Array.isArray((res as any)?.posts) ? ((res as any).posts as FeedPost[]) : [];
            posts.value = list.map((p) => tagPost(p, "discourse"));
          }
        } catch (e: any) {
          if (isRateLimitError(e)) backoffOnRateLimit();
          // ignore (rate limit / transient)
        }
      } else {
        selectedCategoryId.value = null;
      }
    }

    const hasSelected =
      selectedChannelId.value != null &&
      channels.value.some((c) => c.id === selectedChannelId.value);

    if (!hasSelected && channels.value.length === 0) {
      selectedChannelId.value = null;
    }

    if ((!hasSelected || selectedChannelId.value == null) && channels.value.length > 0) {
      const preferredNames = new Set(["校友广场", "二手交流"]);
      const preferred =
        channels.value.find((c) => c.kind === "public" && preferredNames.has(c.title)) || null;
      selectedChannelId.value = preferred?.id ?? channels.value[0].id;
    }

    if (selectedChannelId.value != null) {
      const cid = selectedChannelId.value;
      const chan = channels.value.find((c) => c.id === cid) ?? null;
      const src = channelSource(chan);

      if (src === "discuz") {
        if (!legacyLoggedIn.value) {
          messages.value = [];
        } else {
          try {
            const touidRaw = (chan as any)?.legacy?.touid;
            const plidRaw = (chan as any)?.legacy?.plid;
            const touid = touidRaw != null ? Math.abs(Number(touidRaw)) : Math.abs(Number(cid));
            const plid = plidRaw != null ? Math.abs(Number(plidRaw)) : null;
            const res = await window.riverside?.legacy.getPmMessages?.({
              touid,
              plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : undefined,
            });
            const incoming = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : [];
            if (incoming.length > 0) messages.value = incoming.map((m) => tagMessage(m, "discuz"));

            const prevRaw = (res as any)?.prevPage;
            const prev = prevRaw != null ? Number(prevRaw) : null;
            legacyPmCursor.value = {
              touid,
              plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : null,
              prevPage: prev != null && Number.isFinite(prev) && prev > 0 ? prev : null,
            };
            chatHasMoreHistory.value = !!legacyPmCursor.value.prevPage;

            channels.value = channels.value.map((c) => (c.id === cid ? { ...c, unread: 0 } : c));
            const activeLegacy = channels.value.find((c) => c.id === cid) ?? chan;
            markLegacyPmRead(activeLegacy, incoming[incoming.length - 1]?.createdAt || null);
          } catch {
            // ignore
          }
        }
      } else {
        try {
          const res = await window.riverside?.forum.getChatMessages(cid, { pageSize: 50 });
          const incoming = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : null;
          if (incoming) messages.value = incoming.map((m) => tagMessage(m, "discourse"));

          channels.value = channels.value.map((c) => (c.id === cid ? { ...c, unread: 0 } : c));
          const lastId = lastServerMessageId(messages.value);
          if (lastId != null) {
            window.riverside?.forum
              .markChatChannelRead?.(cid, lastId)
              .then(() => lastMarkedReadByChannel.set(cid, lastId))
              .catch((e: any) => {
                if (isRateLimitError(e)) backoffOnRateLimit();
              });
          }
        } catch (e: any) {
          if (isRateLimitError(e)) backoffOnRateLimit();
          // ignore
        }
      }
    }

    if (section.value === "chat") {
      window.riverside?.window.setCollapsed?.(chatCollapsed.value).catch(() => {});
    }
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

const openLogin = async () => {
  error.value = null;
  loading.value = true;
  try {
    await window.riverside?.forum.openLogin();
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }

  await refreshAll();
  if (!me.value) startLoginPolling();
};

const openLegacyLogin = async () => {
  error.value = null;
  loading.value = true;
  try {
    await window.riverside?.legacy.openLogin?.();
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
  await refreshAll();
  if (!legacyLoggedIn.value) startLegacyLoginPolling();
};

const doLogout = async () => {
  error.value = null;
  loading.value = true;
  try {
    await window.riverside?.forum.logout();
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
  stopLoginPolling();
  stopLegacyLoginPolling();
  stopRealtimePolling();
  await refreshAll();
};

const selectChannel = async (id: number) => {
  selectedChannelId.value = id;
  section.value = "chat";
  setChatCollapsed(false);

  const chan = channels.value.find((c) => c.id === id) ?? null;
  const src = channelSource(chan);

  error.value = null;
  try {
    if (src === "discuz") {
      if (!legacyLoggedIn.value) throw new Error("请先登录旧版清水河畔（Discuz）");

      const touidRaw = (chan as any)?.legacy?.touid;
      const plidRaw = (chan as any)?.legacy?.plid;
      const touid = touidRaw != null ? Math.abs(Number(touidRaw)) : Math.abs(Number(id));
      const plid = plidRaw != null ? Math.abs(Number(plidRaw)) : null;
      if (!Number.isFinite(touid) || touid <= 0) throw new Error("touid is required");

      const res = await window.riverside?.legacy.getPmMessages?.({
        touid,
        plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : undefined,
      });
      if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");
      const incoming = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : [];
      messages.value = incoming.map((m) => tagMessage(m, "discuz"));

      const prevRaw = (res as any)?.prevPage;
      const prev = prevRaw != null ? Number(prevRaw) : null;
      legacyPmCursor.value = {
        touid,
        plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : null,
        prevPage: prev != null && Number.isFinite(prev) && prev > 0 ? prev : null,
      };
      chatHasMoreHistory.value = !!legacyPmCursor.value.prevPage;

      channels.value = channels.value.map((c) => (c.id === id ? { ...c, unread: 0 } : c));
      const activeLegacy = channels.value.find((c) => c.id === id) ?? chan;
      markLegacyPmRead(activeLegacy, incoming[incoming.length - 1]?.createdAt || null);
      return;
    }

    legacyPmCursor.value = null;

    const res = await window.riverside?.forum.getChatMessages(id, { pageSize: 50 });
    const incoming = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : [];
    messages.value = incoming.map((m) => tagMessage(m, "discourse"));

    channels.value = channels.value.map((c) => (c.id === id ? { ...c, unread: 0 } : c));
    const lastId = lastServerMessageId(messages.value);
    if (lastId != null) {
      window.riverside?.forum
        .markChatChannelRead?.(id, lastId)
        .then(() => lastMarkedReadByChannel.set(id, lastId))
        .catch((e: any) => {
          if (isRateLimitError(e)) backoffOnRateLimit();
        });
    }
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
    error.value = isRateLimitError(e) ? "操作过于频繁，请稍后再试。" : String(e?.message || e);
    messages.value = [];
  }
};

const startChatWithUser = async (
  payload: string | { username: string; userId?: number | null; source?: Source }
) => {
  const username = typeof payload === "string" ? payload : payload?.username;
  const u = String(username || "").trim();
  if (!u) return;

  const source: Source =
    typeof payload === "object" && payload?.source === "discuz" ? "discuz" : "discourse";
  const userIdRaw = typeof payload === "object" ? payload?.userId : null;
  const userId = userIdRaw != null ? Number(userIdRaw) : null;

  error.value = null;
  try {
    if (source === "discuz") {
      if (!legacyLoggedIn.value) throw new Error("请先登录旧版清水河畔（Discuz）");

      let touid = userId != null && Number.isFinite(userId) && userId > 0 ? userId : null;
      let resolvedUser: ForumUser | null = null;

      if (!touid) {
        try {
          const sr = await window.riverside?.legacy.searchUsers?.({ term: u, limit: 1 });
          const list = Array.isArray((sr as any)?.users) ? ((sr as any).users as ForumUser[]) : [];
          const first = list[0] || null;
          const nid = first?.id != null ? Number(first.id) : null;
          if (nid && Number.isFinite(nid) && nid > 0) {
            touid = nid;
            resolvedUser = first;
          }
        } catch {
          // ignore
        }
      }

      if (!touid) throw new Error("无法找到该用户（旧版）");

      const channelId = -Math.abs(touid);
      const exists = channels.value.some((c) => c.id === channelId);
      if (!exists) {
        const avatarUrl =
          resolvedUser?.avatarUrl ||
          `https://bbs.uestc.edu.cn/uc_server/avatar.php?uid=${touid}&size=small`;
        const title = resolvedUser?.name || resolvedUser?.username || u;

        const newChan: ChatChannel = {
          id: channelId,
          kind: "dm",
          title,
          description: "旧版私信",
          participants: [
            tagUser(
              {
                id: touid,
                username: resolvedUser?.username || String(touid),
                name: title,
                avatarUrl,
              } as ForumUser,
              "discuz"
            )!,
          ],
          avatarUrl,
          lastMessageAt: null,
          lastMessagePreview: "",
          unread: 0,
          isGroup: false,
          url: `${LEGACY_BASE_URL}/home.php?mod=space&do=pm&subop=view&touid=${touid}#last`,
          source: "discuz",
          legacy: { source: "discuz", touid },
        };
        channels.value = sortChannelsByRecent([...channels.value, newChan]);
      }

      await selectChannel(channelId);
      userCard.value = null;
      userSpace.value = null;
      return;
    }

    const res = await window.riverside?.forum.ensureDmWith?.({
      username: u,
      userId: userId != null && Number.isFinite(userId) && userId > 0 ? userId : undefined,
    });
    const rawId = (res as any)?.channelId;

    if (Array.isArray((res as any)?.channels)) {
      const next = ((res as any).channels as ChatChannel[]).map((c) => tagChannel(c, "discourse"));
      const legacyPart = channels.value.filter((c) => channelSource(c) === "discuz");
      channels.value = sortChannelsByRecent([...next, ...legacyPart]);
    }

    const channelId = typeof rawId === "number" ? rawId : Number(rawId);
    if (!Number.isFinite(channelId) || channelId <= 0) {
      throw new Error(
        (res as any)?.reason ||
          "无法创建或找到私聊会话（站点可能未开启聊天私聊，或对方不允许，或你没有权限）"
      );
    }
    await selectChannel(channelId);
    userCard.value = null;
    userSpace.value = null;
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
};

const openUserProfile = async (
  payload:
    | string
    | { username: string; source?: Source; userId?: number | null }
) => {
  const username = typeof payload === "string" ? payload : payload?.username;
  const source: Source =
    typeof payload === "object" && payload?.source === "discuz" ? "discuz" : "discourse";
  const userId =
    typeof payload === "object" && payload?.userId != null
      ? Number(payload.userId)
      : null;
  openUserSpace(
    username,
    source,
    typeof userId === "number" && Number.isFinite(userId) && userId > 0 ? userId : null
  );
  userCard.value = null;
};

const openTopicFromSeed = (post: FeedPost) => {
  if (!post?.id) return;
  if (post.source === "discuz" || post.legacy?.source === "discuz" || post.id < 0) {
    const tid = Number(post.legacy?.tid ?? Math.abs(post.id));
    if (Number.isFinite(tid) && tid > 0) {
      const fidRaw = post.legacy?.fid != null ? Number(post.legacy.fid) : null;
      openLegacyThread({
        tid,
        fid: fidRaw != null && Number.isFinite(fidRaw) && fidRaw > 0 ? fidRaw : null,
        page: 1,
      });
    }
    return;
  }
  const exists = posts.value.some((p) => p.id === post.id);
  if (!exists) posts.value = [post, ...posts.value];
  topicModalId.value = post.id;
};

const selectCategory = async (id: number | null) => {
  selectedCategoryId.value = id;
  section.value = "discover";
  setChatCollapsed(false);

  discoverGeneration.value += 1;
  discoverLoadingMore.value = false;
  discoverPageDiscourse.value = 1;
  discoverPageLegacy.value = 1;
  discoverHasMoreDiscourse.value = true;
  discoverHasMoreLegacy.value = true;
  discoverContext.value = { type: "all" };

  error.value = null;
  loading.value = true;
  try {
    if (id == null) {
      const wantDiscourse = useDiscourse.value;
      const wantLegacy = useLegacy.value && legacyLoggedIn.value;

      const [a, b] = await Promise.all([
        wantDiscourse ? window.riverside?.forum.listLatest?.() : Promise.resolve(null),
        wantLegacy ? window.riverside?.legacy.listLatest?.({ view: "newthread", page: 1 }) : Promise.resolve(null),
      ]);

      const nextPosts: FeedPost[] = [];

      const discoursePosts = Array.isArray((a as any)?.posts) ? ((a as any).posts as FeedPost[]) : [];
      const legacyPosts = Array.isArray((b as any)?.threads) ? ((b as any).threads as FeedPost[]) : [];

      if (wantDiscourse) nextPosts.push(...discoursePosts.map((p) => tagPost(p, "discourse")));
      if (wantLegacy) nextPosts.push(...legacyPosts.map((p) => tagPost(p, "discuz")));

      posts.value = nextPosts;
      if (useLegacy.value && !legacyLoggedIn.value && !wantDiscourse) {
        error.value = "请先登录旧版清水河畔（Discuz）";
      }
      if (wantDiscourse) {
        categories.value = Array.isArray((a as any)?.categories)
          ? ((a as any).categories as BrowseCategory[])
          : categories.value;
      }

      discoverContext.value = { type: "all" };
      discoverHasMoreDiscourse.value = wantDiscourse;
      discoverHasMoreLegacy.value = wantLegacy;
      return;
    }

    if (id < 0) {
      if (!useLegacy.value || !legacyLoggedIn.value) throw new Error("请先登录旧版清水河畔（Discuz）");
      if (legacyIsForumCategoryId(id)) {
        const fid = legacyFidFromCategoryId(id);
        if (!fid) throw new Error("fid is required");
        const res = await window.riverside?.legacy.listForumThreads?.({ fid, page: 1 });
        const list = Array.isArray((res as any)?.threads) ? ((res as any).threads as FeedPost[]) : [];
        posts.value = list.map((p) => tagPost(p, "discuz"));
        discoverContext.value = { type: "legacy-forum", fid };
        discoverHasMoreDiscourse.value = false;
        discoverHasMoreLegacy.value = true;
        return;
      }

      const gid = Math.abs(id);

      if (legacyGroups.value.length === 0) {
        try {
          const tree = await window.riverside?.legacy.listForumTree?.();
          const groups = Array.isArray((tree as any)?.groups) ? ((tree as any).groups as LegacyGroup[]) : [];
          if (groups.length > 0) legacyGroups.value = groups;
        } catch {
          // ignore
        }
      }

      const g = legacyGroups.value.find((x) => Number(x?.gid) === gid) || null;
      if (!g) throw new Error("未找到该旧版分类");

      const fids = Array.isArray(g.forums) ? g.forums.map((f) => Number(f?.fid)).filter((n) => n > 0) : [];
      const fidSet = new Set(fids);
      const latestRes = await window.riverside?.legacy.listLatest?.({ view: "newthread", page: 1 });
      const list = Array.isArray((latestRes as any)?.threads) ? ((latestRes as any).threads as FeedPost[]) : [];
      posts.value = list
        .filter((p) => {
          const fid = typeof (p as any)?.legacy?.fid === "number" ? Number((p as any).legacy.fid) : null;
          return fid != null && fidSet.has(fid);
        })
        .map((p) => tagPost(p, "discuz"));
      discoverContext.value = { type: "legacy-group", gid, fids };
      discoverHasMoreDiscourse.value = false;
      discoverHasMoreLegacy.value = true;
      return;
    }

    if (!useDiscourse.value) throw new Error("当前为旧版模式，请切换到「新论坛」或「混合」浏览新版板块");

    const cat = categories.value.find((c) => c.id === id) ?? null;
    if (!cat) {
      await refreshAll();
      return;
    }

    const childrenByParent = new Map<number, number[]>();
    for (const c of categories.value) {
      const pid = c.parentId != null ? Number(c.parentId) : null;
      if (pid == null || !Number.isFinite(pid)) continue;
      const list = childrenByParent.get(pid) || [];
      list.push(c.id);
      childrenByParent.set(pid, list);
    }

    const allowed = new Set<number>();
    const queue = [cat.id];
    while (queue.length) {
      const cur = queue.shift()!;
      if (allowed.has(cur)) continue;
      allowed.add(cur);
      for (const kid of childrenByParent.get(cur) || []) queue.push(kid);
    }

    const allowedIds = Array.from(allowed.values());
    const isLeaf = allowedIds.length <= 1;

    discoverContext.value = {
      type: "discourse-category",
      categoryId: cat.id,
      slug: cat.slug || "",
      mode: isLeaf ? "category" : "latest-filter",
      allowedIds,
    };
    discoverHasMoreDiscourse.value = true;
    discoverHasMoreLegacy.value = false;

    if (isLeaf) {
      const res = await window.riverside?.forum.listCategoryTopics(cat.id, cat.slug, 1);
      const list = Array.isArray((res as any)?.posts) ? ((res as any).posts as FeedPost[]) : [];
      posts.value = list.map((p) => tagPost(p, "discourse"));
      return;
    }

    const latestRes = await window.riverside?.forum.listLatest?.({ page: 1 });
    const latestPosts = Array.isArray((latestRes as any)?.posts) ? ((latestRes as any).posts as FeedPost[]) : [];
    const latestCats = Array.isArray((latestRes as any)?.categories)
      ? ((latestRes as any).categories as BrowseCategory[])
      : null;
    if (latestCats && latestCats.length > 0) categories.value = latestCats;

    posts.value = latestPosts
      .filter((p) => {
        const cid = typeof (p as any)?.category?.id === "number" ? Number((p as any).category.id) : null;
        return cid != null && allowed.has(cid);
      })
      .map((p) => tagPost(p, "discourse"));
  } catch (e: any) {
    if (isRateLimitError(e)) {
      backoffOnRateLimit();
      return;
    }
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

const refreshDiscover = async () => {
  await selectCategory(selectedCategoryId.value);
};

const loadMoreDiscover = async () => {
  if (discoverLoadingMore.value) return;
  if (!discoverHasMore.value) return;
  if (Date.now() < rateLimitedUntil) return;

  const gen = discoverGeneration.value;
  discoverLoadingMore.value = true;

  try {
    const ctx = discoverContext.value;

    let nextCats: BrowseCategory[] | null = null;
    let nextPosts: FeedPost[] = [];

    let nextDiscoursePage = discoverPageDiscourse.value;
    let nextLegacyPage = discoverPageLegacy.value;
    let hasMoreDiscourse = discoverHasMoreDiscourse.value;
    let hasMoreLegacy = discoverHasMoreLegacy.value;

    if (ctx.type === "all") {
      const wantDiscourse = useDiscourse.value;
      const wantLegacy = useLegacy.value && legacyLoggedIn.value;

      if (wantDiscourse && hasMoreDiscourse) {
        const page = nextDiscoursePage + 1;
        try {
          const res = await window.riverside?.forum.listLatest?.({ page });
          const list = Array.isArray((res as any)?.posts) ? ((res as any).posts as FeedPost[]) : [];
          const cats = Array.isArray((res as any)?.categories) ? ((res as any).categories as BrowseCategory[]) : null;
          if (cats && cats.length > 0) nextCats = cats;
          nextDiscoursePage = page;
          if (list.length === 0) hasMoreDiscourse = false;
          nextPosts.push(...list.map((p) => tagPost(p, "discourse")));
        } catch (e: any) {
          if (isRateLimitError(e)) backoffOnRateLimit();
        }
      }

      if (wantLegacy && hasMoreLegacy) {
        const page = nextLegacyPage + 1;
        try {
          const res = await window.riverside?.legacy.listLatest?.({ view: "newthread", page });
          const list = Array.isArray((res as any)?.threads) ? ((res as any).threads as FeedPost[]) : [];
          nextLegacyPage = page;
          if (list.length === 0) hasMoreLegacy = false;
          nextPosts.push(...list.map((p) => tagPost(p, "discuz")));
        } catch {
          // ignore
        }
      }
    } else if (ctx.type === "legacy-forum") {
      if (!useLegacy.value || !legacyLoggedIn.value) {
        hasMoreLegacy = false;
      } else if (hasMoreLegacy) {
        const page = nextLegacyPage + 1;
        try {
          const res = await window.riverside?.legacy.listForumThreads?.({ fid: ctx.fid, page });
          const list = Array.isArray((res as any)?.threads) ? ((res as any).threads as FeedPost[]) : [];
          nextLegacyPage = page;
          if (list.length === 0) hasMoreLegacy = false;
          nextPosts.push(...list.map((p) => tagPost(p, "discuz")));
        } catch {
          // ignore
        }
      }
      hasMoreDiscourse = false;
    } else if (ctx.type === "legacy-group") {
      if (!useLegacy.value || !legacyLoggedIn.value) {
        hasMoreLegacy = false;
      } else if (hasMoreLegacy) {
        const fidSet = new Set(ctx.fids);
        let page = nextLegacyPage;
        let tries = 0;
        while (tries < 3) {
          const nextPage = page + 1;
          tries += 1;
          let res: any = null;
          try {
            res = await window.riverside?.legacy.listLatest?.({ view: "newthread", page: nextPage });
          } catch {
            break;
          }
          const list = Array.isArray(res?.threads) ? (res.threads as FeedPost[]) : [];
          page = nextPage;
          if (list.length === 0) {
            hasMoreLegacy = false;
            break;
          }
          const matches = list
            .filter((p) => {
              const fid = typeof (p as any)?.legacy?.fid === "number" ? Number((p as any).legacy.fid) : null;
              return fid != null && fidSet.has(fid);
            })
            .map((p) => tagPost(p, "discuz"));
          nextPosts.push(...matches);
          if (matches.length > 0) break;
        }
        nextLegacyPage = page;
      }
      hasMoreDiscourse = false;
    } else if (ctx.type === "discourse-category") {
      if (!useDiscourse.value) {
        hasMoreDiscourse = false;
      } else if (hasMoreDiscourse) {
        if (ctx.mode === "category") {
          const page = nextDiscoursePage + 1;
          try {
            const res = await window.riverside?.forum.listCategoryTopics(ctx.categoryId, ctx.slug, page);
            const list = Array.isArray((res as any)?.posts) ? ((res as any).posts as FeedPost[]) : [];
            nextDiscoursePage = page;
            if (list.length === 0) hasMoreDiscourse = false;
            nextPosts.push(...list.map((p) => tagPost(p, "discourse")));
          } catch (e: any) {
            if (isRateLimitError(e)) backoffOnRateLimit();
          }
        } else {
          const allowed = new Set(ctx.allowedIds);
          let page = nextDiscoursePage;
          let tries = 0;
          while (tries < 3) {
            const nextPage = page + 1;
            tries += 1;
            let res: any = null;
            try {
              res = await window.riverside?.forum.listLatest?.({ page: nextPage });
            } catch (e: any) {
              if (isRateLimitError(e)) backoffOnRateLimit();
              break;
            }

            const list = Array.isArray(res?.posts) ? (res.posts as FeedPost[]) : [];
            const cats = Array.isArray(res?.categories) ? (res.categories as BrowseCategory[]) : null;
            if (cats && cats.length > 0) nextCats = cats;
            page = nextPage;

            if (list.length === 0) {
              hasMoreDiscourse = false;
              break;
            }

            const matches = list
              .filter((p) => {
                const cid = typeof (p as any)?.category?.id === "number" ? Number((p as any).category.id) : null;
                return cid != null && allowed.has(cid);
              })
              .map((p) => tagPost(p, "discourse"));

            nextPosts.push(...matches);
            if (matches.length > 0) break;
          }
          nextDiscoursePage = page;
        }
      }
      hasMoreLegacy = false;
    }

    if (gen !== discoverGeneration.value) return;

    if (nextCats && nextCats.length > 0) categories.value = nextCats;
    if (nextPosts.length > 0) posts.value = mergePostsByKey(posts.value, nextPosts);

    discoverPageDiscourse.value = nextDiscoursePage;
    discoverPageLegacy.value = nextLegacyPage;
    discoverHasMoreDiscourse.value = hasMoreDiscourse;
    discoverHasMoreLegacy.value = hasMoreLegacy;
  } finally {
    if (gen === discoverGeneration.value) discoverLoadingMore.value = false;
    else discoverLoadingMore.value = false;
  }
};

const loadOlderChatMessages = async () => {
  if (!me.value) return;
  const channelId = selectedChannelId.value;
  if (channelId == null) return;
  if (chatHistoryLoading.value) return;
  if (!chatHasMoreHistory.value) return;
  if (Date.now() < rateLimitedUntil) return;

  const chan = channels.value.find((c) => c.id === channelId) ?? null;
  const src = channelSource(chan);

  if (src === "discuz") {
    if (!legacyLoggedIn.value) return;
    const cursor = legacyPmCursor.value;
    const touid = cursor?.touid ?? Math.abs(channelId);
    const plid = cursor?.plid ?? null;
    const page = cursor?.prevPage ?? null;
    if (page == null) {
      chatHasMoreHistory.value = false;
      return;
    }

    chatHistoryLoading.value = true;
    try {
      const beforeCount = messages.value.length;

      const res = await window.riverside?.legacy.getPmMessages?.({
        touid,
        plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : undefined,
        page,
      });
      const incomingRaw = Array.isArray((res as any)?.messages) ? ((res as any).messages as ForumMessage[]) : [];
      const incoming = incomingRaw.map((m) => tagMessage(m, "discuz"));
      if (incoming.length === 0) {
        chatHasMoreHistory.value = false;
        return;
      }

      messages.value = mergeMessagesById(messages.value, incoming);

      const prevRaw = (res as any)?.prevPage;
      const prev = prevRaw != null ? Number(prevRaw) : null;
      legacyPmCursor.value = {
        touid,
        plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : null,
        prevPage: prev != null && Number.isFinite(prev) && prev > 0 ? prev : null,
      };
      chatHasMoreHistory.value = !!legacyPmCursor.value.prevPage && messages.value.length > beforeCount;
    } catch {
      // ignore (transient)
    } finally {
      chatHistoryLoading.value = false;
    }

    return;
  }

  const anchorId = firstServerMessageId(messages.value);
  if (anchorId == null) return;

  chatHistoryLoading.value = true;
  try {
    const beforeOldest = anchorId;
    const beforeCount = messages.value.length;

    const res = await window.riverside?.forum.getChatMessages(channelId, {
      pageSize: 50,
      direction: "past",
      targetMessageId: beforeOldest,
    });
    if (!res?.loggedIn) return;

    const incoming = Array.isArray(res?.messages) ? (res.messages as ForumMessage[]) : [];
    if (incoming.length === 0) {
      chatHasMoreHistory.value = false;
      return;
    }

    const merged = mergeMessagesById(messages.value, incoming);
    messages.value = merged;

    const afterOldest = firstServerMessageId(messages.value);
    if (afterOldest == null || afterOldest >= beforeOldest || messages.value.length === beforeCount) {
      chatHasMoreHistory.value = false;
    }
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
    // ignore (transient / rate limit)
  } finally {
    chatHistoryLoading.value = false;
  }
};

const sendMessage = async (payload: { text: string; uploadIds?: number[]; uploads?: ForumUpload[]; replyToMessageId?: number | null }) => {
  if (!activeChannel.value || !me.value) return;
  const raw = payload.text.trim();
  const hasUploads = (payload.uploadIds || []).length > 0;
  if (!raw && !hasUploads) return;

  const channelId = activeChannel.value.id;
  const src = channelSource(activeChannel.value);
  const actor = src === "discuz" ? legacyMe.value : me.value;

  if (src === "discuz") {
    if (!actor) {
      error.value = "请先登录旧版清水河畔（Discuz）";
      return;
    }
    if (hasUploads) {
      error.value = "旧版私信暂不支持图片";
      return;
    }
  }

  const nowIso = new Date().toISOString();
  const baseId = lastServerMessageId(messages.value) ?? 0;

  const replyId =
    payload.replyToMessageId == null ? null : Number(payload.replyToMessageId);
  const replySeed =
    replyId != null && Number.isFinite(replyId) && replyId > 0
      ? messages.value.find((m) => m.id === replyId) ?? null
      : null;

  const optimisticKey = `o:${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const optimistic: ForumMessage = {
    id: nextOptimisticId(),
    renderKey: optimisticKey,
    from: "me",
    userId: actor?.id ?? me.value.id,
    username: actor?.username ?? me.value.username,
    avatarUrl: actor?.avatarUrl ?? me.value.avatarUrl ?? null,
    cooked: cookOptimisticMessage(raw),
    createdAt: nowIso,
    replyTo:
      src === "discourse" && replySeed
        ? {
            messageId: replySeed.id,
            username: replySeed.username,
            avatarUrl: replySeed.avatarUrl ?? null,
            excerpt: stripHtmlToText(replySeed.cooked).slice(0, 140),
          }
        : null,
    uploads: src === "discourse" && Array.isArray(payload.uploads) ? payload.uploads : null,
    localOnly: true,
    localSig: buildMessageSignatureFromRaw(raw, { hasUploads }),
    localBaseId: baseId,
    source: src,
  };

  const preview = raw.trim() || (hasUploads ? "[图片]" : "");

  messages.value = mergeMessagesById(messages.value, [optimistic]);
  channels.value = sortChannelsByRecent(
    channels.value.map((c) =>
      c.id === channelId
        ? {
            ...c,
            lastMessageAt: nowIso,
            lastMessagePreview: preview,
            unread: 0,
          }
        : c
    )
  );

  try {
    if (src === "discuz") {
      const touidRaw = (activeChannel.value as any)?.legacy?.touid;
      const touid = touidRaw != null ? Math.abs(Number(touidRaw)) : Math.abs(Number(channelId));
      const plidRaw = (activeChannel.value as any)?.legacy?.plid;
      const plid = plidRaw != null ? Math.abs(Number(plidRaw)) : null;
      if (!Number.isFinite(touid) || touid <= 0) throw new Error("touid is required");
      const res = await window.riverside?.legacy.sendPmMessage?.({
        touid,
        plid: plid != null && Number.isFinite(plid) && plid > 0 ? plid : undefined,
        message: raw,
      });
      if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");
      markLegacyPmRead(activeChannel.value, nowIso);
      void pollActiveMessagesOnce({ forceFull: true });
      window.setTimeout(() => void pollActiveMessagesOnce({ forceFull: true }), 900);
      return;
    }

    const res = await window.riverside?.forum.sendChatMessage(
      channelId,
      raw,
      payload.uploadIds,
      payload.replyToMessageId ?? null
    );

    const ackMsg = (res as any)?.message as ForumMessage | null;
    const ackIdRaw = (res as any)?.messageId ?? ackMsg?.id ?? null;
    const ackId = ackIdRaw == null ? null : Number(ackIdRaw);

    if (ackMsg && Number.isInteger(ackMsg.id)) {
      const finalMsg: ForumMessage = {
        ...tagMessage(ackMsg, "discourse"),
        renderKey: optimisticKey,
        localOnly: false,
        avatarUrl: ackMsg.avatarUrl ?? optimistic.avatarUrl,
        replyTo: ackMsg.replyTo ?? optimistic.replyTo ?? null,
        uploads: ackMsg.uploads ?? optimistic.uploads ?? null,
      };
      messages.value = messages.value
        .map((m) => (m.id === optimistic.id ? finalMsg : m))
        .sort((a, b) => (a.id || 0) - (b.id || 0));
    } else if (ackId != null && Number.isFinite(ackId) && ackId > 0) {
      messages.value = messages.value
        .map((m) => (m.id === optimistic.id ? { ...m, id: ackId, localOnly: false } : m))
        .sort((a, b) => (a.id || 0) - (b.id || 0));
      void pollActiveMessagesOnce({ forceFull: true });
    } else {
      void pollActiveMessagesOnce({ forceFull: true });
    }
  } catch (e: any) {
    messages.value = messages.value.filter((m) => m.id !== optimistic.id);
    if (isRateLimitError(e)) backoffOnRateLimit();
    error.value = isRateLimitError(e) ? "发送太频繁，请稍后再试。" : String(e?.message || e);
  }
};

const toggleLike = async (topicId: number) => {
  const idx = posts.value.findIndex((p) => p.id === topicId);
  if (idx < 0) return;
  const current = posts.value[idx];

  if (current.source === "discuz" || current.id < 0) {
    error.value = "旧版暂不支持点赞";
    return;
  }

  const desired = !current.liked;

  try {
    const res = await window.riverside?.forum.setLikeOnTopic(topicId, desired);
    if (!res?.loggedIn) return;
    posts.value = posts.value.map((p) => {
      if (p.id !== topicId) return p;
      const liked = !!res.liked;
      return {
        ...p,
        liked,
        likeCount: Math.max(0, p.likeCount + (liked ? 1 : -1)),
      };
    });
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
};

const quickComment = async (payload: { postId: number; text: string }) => {
  const raw = payload.text.trim();
  if (!raw) return;

  try {
    const p = posts.value.find((x) => x && x.id === payload.postId) ?? null;
    const isLegacy = !!p && (p.source === "discuz" || p.legacy?.source === "discuz" || payload.postId < 0);

    if (isLegacy) {
      if (!legacyLoggedIn.value) throw new Error("请先登录旧版清水河畔（Discuz）");
      const tid = typeof p?.legacy?.tid === "number" ? Number(p.legacy.tid) : Math.abs(payload.postId);
      const fid = typeof p?.legacy?.fid === "number" ? Number(p.legacy.fid) : null;
      if (!Number.isFinite(tid) || tid <= 0) throw new Error("tid is required");
      if (fid == null || !Number.isFinite(fid) || fid <= 0) throw new Error("旧版回帖需要具体板块（fid）");

      const res = await window.riverside?.legacy.replyThread?.({ tid, fid, message: raw });
      if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");

      posts.value = posts.value.map((x) =>
        x.id === payload.postId ? { ...x, replyCount: x.replyCount + 1 } : x
      );
      return;
    }

    await window.riverside?.forum.replyTopic(payload.postId, raw);
    posts.value = posts.value.map((x) =>
      x.id === payload.postId ? { ...x, replyCount: x.replyCount + 1 } : x
    );
  } catch (e: any) {
    error.value = String(e?.message || e);
  }
};

const openExternal = async (url: string) => {
  await window.riverside?.openExternal?.(url);
};

const parseTopicFromUrl = (url: string) => {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const u = raw.startsWith("http") ? new URL(raw) : null;
    const path = u ? u.pathname : raw;
    let m = path.match(/\/t\/[^/]+\/(\d+)(?:\/(\d+))?/i);
    if (!m) m = path.match(/\/t\/(\d+)(?:\/(\d+))?/i);
    if (!m) return null;
    return {
      topicId: Number(m[1]) || null,
      postNumber: m[2] ? Number(m[2]) || null : null,
    };
  } catch {
    return null;
  }
};

const parseChatFromUrl = (url: string) => {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    const u = raw.startsWith("http") ? new URL(raw) : null;
    const path = u ? u.pathname : raw;
    let m = path.match(/\/chat\/c\/-\/(\d+)(?:\/(\d+))?/i);
    if (!m) m = path.match(/\/chat\/c\/[^/]+\/(\d+)(?:\/(\d+))?/i);
    if (!m) return null;
    return {
      channelId: Number(m[1]) || null,
      messageId: m[2] ? Number(m[2]) || null : null,
    };
  } catch {
    return null;
  }
};

const ensureTopicSeed = (payload: { topicId: number; title?: string | null; url?: string | null }) => {
  const topicId = Number(payload.topicId);
  if (!Number.isFinite(topicId) || topicId <= 0) return;
  const exists = posts.value.some((p) => p.id === topicId);
  if (exists) return;

  const now = new Date().toISOString();
  const seed: FeedPost = {
    id: topicId,
    title: payload.title || `话题 ${String(topicId)}`,
    slug: "",
    excerpt: "",
    likeCount: 0,
    liked: false,
    replyCount: 0,
    views: 0,
    lastPostedAt: now,
    createdAt: now,
    category: null,
    author: null,
    url: payload.url || `${BASE_URL}/t/${encodeURIComponent(String(topicId))}`,
  };
  posts.value = [seed, ...posts.value];
};

const openTopicFromNotification = (payload: { topicId: number; postNumber?: number | null; title?: string | null; url?: string | null }) => {
  const topicId = Number(payload.topicId);
  if (!Number.isFinite(topicId) || topicId <= 0) return;

  ensureTopicSeed({ topicId, title: payload.title || null, url: payload.url || null });
  topicModalInitialPostNumber.value =
    payload.postNumber != null && Number.isFinite(Number(payload.postNumber))
      ? Number(payload.postNumber)
      : null;
  topicModalId.value = topicId;
  section.value = "discover";
  setChatCollapsed(false);
};

const jumpToChatMessage = async (channelId: number, messageId: number) => {
  const cid = Number(channelId);
  const mid = Number(messageId);
  if (!Number.isFinite(cid) || cid <= 0) return;
  if (!Number.isFinite(mid) || mid <= 0) return;

  if (selectedChannelId.value !== cid) {
    await selectChannel(cid);
  }

  try {
    const has = messages.value.some((m) => Number(m?.id) === mid);
    if (!has) {
      const res = await window.riverside?.forum.getChatMessages?.(cid, {
        pageSize: 50,
        targetMessageId: mid,
      });
      if (res?.loggedIn) {
        const incoming = Array.isArray(res?.messages) ? (res.messages as ForumMessage[]) : [];
        if (incoming.length > 0) messages.value = mergeMessagesById(messages.value, incoming);
      }
    }
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
  }

  await nextTick();
  const scroll = () => {
    const el = document.querySelector(`[data-message-id="${mid}"]`) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  };
  if (scroll()) return;
  requestAnimationFrame(() => void scroll());
  window.setTimeout(() => void scroll(), 240);
};

const markAllNotificationsRead = async () => {
  notificationsError.value = null;
  try {
    if (useDiscourse.value) {
      await window.riverside?.forum.markAllNotificationsRead?.();
    }
    if (useLegacy.value) {
      for (const n of notifications.value) {
        if ((n as any)?.source === "discuz") markLegacyNoticeRead(n.id);
      }
    }
    notifications.value = notifications.value.map((n) => ({ ...n, read: true }));
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
    notificationsError.value = String(e?.message || e);
  }
};

const openNotification = async (n: ForumNotification) => {
  if (!n || typeof n.id !== "number") return;
  closeNotificationsModal();

  const src: Source = (n as any)?.source === "discuz" ? "discuz" : "discourse";

  notifications.value = notifications.value.map((x) => (x.id === n.id ? { ...x, read: true } : x));

  if (src === "discuz") {
    markLegacyNoticeRead(n.id);

    const legacy = (n as any)?.legacy || {};
    let ptid = Number(legacy?.ptid) || null;
    let pid = Number(legacy?.pid) || null;

    if (!ptid && typeof n.topicId === "number" && n.topicId < 0) ptid = Math.abs(n.topicId);
    if (!pid && typeof n.postNumber === "number" && n.postNumber > 0) pid = n.postNumber;

    if ((!ptid || !pid) && n.url) {
      const m = String(n.url).match(/ptid=(\d+)&pid=(\d+)/i);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (!ptid && Number.isFinite(a) && a > 0) ptid = a;
        if (!pid && Number.isFinite(b) && b > 0) pid = b;
      }
    }

    if (ptid && pid) {
      try {
        const rr = await window.riverside?.legacy.resolveFindpost?.({ ptid, pid });
        if (!(rr as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");
        const pageRaw = (rr as any)?.page;
        const page = pageRaw != null ? Number(pageRaw) : 1;
        openLegacyThread({ tid: ptid, pid, page: Number.isFinite(page) && page > 0 ? page : 1 });
        return;
      } catch (e: any) {
        error.value = String(e?.message || e);
        if (n.url) await openExternal(n.url);
        return;
      }
    }

    if (ptid) {
      openLegacyThread({ tid: ptid, pid: pid && pid > 0 ? pid : null, page: 1 });
      return;
    }

    if (n.url) await openExternal(n.url);
    return;
  }

  try {
    await window.riverside?.forum.markNotificationRead?.({ id: n.id });
  } catch (e: any) {
    if (isRateLimitError(e)) backoffOnRateLimit();
  }

  let topicId = n.topicId;
  let postNumber = n.postNumber;
  let chatChannelId = n.chatChannelId;
  let chatMessageId = n.chatMessageId;

  if (n.url) {
    const t = parseTopicFromUrl(n.url);
    if (topicId == null && t?.topicId) topicId = t.topicId;
    if (postNumber == null && t?.postNumber) postNumber = t.postNumber;

    const c = parseChatFromUrl(n.url);
    if (chatChannelId == null && c?.channelId) chatChannelId = c.channelId;
    if (chatMessageId == null && c?.messageId) chatMessageId = c.messageId;
  }

  if (chatChannelId) {
    await selectChannel(chatChannelId);
    if (chatMessageId) await jumpToChatMessage(chatChannelId, chatMessageId);
    return;
  }

  if (topicId) {
    openTopicFromNotification({
      topicId,
      postNumber: postNumber ?? null,
      title: n.title,
      url: n.url,
    });
    return;
  }

  if (n.url) await openExternal(n.url);
};

watch(
  () => selectedChannelId.value,
  () => {
    chatHistoryLoading.value = false;
    chatHasMoreHistory.value = true;
  }
);

watch(
  () => isLoggedIn.value,
  (loggedIn) => {
    if (!loggedIn) {
      stopRealtimePolling();
      return;
    }
    startRealtimePolling();
  },
  { immediate: true }
);

onMounted(async () => refreshAll());
onUnmounted(() => stopRealtimePolling());
</script>

<template>
  <div class="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-bg))]">
    <WindowResizeHandles />
    <TitleBar
      :logged-in="isLoggedIn"
      :collapse-enabled="isLoggedIn && section === 'chat'"
      :collapsed="chatCollapsed"
      :notification-count="isLoggedIn ? notificationCount : 0"
      @toggle-collapse="toggleChatCollapsed"
      @open-notifications="openNotificationsModal"
      @logout="doLogout"
    />

    <main
      class="flex flex-1 overflow-hidden p-3 pt-0"
      :class="section === 'chat' && chatCollapsed ? 'gap-0' : 'gap-3'"
    >
      <template v-if="!isLoggedIn">
        <ConnectView
          :loading="loading"
          :error="error"
          @login="openLogin"
          @refresh="refreshAll"
        />
      </template>

      <template v-else>
        <Sidebar
          :me="me!"
          :section="section"
          :site-mode="siteMode"
          :legacy-logged-in="legacyLoggedIn"
          :channels="channels"
          :selected-channel-id="selectedChannelId"
          :categories="sidebarCategories"
          :selected-category-id="selectedCategoryId"
            @update:section="onSectionChange"
            @update:site-mode="onSiteModeChange"
            @select-channel="selectChannel"
            @select-category="selectCategory"
            @open-settings="openSettings"
            @start-chat-with-user="startChatWithUser"
            @open-legacy-login="openLegacyLogin"
          />

          <ChatView
            v-if="section === 'chat' && !chatCollapsed"
            :me="chatMe"
            :channel="activeChannel"
            :messages="messages"
            :more-url="activeChannel?.url || null"
            :load-older="loadOlderChatMessages"
            :has-more-history="chatHasMoreHistory"
            :attachments-enabled="chatAttachmentsEnabled"
            :mention-provider="chatMentionProvider"
            @send="sendMessage"
            @refresh="refreshAll"
            @open-user="openUserFromChat"
          />

          <DiscoverView
            v-else-if="section === 'discover'"
            :posts="posts"
            :category-name="activeCategory?.name || null"
            :category-id="selectedCategoryId"
            :category-options="discoverCategoryOptions"
            :loading-more="discoverLoadingMore"
            :has-more="discoverHasMore"
            @refresh="refreshDiscover"
            @toggle-like="toggleLike"
            @quick-comment="quickComment"
            @open-topic="openTopic"
            @open-external="openExternal"
            @new-topic="openNewTopic"
            @open-user="openUserCard"
            @select-category="selectCategory"
            @load-more="loadMoreDiscover"
          />
        </template>
      </main>

    <TopicModal
      v-if="isLoggedIn"
      :me="me!"
      :post="activeTopicPost"
      :initial-post-number="topicModalInitialPostNumber"
      @close="closeTopic"
      @toggle-like="toggleLike"
      @replied="onTopicReplied"
      @open-user="openUserCard"
    />

    <LegacyThreadModal
      v-if="isLoggedIn && legacyThreadSeed"
      :seed="legacyThreadSeed"
      :me="legacyMe"
      @close="closeLegacyThread"
      @open-user="openUserCard"
    />

    <NotificationsModal
      v-if="isLoggedIn && notificationsOpen"
      :notifications="notifications"
      :loading="notificationsLoading"
      :error="notificationsError"
      :site-mode="siteMode"
      @close="closeNotificationsModal"
      @refresh="refreshNotifications()"
      @mark-all-read="markAllNotificationsRead"
      @open="openNotification"
    />

    <SettingsModal
      v-if="isLoggedIn && settingsOpen"
      :me="me!"
      @close="closeSettings"
      @saved="refreshAll"
    />

    <UserCardModal
      v-if="isLoggedIn && userCard?.username"
      :username="userCard?.username || null"
      :source="userCard?.source || 'discourse'"
      :seed="userCard?.seed || null"
      @close="closeUserCard"
      @start-chat="startChatWithUser"
      @open-profile="openUserProfile"
    />

    <UserSpaceModal
      v-if="isLoggedIn && userSpace?.username"
      :username="userSpace?.username || null"
      :source="userSpace?.source || 'discourse'"
      :user-id="userSpace?.userId ?? null"
      @close="closeUserSpace"
      @start-chat="startChatWithUser"
      @open-topic="openTopicFromSeed"
    />

    <NewTopicModal
      v-if="isLoggedIn && newTopicOpen"
      :categories="categories"
      :initial-category-id="selectedCategoryId"
      @close="closeNewTopic"
      @posted="onNewTopicPosted"
    />
 
    <LegacyNewThreadModal
      v-if="isLoggedIn && legacyNewThreadOpen"
      :groups="legacyGroups"
      :initial-gid="legacyNewThreadInitialGid"
      @close="closeLegacyNewThread"
      @posted="onLegacyNewThreadPosted"
    />

    <PostTargetModal
      v-if="isLoggedIn && postTargetOpen"
      @close="closePostTarget"
      @choose="onPostTarget"
    />

    <div
      v-if="error && isLoggedIn"
      class="no-drag absolute bottom-4 right-4 z-50 max-w-[520px] rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700 shadow-soft"
    >
      <div class="flex items-start gap-3">
        <i class="ri-error-warning-line mt-0.5 text-lg"></i>
        <div class="min-w-0 flex-1 break-words">{{ error }}</div>
        <button
          class="ml-2 rounded-lg border border-rose-500/20 bg-white/60 px-2 py-1 text-xs text-rose-700 transition hover:bg-white/80"
          type="button"
          @click="error = null"
        >
          关闭
        </button>
      </div>
    </div>
  </div>
</template>
