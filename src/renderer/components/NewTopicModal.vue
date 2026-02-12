<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { BrowseCategory, ForumEmoji } from "@/data/forum";

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

type CategoryOption = {
  id: number;
  label: string;
  disabled: boolean;
};

const props = defineProps<{
  categories: BrowseCategory[];
  initialCategoryId?: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "posted", payload: { topicId?: number | null; url?: string | null }): void;
}>();

const loading = ref(false);
const error = ref<string | null>(null);

const categoryId = ref<number | null>(props.initialCategoryId ?? null);
const title = ref("");
const raw = ref("");

const showEmoji = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const attachments = ref<Attachment[]>([]);

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

const toggleEmoji = () => {
  showEmoji.value = !showEmoji.value;
  if (showEmoji.value && emojiAll.value.length === 0) void loadEmojis();
};

watch([emojiPackId, emojiQuery], () => {
  emojiPage.value = 0;
});

const categoryIndex = computed(() => {
  const sorted = [...props.categories].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const byId = new Map<number, BrowseCategory>();
  const children = new Map<number | null, BrowseCategory[]>();
  for (const c of sorted) byId.set(c.id, c);

  for (const c of sorted) {
    const pid = typeof c.parentId === "number" ? c.parentId : null;
    const arr = children.get(pid) || [];
    arr.push(c);
    children.set(pid, arr);
  }

  for (const [pid, arr] of children) {
    arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    children.set(pid, arr);
  }

  const getPathName = (cat: BrowseCategory) => {
    const parts: string[] = [];
    const seen = new Set<number>();
    let cur: BrowseCategory | undefined = cat;
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      parts.unshift(cur.name);
      const parentId: number | null = typeof cur.parentId === "number" ? cur.parentId : null;
      cur = parentId != null ? byId.get(parentId) : undefined;
    }
    return parts.join(" / ");
  };

  const hasChildren = (id: number) => (children.get(id) || []).length > 0;

  const options: CategoryOption[] = [];
  const roots = children.get(null) || [];
  const walk = (cat: BrowseCategory) => {
    options.push({
      id: cat.id,
      label: getPathName(cat) || cat.name,
      disabled: hasChildren(cat.id) || cat.permission !== 1,
    });
    for (const child of children.get(cat.id) || []) walk(child);
  };
  for (const root of roots) walk(root);

  return { byId, children, options };
});

const categoryOptions = computed(() => categoryIndex.value.options);
const disabledCategoryIds = computed(
  () => new Set(categoryOptions.value.filter((o) => o.disabled).map((o) => o.id))
);
const firstSelectableCategoryId = computed(
  () => categoryOptions.value.find((o) => !o.disabled)?.id ?? null
);

const resolveLeafCategoryId = (id: number) => {
  const { byId, children } = categoryIndex.value;
  if (!byId.has(id)) return null;

  const seen = new Set<number>();
  const dfs = (cid: number): number | null => {
    if (seen.has(cid)) return null;
    seen.add(cid);
    const cat = byId.get(cid);
    if (!cat) return null;
    const kids = children.get(cid) || [];
    if (kids.length === 0) return cat.permission === 1 ? cid : null;
    for (const child of kids) {
      const next = dfs(child.id);
      if (typeof next === "number") return next;
    }
    return null;
  };

  return dfs(id);
};

watch(
  () => [props.initialCategoryId ?? null, categoryOptions.value.length] as const,
  () => {
    if (props.initialCategoryId != null) {
      const n = Number(props.initialCategoryId);
      if (Number.isFinite(n)) {
        const leaf = resolveLeafCategoryId(n);
        if (leaf != null && !disabledCategoryIds.value.has(leaf)) {
          categoryId.value = leaf;
          return;
        }
      }
    }

    if (categoryOptions.value.length === 0) return;

    const current = categoryId.value;
    if (current == null) {
      categoryId.value = firstSelectableCategoryId.value;
      return;
    }

    if (!categoryIndex.value.byId.has(current) || disabledCategoryIds.value.has(current)) {
      const leaf = resolveLeafCategoryId(current);
      categoryId.value =
        leaf != null && !disabledCategoryIds.value.has(leaf)
          ? leaf
          : firstSelectableCategoryId.value;
    }
  },
  { immediate: true }
);

const uploadingCount = computed(
  () => attachments.value.filter((a) => a.status === "uploading").length
);

const readyAttachments = computed(() =>
  attachments.value.filter((a) => a.status === "ready" && typeof a.uploadId === "number")
);

const canPost = computed(() => {
  const hasTitle = title.value.trim().length > 0;
  const hasCategory = categoryId.value != null;
  const hasText = raw.value.trim().length > 0;
  const hasFiles = readyAttachments.value.length > 0;
  return (
    hasTitle &&
    hasCategory &&
    (hasText || hasFiles) &&
    uploadingCount.value === 0 &&
    !loading.value
  );
});

