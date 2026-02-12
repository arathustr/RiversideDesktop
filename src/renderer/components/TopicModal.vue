<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import RichText from "@/components/RichText.vue";
import type { FeedPost, ForumEmoji, ForumMessage, ForumUser } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

const props = defineProps<{
  me: ForumUser;
  post: FeedPost | null;
  initialPostNumber?: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "toggleLike", topicId: number): void;
  (e: "replied", topicId: number): void;
  (e: "openUser", payload: { username: string; userId?: number | null; avatarUrl?: string | null }): void;
}>();

type Attachment = {
  id: string;
  filePath: string;
  fileName: string;
  status: "uploading" | "ready" | "error";
  uploadId?: number;
  url?: string | null;
  shortUrl?: string | null;
  error?: string;
};

type ReplyTarget = {
  postNumber: number;
  username: string;
  avatarUrl: string | null;
  excerpt?: string | null;
};

const loading = ref(false);
const sending = ref(false);
const error = ref<string | null>(null);

const topicMessages = ref<ForumMessage[]>([]);
const listRef = ref<HTMLDivElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const lightboxUrl = ref<string | null>(null);
const emojiPopoverRef = ref<HTMLDivElement | null>(null);
const emojiButtonRef = ref<HTMLButtonElement | null>(null);
const mentionPopoverRef = ref<HTMLDivElement | null>(null);

const draft = ref("");
const showEmoji = ref(false);
const attachments = ref<Attachment[]>([]);
const replyTarget = ref<ReplyTarget | null>(null);

type EmojiPack = { id: string; title: string; emojis: ForumEmoji[] };

const emojiAll = ref<ForumEmoji[]>([]);
const emojiLoading = ref(false);

const emojiPackId = ref<string>("__all__");
const emojiQuery = ref("");
const emojiPage = ref(0);

const emojiNum = (name: string) => {
  const m = String(name || "").match(/^s(\d{2,4})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const emojiPacks = computed<EmojiPack[]>(() => {
  const order: string[] = [];
  const byGroup = new Map<string, ForumEmoji[]>();

  for (const e of emojiAll.value) {
    const g = String(e?.group || "其他");
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      order.push(g);
    }
    byGroup.get(g)!.push(e);
  }

  const isCjk = (s: string) => /[\u4e00-\u9fff]/.test(String(s || ""));
  const cjk = order.filter((g) => isCjk(g));
  const non = order.filter((g) => !isCjk(g));
  const ordered = [...cjk, ...non];

  const packs: EmojiPack[] = [{ id: "__all__", title: "全部", emojis: emojiAll.value }];
  for (const g of ordered) {
    const arr = byGroup.get(g) || [];
    const allNumeric =
      arr.length > 0 && arr.every((x) => /^s\d{2,4}$/.test(String(x?.name || "")));
    const emojis = allNumeric
      ? [...arr].sort((a, b) => (emojiNum(a.name) || 0) - (emojiNum(b.name) || 0))
      : arr;
    packs.push({ id: g, title: g, emojis });
  }

  return packs;
});

const activeEmojiPack = computed(
  () => emojiPacks.value.find((p) => p.id === emojiPackId.value) ?? emojiPacks.value[0] ?? null
);

const normalizedEmojiQuery = computed(() =>
  String(emojiQuery.value || "")
    .trim()
    .replace(/^:+/, "")
    .replace(/:+$/, "")
    .toLowerCase()
);

const activeEmojis = computed(() => {
  const base = activeEmojiPack.value?.emojis ?? [];
  const q = normalizedEmojiQuery.value;
  if (!q) return base;
  return base.filter((e) => String(e?.name || "").toLowerCase().includes(q));
});

const EMOJI_PAGE_SIZE = 24;
const emojiPageCount = computed(() =>
  Math.max(1, Math.ceil(activeEmojis.value.length / EMOJI_PAGE_SIZE))
);
const emojiPageSafe = computed(() =>
  Math.min(Math.max(0, emojiPage.value), emojiPageCount.value - 1)
);
const pagedEmojis = computed(() => {
  const start = emojiPageSafe.value * EMOJI_PAGE_SIZE;
  return activeEmojis.value.slice(start, start + EMOJI_PAGE_SIZE);
});

const prevEmojiPage = () => {
  emojiPage.value = (emojiPageSafe.value - 1 + emojiPageCount.value) % emojiPageCount.value;
};
const nextEmojiPage = () => {
  emojiPage.value = (emojiPageSafe.value + 1) % emojiPageCount.value;
};

const loadEmojis = async () => {
  if (emojiLoading.value) return;
  emojiLoading.value = true;
  try {
    const res = await window.riverside?.forum.listEmojis?.();
    const list = Array.isArray((res as any)?.emojis) ? ((res as any).emojis as ForumEmoji[]) : [];
    emojiAll.value = list.filter((e) => e && typeof e.name === "string" && typeof e.url === "string");

    const preferredOrder = ["阿鲁", "蛋黄脸", "洋葱头", "兔斯基", "暴走"];
    const preferred =
      emojiPacks.value.find((p) => preferredOrder.includes(p.id)) ?? emojiPacks.value[0] ?? null;

    if (
      emojiPacks.value.length > 0 &&
      (!emojiPacks.value.some((p) => p.id === emojiPackId.value) || emojiPackId.value === "__all__")
    ) {
      emojiPackId.value = preferred?.id ?? "__all__";
    }
  } catch {
    // ignore
  } finally {
    emojiLoading.value = false;
  }
};

const mentionOpen = ref(false);
const mentionLoading = ref(false);
const mentionTerm = ref("");
const mentionHits = ref<ForumUser[]>([]);
const mentionIndex = ref(0);
let mentionSearchTimer: number | null = null;

const topicTitle = computed(() => props.post?.title ?? "");
const topicUrl = computed(() => props.post?.url ?? "");
const categoryName = computed(() => props.post?.category?.name ?? "");

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

const openUserFromMessage = (m: ForumMessage) => {
  const u = String(m?.username || "").trim();
  if (!u || u === "system") return;
  emit("openUser", { username: u, userId: m.userId ?? null, avatarUrl: m.avatarUrl ?? null });
};

const startReply = async (m: ForumMessage, fallbackPostNumber: number) => {
  const pn = Number(m.postNumber ?? fallbackPostNumber);
  if (!Number.isFinite(pn) || pn <= 0) return;
  replyTarget.value = {
    postNumber: pn,
    username: String(m.username || "").trim() || "user",
    avatarUrl: m.avatarUrl ?? null,
    excerpt: stripHtmlToText(m.cooked).slice(0, 140),
  };
  showEmoji.value = false;
  await nextTick();
  textareaRef.value?.focus();
};

const clearReply = () => {
  replyTarget.value = null;
};

const uploadingCount = computed(
  () => attachments.value.filter((a) => a.status === "uploading").length
);

const readyAttachments = computed(() =>
  attachments.value.filter((a) => a.status === "ready" && typeof a.uploadId === "number")
);

const canSend = computed(() => {
  const hasText = draft.value.trim().length > 0;
  const hasFiles = readyAttachments.value.length > 0;
  return (hasText || hasFiles) && uploadingCount.value === 0 && !sending.value;
});

const scrollToBottom = async () => {
  await nextTick();
  const el = listRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
};

const formatTime = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const scrollToPostNumber = (postNumber: number) => {
  const container = listRef.value;
  if (!container) return;
  const el = container.querySelector(`[data-post-number="${postNumber}"]`) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
};

const isImageUrl = (url: string) => /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(url);

const onCookedClick = async (ev: MouseEvent) => {
  const target = ev.target as HTMLElement | null;

  const a = target?.closest?.("a") as HTMLAnchorElement | null;
  if (a?.href) {
    ev.preventDefault();
    if (a.classList.contains("lightbox") || isImageUrl(a.href)) {
      lightboxUrl.value = a.href;
      return;
    }
    await window.riverside?.openExternal?.(a.href);
    return;
  }

  const img = target?.closest?.("img") as HTMLImageElement | null;
  if (img?.src && isImageUrl(img.src)) {
    lightboxUrl.value = img.src;
  }
};

const load = async (topicId: number, focusPostNumber?: number | null) => {
  loading.value = true;
  error.value = null;
  try {
    const res = await window.riverside?.forum.getTopic(topicId);
    topicMessages.value = res?.messages ?? [];
    await nextTick();
    const pn = focusPostNumber == null ? null : Number(focusPostNumber);
    if (Number.isFinite(pn) && pn && pn > 0) {
      scrollToPostNumber(pn);
    } else {
      await scrollToBottom();
    }
  } catch (e: any) {
    error.value = String(e?.message || e);
    topicMessages.value = [];
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.post?.id ?? null,
  async (id) => {
    topicMessages.value = [];
    attachments.value = [];
    draft.value = "";
    showEmoji.value = false;
    replyTarget.value = null;
    error.value = null;
    if (id == null) return;
    await load(id, props.initialPostNumber ?? null);
  },
  { immediate: true }
);

watch(
  () => props.initialPostNumber ?? null,
  async (pn) => {
    if (pn == null) return;
    if (topicMessages.value.length === 0) return;
    await nextTick();
    scrollToPostNumber(Number(pn));
  }
);

const attachImages = async () => {
  showEmoji.value = false;
  const picker = await window.riverside?.files.pickImages?.();
  if (!picker || picker.canceled) return;

  for (const filePath of picker.filePaths || []) {
    const fileName = filePath.split(/[/\\\\]/).pop() || "image";
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    attachments.value = [
      ...attachments.value,
      {
        id,
        filePath,
        fileName,
        status: "uploading",
      },
    ];

    try {
      const res = await window.riverside?.forum.uploadFile?.(filePath, "composer");
      const up = res?.upload;
      attachments.value = attachments.value.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "ready",
              uploadId: up?.id,
              url: up?.url || null,
              shortUrl: up?.shortUrl || null,
            }
          : a
      );
    } catch (e: any) {
      attachments.value = attachments.value.map((a) =>
        a.id === id
          ? {
              ...a,
              status: "error",
              error: String(e?.message || e),
            }
          : a
      );
    }
  }
};