const insertTextAtCursor = (text: string) => {
  const el = textareaRef.value;
  if (!el) {
    raw.value += text;
    return;
  }

  const start = el.selectionStart ?? raw.value.length;
  const end = el.selectionEnd ?? raw.value.length;
  raw.value = raw.value.slice(0, start) + text + raw.value.slice(end);
  void nextTick(() => {
    el.focus();
    const nextPos = start + text.length;
    el.selectionStart = nextPos;
    el.selectionEnd = nextPos;
  });
};

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
  const name = `pasted-${Date.now()}.${extFromMime(file.type)}`;
  attachments.value = [
    ...attachments.value,
    { id, filePath: "", fileName: name, status: "uploading" },
  ];

  try {
    const { base64, mimeType } = await fileToBase64(file);
    const res = await window.riverside?.forum.uploadBytes?.({
      dataBase64: base64,
      fileName: name,
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
      a.id === id ? { ...a, status: "error", error: String(e?.message || e) } : a
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

const attachImages = async () => {
  showEmoji.value = false;
  const picker = await window.riverside?.files.pickImages?.();
  if (!picker || picker.canceled) return;

  for (const filePath of picker.filePaths || []) {
    const fileName = filePath.split(/[/\\\\]/).pop() || "image";
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    attachments.value = [
      ...attachments.value,
      { id, filePath, fileName, status: "uploading" },
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
        a.id === id ? { ...a, status: "error", error: String(e?.message || e) } : a
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

const postNow = async () => {
  if (!canPost.value) return;

  loading.value = true;
  error.value = null;
  try {
    const uploadIds = readyAttachments.value.map((a) => a.uploadId as number);
    const attachmentLines = readyAttachments.value
      .map((a) => a.shortUrl || a.url)
      .filter(Boolean)
      .map((u) => `![](${u})`);
    const composed = [raw.value.trim(), ...attachmentLines].filter(Boolean).join("\n\n");

    const res = await window.riverside?.forum.createTopic?.({
      title: title.value.trim(),
      raw: composed,
      categoryId: categoryId.value,
      uploadIds,
    });

    emit("posted", { topicId: res?.topicId ?? null, url: res?.url ?? null });
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div class="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">发帖</div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">选择板块 · 支持图片</div>
        </div>
        <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="flex-1 overflow-hidden p-4">
        <div class="flex h-full flex-col gap-3">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label class="space-y-1">
              <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">板块</div>
              <select
                v-model="categoryId"
                class="w-full rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] focus:outline-none"
              >
                <option :value="null" disabled>请选择板块…</option>
                <option
                  v-for="o in categoryOptions"
                  :key="o.id"
                  :value="o.id"
                  :disabled="o.disabled"
                >
                  {{ o.label }}
                </option>
              </select>
            </label>
            <label class="space-y-1">
              <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">标题</div>
              <input
                v-model="title"
                class="w-full rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
                placeholder="写一个清晰的标题…"
                type="text"
              />
            </label>
          </div>

          <label class="flex min-h-0 flex-1 flex-col gap-1">
            <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">内容</div>
            <textarea
              ref="textareaRef"
              v-model="raw"
              class="scrollbar min-h-0 flex-1 resize-none rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
              placeholder="写点什么…（可直接粘贴图片）"
              @paste="onPaste"
            ></textarea>
          </label>

          <div v-if="attachments.length" class="max-h-[160px] overflow-auto scrollbar">
            <div class="flex flex-wrap gap-2">
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
                  <i v-else-if="a.status === 'error'" class="ri-close-circle-line text-rose-400"></i>
                  <i v-else class="ri-image-line"></i>
                </div>

                <div class="min-w-0">
                  <div class="max-w-[220px] truncate text-[11px] text-[rgb(var(--rs-text-2))]">{{ a.fileName }}</div>
                  <div v-if="a.status === 'uploading'" class="text-[11px] text-[rgb(var(--rs-text-3))]">上传中…</div>
                  <div v-else-if="a.status === 'error'" class="max-w-[260px] truncate text-[11px] text-rose-700">
                    {{ a.error || "上传失败" }}
                  </div>
                  <div v-else class="text-[11px] text-emerald-600/90">已添加</div>
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
          </div>

          <div v-if="error" class="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700">
            {{ error }}
          </div>
        </div>
      </div>

      <footer class="border-t border-[rgb(var(--rs-border))] p-3">
        <div class="flex items-end gap-2">
          <div class="flex items-center gap-1">
            <button class="rs-icon-btn h-10 w-10" type="button" aria-label="Emoji" @click="toggleEmoji">
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
              v-if="showEmoji"
              class="absolute bottom-12 left-0 z-10 w-[316px] rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-2 shadow-soft"
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
          </div>

          <button
            class="h-12 rounded-2xl bg-[rgb(var(--accent-500))] px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-40"
            type="button"
            :disabled="!canPost"
            @click="postNow"
          >
            {{ loading ? "发布中…" : "发布" }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>