const removeAttachment = (id: string) => {
  attachments.value = attachments.value.filter((a) => a.id !== id);
};

const appendEmoji = (e: ForumEmoji) => {
  if (!e?.name) return;
  insertTextAtCursor(`:${e.name}:`);
};

const insertTextAtCursor = (text: string) => {
  const el = textareaRef.value;
  if (!el) {
    draft.value += text;
    return;
  }

  const start = el.selectionStart ?? draft.value.length;
  const end = el.selectionEnd ?? draft.value.length;
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end);
  void nextTick(() => {
    el.focus();
    const nextPos = start + text.length;
    el.selectionStart = nextPos;
    el.selectionEnd = nextPos;
  });
};

const mentionUser = async (username: string) => {
  const u = String(username || "").trim();
  if (!u || u === "system") return;
  insertTextAtCursor(`@${u} `);
  showEmoji.value = false;
  mentionOpen.value = false;
  await nextTick();
  textareaRef.value?.focus();
};

const getMentionContext = () => {
  const el = textareaRef.value;
  if (!el) return null;
  const cursor = el.selectionStart ?? draft.value.length;
  const before = draft.value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;

  const prev = at > 0 ? before[at - 1] : "";
  if (prev && /[A-Za-z0-9_]/.test(prev)) return null;

  const term = before.slice(at + 1);
  if (!term && before.endsWith("@")) return { start: at, end: cursor, term: "" };
  if (!term) return null;
  if (/\s/.test(term)) return null;
  if (term.length > 24) return null;
  return { start: at, end: cursor, term };
};

const closeMention = () => {
  mentionOpen.value = false;
  mentionLoading.value = false;
  mentionTerm.value = "";
  mentionHits.value = [];
  mentionIndex.value = 0;
  if (mentionSearchTimer != null) window.clearTimeout(mentionSearchTimer);
  mentionSearchTimer = null;
};

const runMentionSearch = async () => {
  if (!mentionOpen.value) return;
  const term = mentionTerm.value.trim();
  if (!term) {
    mentionLoading.value = false;
    mentionHits.value = [];
    return;
  }

  mentionLoading.value = true;
  try {
    const res = await window.riverside?.forum.searchUsers?.({ term, limit: 8 });
    const list = Array.isArray(res?.users) ? (res.users as ForumUser[]) : [];
    const dedup = new Map<string, ForumUser>();
    for (const u of list) {
      if (!u?.username) continue;
      if (u.username.toLowerCase() === props.me.username.toLowerCase()) continue;
      dedup.set(u.username.toLowerCase(), u);
    }
    mentionHits.value = Array.from(dedup.values()).slice(0, 8);
    mentionIndex.value = 0;
  } catch {
    mentionHits.value = [];
  } finally {
    mentionLoading.value = false;
  }
};

const scheduleMentionSearch = () => {
  const ctx = getMentionContext();
  if (!ctx) {
    closeMention();
    return;
  }

  showEmoji.value = false;
  mentionOpen.value = true;
  mentionTerm.value = ctx.term;
  mentionIndex.value = 0;

  if (mentionSearchTimer != null) window.clearTimeout(mentionSearchTimer);
  mentionSearchTimer = window.setTimeout(() => void runMentionSearch(), 200);
};

const selectMention = (u: ForumUser) => {
  if (!u?.username) return;
  const ctx = getMentionContext();
  if (!ctx) return;

  const before = draft.value.slice(0, ctx.start);
  const after = draft.value.slice(ctx.end);
  const insert = `@${u.username} `;
  draft.value = before + insert + after;
  closeMention();

  void nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    const pos = before.length + insert.length;
    el.selectionStart = pos;
    el.selectionEnd = pos;
  });
};

const onTextareaKeydownForMention = (ev: KeyboardEvent) => {
  if (!mentionOpen.value) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeMention();
    return;
  }

  if (mentionHits.value.length === 0) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    mentionIndex.value = Math.min(mentionHits.value.length - 1, mentionIndex.value + 1);
    return;
  }
  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    mentionIndex.value = Math.max(0, mentionIndex.value - 1);
    return;
  }
  if (ev.key === "Enter" || ev.key === "Tab") {
    ev.preventDefault();
    const pick = mentionHits.value[Math.min(mentionHits.value.length - 1, mentionIndex.value)];
    if (pick) selectMention(pick);
  }
};

const onTextareaKeydownAll = (ev: KeyboardEvent) => {
  onTextareaKeydownForMention(ev);
  if (ev.defaultPrevented) return;
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    void sendNow();
  }
};

const toggleEmoji = () => {
  showEmoji.value = !showEmoji.value;
  if (showEmoji.value) {
    closeMention();
    if (emojiAll.value.length === 0) void loadEmojis();
  }
};

const handleGlobalMouseDown = (ev: MouseEvent) => {
  const t = ev.target as Node | null;
  if (!t) return;

  if (showEmoji.value) {
    if (emojiPopoverRef.value?.contains(t)) return;
    if (emojiButtonRef.value?.contains(t)) return;
    showEmoji.value = false;
  }

  if (mentionOpen.value) {
    if (mentionPopoverRef.value?.contains(t)) return;
    if (textareaRef.value?.contains(t)) return;
    closeMention();
  }
};

watch([emojiPackId, emojiQuery], () => {
  emojiPage.value = 0;
});

watch([showEmoji, mentionOpen], ([emojiOpen, mentionIsOpen]) => {
  if (emojiOpen) emojiPage.value = 0;
  const shouldListen = emojiOpen || mentionIsOpen;
  if (shouldListen) {
    window.addEventListener("mousedown", handleGlobalMouseDown, true);
    return;
  }
  window.removeEventListener("mousedown", handleGlobalMouseDown, true);
});

onUnmounted(() => window.removeEventListener("mousedown", handleGlobalMouseDown, true));

const fileToBase64 = (file: File) =>
  new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const res = String(reader.result || "");
      const m = res.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return reject(new Error("Invalid image data"));
      resolve({ mimeType: m[1], base64: m[2] });
    };
    reader.readAsDataURL(file);
  });

const extFromMime = (mimeType: string) => {
  const t = (mimeType || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("gif")) return "gif";
  if (t.includes("webp")) return "webp";
  if (t.includes("bmp")) return "bmp";
  if (t.includes("svg")) return "svg";
  return "png";
};

const uploadClipboardImage = async (file: File) => {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mimeType = file.type || "image/png";
  const fileName =
    (file.name && file.name !== "blob" ? file.name : "") ||
    `paste-${Date.now()}.${extFromMime(mimeType)}`;

  attachments.value = [
    ...attachments.value,
    {
      id,
      filePath: "",
      fileName,
      status: "uploading",
    },
  ];

  try {
    const { base64 } = await fileToBase64(file);
    const res = await window.riverside?.forum.uploadBytes?.({
      dataBase64: base64,
      fileName,
      mimeType,
      type: "composer",
    });
    const up = res?.upload;
    attachments.value = attachments.value.map((a) =>
      a.id === id
        ? {
            ...a,
            status: "ready",
            uploadId: up?.id,
            url: up?.url || null,
            shortUrl: up?.shortUrl || null,
          }
        : a
    );
  } catch (e: any) {
    attachments.value = attachments.value.map((a) =>
      a.id === id
        ? {
            ...a,
            status: "error",
            error: String(e?.message || e),
          }
        : a
    );
  }
};

const onPaste = async (ev: ClipboardEvent) => {
  const dt = ev.clipboardData;
  if (!dt) return;

  const images: File[] = [];
  for (const item of Array.from(dt.items || [])) {
    if (item.kind !== "file") continue;
    if (!item.type || !item.type.startsWith("image/")) continue;
    const f = item.getAsFile();
    if (f) images.push(f);
  }

  if (images.length === 0) return;

  ev.preventDefault();

  const text = dt.getData("text/plain");
  if (text) insertTextAtCursor(text);

  showEmoji.value = false;
  for (const img of images) await uploadClipboardImage(img);
};

const sendNow = async () => {
  if (!props.post) return;
  if (uploadingCount.value > 0) return;

  const text = draft.value.trim();
  const uploadIds = readyAttachments.value.map((a) => a.uploadId as number);
  const attachmentLines = readyAttachments.value
    .map((a) => a.shortUrl || a.url)
    .filter(Boolean)
    .map((u) => `![](${u})`);

  const composed = [text, ...attachmentLines].filter(Boolean).join("\n\n");
  if (!composed) return;

  sending.value = true;
  error.value = null;
  try {
    const replyToPostNumber = replyTarget.value?.postNumber ?? null;
    const post = await window.riverside?.forum.replyTopic(
      props.post.id,
      composed,
      uploadIds,
      replyToPostNumber
    );
    const cooked = post?.cooked ?? `<p>${escapeHtml(composed)}</p>`;
    topicMessages.value = [
      ...topicMessages.value,
      {
        id: post?.id ?? Date.now(),
        from: "me",
        userId: props.me.id,
        username: props.me.username,
        avatarUrl: props.me.avatarUrl,
        cooked,
        createdAt: post?.created_at ?? new Date().toISOString(),
        postNumber: post?.post_number ?? null,
        replyTo: replyTarget.value
          ? {
              postNumber: replyTarget.value.postNumber,
              username: replyTarget.value.username,
              avatarUrl: replyTarget.value.avatarUrl,
              excerpt: replyTarget.value.excerpt || null,
            }
          : null,
      },
    ];

    emit("replied", props.post.id);

    draft.value = "";
    attachments.value = [];
    replyTarget.value = null;
    showEmoji.value = false;
    await scrollToBottom();
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    sending.value = false;
  }
};

const openExternal = async () => {
  if (!topicUrl.value) return;
  await window.riverside?.openExternal?.(topicUrl.value);
};

const close = () => emit("close");

onMounted(async () => {
  if (props.post?.id) await scrollToBottom();
});
</script>

<template>
  <div v-if="props.post" class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="close">
    <div
      class="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft"
    >
      <header class="flex items-center gap-3 border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">{{ topicTitle }}</div>
          <div class="mt-0.5 truncate text-xs text-[rgb(var(--rs-text-3))]">
            {{ categoryName ? `板块 · ${categoryName}` : "帖子详情" }}
          </div>
        </div>

        <button
          class="inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold shadow-soft transition"
          :class="
            props.post.liked
              ? 'border-[rgb(var(--accent-500))] bg-[rgb(var(--accent-500)/0.12)] text-[rgb(var(--accent-500))] hover:bg-[rgb(var(--accent-500)/0.16)]'
              : 'border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-[rgb(var(--rs-text-2))] hover:bg-[rgb(var(--rs-hover))]'
          "
          type="button"
          @click="emit('toggleLike', props.post.id)"
        >
          <i class="ri-thumb-up-line text-base" :class="props.post.liked ? '' : 'opacity-60'"></i>
          {{ props.post.liked ? "已赞" : "点赞" }} {{ props.post.likeCount }}
        </button>

        <button
          class="rs-icon-btn h-9 w-9"
          type="button"
          aria-label="Open"
          @click="openExternal"
        >
          <i class="ri-external-link-line"></i>
        </button>

        <button
          class="rs-icon-btn h-9 w-9"
          type="button"
          aria-label="Close"
          @click="close"
        >
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div ref="listRef" class="flex-1 overflow-auto p-4 scrollbar">
        <div v-if="loading" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">正在加载…</div>
        <div v-else-if="topicMessages.length === 0" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">
          暂无内容
        </div>

        <div v-else class="space-y-4">
          <article
            v-for="(m, idx) in topicMessages"
            :key="m.id"
            class="flex items-start gap-3"
            :data-post-number="m.postNumber ?? idx + 1"
          >
            <button class="no-drag mt-0.5" type="button" aria-label="Open user" @click="openUserFromMessage(m)">
              <img
                v-if="m.avatarUrl"
                :src="m.avatarUrl"
                class="h-10 w-10 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
                alt="avatar"
                referrerpolicy="no-referrer"
                @error="onAvatarImgError"
              />
              <div
                v-else
                class="grid h-10 w-10 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
              >
                {{ (m.username || "RS").slice(0, 2) }}
              </div>
            </button>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <button
                  class="no-drag truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)] hover:underline"
                  type="button"
                  @click="openUserFromMessage(m)"
                >
                  {{ m.username || "River Side" }}
                </button>
                <div class="text-xs text-[rgb(var(--rs-text-3))]">{{ formatTime(m.createdAt) }}</div>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    v-if="m.from !== 'system'"
                    class="rs-icon-btn h-7 w-7"
                    type="button"
                    aria-label="Reply"
                    @click="startReply(m, idx + 1)"
                  >
                    <i class="ri-reply-line"></i>
                  </button>
                  <button
                    v-if="m.from !== 'system'"
                    class="rs-icon-btn h-7 w-7"
                    type="button"
                    aria-label="Mention"
                    @click="mentionUser(m.username)"
                  >
                    <i class="ri-at-line"></i>
                  </button>
                  <div class="text-xs text-[rgb(var(--rs-text-3))]">#{{ m.postNumber ?? idx + 1 }}</div>
                </div>
              </div>

              <button
                v-if="m.replyTo?.username"
                class="no-drag mt-2 w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-3 text-left text-xs text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))]"
                type="button"
                @click="m.replyTo?.postNumber ? scrollToPostNumber(m.replyTo.postNumber) : undefined"
              >
                <div class="flex items-center gap-2">
                  <i class="ri-corner-down-right-line text-base opacity-70"></i>
                  <img
                    v-if="m.replyTo.avatarUrl"
                    :src="m.replyTo.avatarUrl"
                    class="h-5 w-5 rounded-full border border-[rgb(var(--rs-border))] object-cover"
                    alt="replied"
                    referrerpolicy="no-referrer"
                    @error="onAvatarImgError"
                  />
                  <div class="truncate">
                    回复 <span class="font-semibold text-[rgb(var(--rs-text)/0.92)]">@{{ m.replyTo.username }}</span>
                    <span v-if="m.replyTo.postNumber" class="text-[rgb(var(--rs-text-3))]"> · #{{ m.replyTo.postNumber }}</span>
                  </div>
                </div>
                <div
                  v-if="m.replyTo.excerpt"
                  class="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-[rgb(var(--rs-text-3))]"
                >
                  {{ m.replyTo.excerpt }}
                </div>
              </button>

              <div
                class="mt-2 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-3 text-[15px] leading-relaxed text-[rgb(var(--rs-text))]"
              >
                <RichText class="topic-cooked" :html="m.cooked" @click="onCookedClick" />
              </div>
            </div>
          </article>
        </div>
      </div>

      <footer class="border-t border-[rgb(var(--rs-border))] p-3">
        <div v-if="attachments.length" class="mb-2 flex flex-wrap gap-2">
          <div
            v-for="a in attachments"
            :key="a.id"
            class="flex items-center gap-2 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-2 text-xs text-[rgb(var(--rs-text-2))]"
          >
            <img
              v-if="a.status === 'ready' && a.url"
              :src="a.url"
              class="h-10 w-10 rounded-xl border border-[rgb(var(--rs-border))] object-cover"
              alt="attachment"
            />
            <div
              v-else
              class="grid h-10 w-10 place-items-center rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-[rgb(var(--rs-text-3))]"
            >
              <i v-if="a.status === 'uploading'" class="ri-loader-4-line animate-spin"></i>
              <i v-else-if="a.status === 'error'" class="ri-close-circle-line text-rose-300"></i>
              <i v-else class="ri-image-line"></i>
            </div>

            <div class="min-w-0">
              <div class="max-w-[220px] truncate text-[11px] text-[rgb(var(--rs-text-2))]">{{ a.fileName }}</div>
              <div v-if="a.status === 'uploading'" class="text-[11px] text-[rgb(var(--rs-text-3))]">上传中…</div>
              <div v-else-if="a.status === 'error'" class="max-w-[260px] truncate text-[11px] text-rose-200/80">
                {{ a.error || "上传失败" }}
              </div>
              <div v-else class="text-[11px] text-emerald-200/70">已添加</div>
            </div>

            <button
              class="ml-1 grid h-8 w-8 place-items-center rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))]"
              type="button"
              aria-label="Remove"
              @click="removeAttachment(a.id)"
            >
              <i class="ri-close-line"></i>
            </button>
          </div>
        </div>

        <div
          v-if="replyTarget"
          class="no-drag mb-2 flex items-center gap-2 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-xs text-[rgb(var(--rs-text-2))]"
        >
          <i class="ri-reply-line text-base opacity-70"></i>
          <img
            v-if="replyTarget.avatarUrl"
            :src="replyTarget.avatarUrl"
            class="h-6 w-6 rounded-full border border-[rgb(var(--rs-border))] object-cover"
            alt="replied"
            referrerpolicy="no-referrer"
            @error="onAvatarImgError"
          />
          <button
            class="no-drag min-w-0 flex-1 truncate text-left hover:underline"
            type="button"
            @click="scrollToPostNumber(replyTarget.postNumber)"
          >
            回复 <span class="font-semibold text-[rgb(var(--rs-text)/0.92)]">@{{ replyTarget.username }}</span>
            <span class="text-[rgb(var(--rs-text-3))]"> · #{{ replyTarget.postNumber }}</span>
          </button>
          <button class="rs-icon-btn h-8 w-8" type="button" aria-label="Cancel reply" @click="clearReply">
            <i class="ri-close-line"></i>
          </button>
        </div>

        <div class="flex items-end gap-2">
          <div class="flex items-center gap-1">
            <button
              ref="emojiButtonRef"
              class="rs-icon-btn h-10 w-10"
              type="button"
              aria-label="Emoji"
              @click="toggleEmoji"
            >
              <i class="ri-emotion-line text-lg"></i>
            </button>
            <button
              class="rs-icon-btn h-10 w-10 disabled:opacity-40"
              type="button"
              aria-label="Attach images"
              :disabled="uploadingCount > 0"
              @click="attachImages"
            >
              <i class="ri-image-add-line text-lg"></i>
            </button>
          </div>

          <div class="relative flex-1">
            <div
              v-if="mentionOpen"
              ref="mentionPopoverRef"
              class="absolute bottom-full left-0 z-20 mb-2 w-[332px] overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft"
            >
              <div class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-3 py-2">
                <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">艾特</div>
                <button class="rs-icon-btn h-7 w-7" type="button" aria-label="Close" @click="closeMention">
                  <i class="ri-close-line"></i>
                </button>
              </div>

              <div class="max-h-[260px] overflow-auto p-2 scrollbar">
                <div v-if="mentionTerm.trim().length === 0" class="px-2 py-2 text-xs text-[rgb(var(--rs-text-3))]">
                  输入用户 ID 进行搜索（例如：<span class="font-semibold text-[rgb(var(--rs-text-2))]">@xiaoyanw</span>）
                </div>

                <div v-else-if="mentionLoading" class="px-2 py-2 text-xs text-[rgb(var(--rs-text-3))]">搜索中…</div>

                <div
                  v-else-if="mentionHits.length === 0"
                  class="px-2 py-2 text-xs text-[rgb(var(--rs-text-3))]"
                >
                  没有找到用户
                </div>

                <button
                  v-for="(u, idx) in mentionHits"
                  :key="`mention-${u.id}-${u.username}`"
                  class="no-drag flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-left transition hover:border-[rgb(var(--rs-border))] hover:bg-[rgb(var(--rs-hover))]"
                  :class="idx === mentionIndex ? 'rs-selected' : ''"
                  type="button"
                  @mousedown.prevent="selectMention(u)"
                  @mouseenter="mentionIndex = idx"
                >
                  <img
                    v-if="u.avatarUrl"
                    :src="u.avatarUrl"
                    class="h-9 w-9 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
                    alt="avatar"
                    referrerpolicy="no-referrer"
                    @error="onAvatarImgError"
                  />
                  <div
                    v-else
                    class="grid h-9 w-9 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
                  >
                    {{ (u.username || "RS").slice(0, 2) }}
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
                        {{ u.name || u.username }}
                      </div>
                      <div class="truncate text-xs text-[rgb(var(--rs-text-3))]">@{{ u.username }}</div>
                    </div>
                    <div class="text-[11px] text-[rgb(var(--rs-text-3))]">#{{ u.id }}</div>
                  </div>
                </button>
              </div>
            </div>

            <div
              v-if="showEmoji"
              ref="emojiPopoverRef"
              class="absolute bottom-full left-0 z-10 mb-2 w-[316px] rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-2 shadow-soft"
            >
              <div class="flex items-center gap-2">
                <select
                  v-model="emojiPackId"
                  class="no-drag w-full max-w-[200px] rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-1 text-xs text-[rgb(var(--rs-text))] focus:outline-none"
                  aria-label="Emoji group"
                >
                  <option v-for="p in emojiPacks" :key="p.id" :value="p.id">
                    {{ p.title }} ({{ p.emojis.length }})
                  </option>
                </select>
                <div class="ml-auto text-xs text-[rgb(var(--rs-text-3))]">
                  {{ emojiPageSafe + 1 }} / {{ emojiPageCount }}
                </div>
              </div>

              <div class="mt-2 flex items-center gap-2">
                <input
                  v-model="emojiQuery"
                  class="no-drag w-full rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-1 text-xs text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
                  placeholder="搜索表情…"
                />
                <button
                  v-if="emojiQuery.trim().length"
                  class="rs-icon-btn h-8 w-8"
                  type="button"
                  aria-label="Clear emoji search"
                  @click="emojiQuery = ''"
                >
                  <i class="ri-close-line"></i>
                </button>
              </div>

              <div
                v-if="emojiLoading"
                class="grid place-items-center py-8 text-xs text-[rgb(var(--rs-text-3))]"
              >
                加载表情…
              </div>
              <div
                v-else-if="activeEmojis.length === 0"
                class="grid place-items-center py-8 text-xs text-[rgb(var(--rs-text-3))]"
              >
                暂无表情
              </div>
              <div v-else class="grid grid-cols-6 gap-1">
                <button
                  v-for="e in pagedEmojis"
                  :key="e.name"
                  class="grid h-11 w-11 place-items-center rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] transition hover:bg-[rgb(var(--rs-hover))]"
                  type="button"
                  :title="`:${e.name}:`"
                  @click="appendEmoji(e)"
                >
                  <img :src="e.url" class="h-9 w-9 object-contain" :alt="`:${e.name}:`" loading="lazy" />
                </button>
              </div>

              <div class="mt-2 flex items-center justify-between gap-2">
                <button class="rs-icon-btn h-8 w-8" type="button" aria-label="Prev" @click="prevEmojiPage">
                  <i class="ri-arrow-left-s-line"></i>
                </button>
                <button class="rs-icon-btn h-8 w-8" type="button" aria-label="Next" @click="nextEmojiPage">
                  <i class="ri-arrow-right-s-line"></i>
                </button>
              </div>
            </div>

            <textarea
              ref="textareaRef"
              v-model="draft"
              class="scrollbar max-h-28 min-h-12 w-full resize-none rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-4 py-3 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
              placeholder="写评论…（Enter 发送，Shift+Enter 换行）"
              @keydown="onTextareaKeydownAll"
              @input="scheduleMentionSearch"
              @keyup="scheduleMentionSearch"
              @click="scheduleMentionSearch"
              @paste="onPaste"
            ></textarea>
          </div>

          <button
            class="h-12 rounded-2xl bg-[rgb(var(--accent-500))] px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-40"
            type="button"
            :disabled="!canSend"
            @click="sendNow"
          >
            发送
          </button>
        </div>

        <div v-if="error" class="mt-2 text-xs text-rose-200/80">{{ error }}</div>
      </footer>
    </div>

    <div
      v-if="lightboxUrl"
      class="no-drag absolute inset-0 z-[60] grid place-items-center bg-black/75 p-6"
      @click.self="lightboxUrl = null"
    >
      <div class="relative w-full max-w-5xl">
        <button
          class="absolute -top-3 right-0 grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/40 text-white/80 transition hover:bg-white/10"
          type="button"
          aria-label="Close"
          @click="lightboxUrl = null"
        >
          <i class="ri-close-line text-xl"></i>
        </button>
        <img
          :src="lightboxUrl"
          class="max-h-[82vh] w-full rounded-2xl border border-white/10 bg-black/20 object-contain shadow-soft"
          alt="preview"
        />
      </div>
    </div>
  </div>
</template>
