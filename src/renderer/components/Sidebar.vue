<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { BrowseCategory, ChatChannel, ForumUser } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

type Section = "chat" | "discover";
type SiteMode = "new" | "old" | "both";

const props = defineProps<{
  me: ForumUser;
  section: Section;
  siteMode: SiteMode;
  legacyLoggedIn?: boolean;
  channels: ChatChannel[];
  selectedChannelId: number | null;
  categories: BrowseCategory[];
  selectedCategoryId: number | null;
}>();

const emit = defineEmits<{
  (e: "update:section", section: Section): void;
  (e: "update:siteMode", mode: SiteMode): void;
  (e: "selectChannel", channelId: number): void;
  (e: "selectCategory", categoryId: number | null): void;
  (e: "openSettings"): void;
  (e: "startChatWithUser", payload: { username: string; userId?: number | null; source?: "discourse" | "discuz" }): void;
  (e: "openLegacyLogin"): void;
}>();

const query = ref("");
const userHits = ref<ForumUser[]>([]);
const userLoading = ref(false);
let userSearchTimer: number | null = null;

const PINNED_KEY = "riverside.pinnedChannels";

const loadPinned = () => {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === "number");
  } catch {
    return [];
  }
};

const pinnedChannelIds = ref<number[]>(loadPinned());

watch(
  pinnedChannelIds,
  (val) => {
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(val));
    } catch {
      // ignore
    }
  },
  { deep: true }
);

const pinnedSet = computed(() => new Set(pinnedChannelIds.value));

const togglePin = (channelId: number) => {
  if (pinnedSet.value.has(channelId)) {
    pinnedChannelIds.value = pinnedChannelIds.value.filter((id) => id !== channelId);
    return;
  }
  pinnedChannelIds.value = [channelId, ...pinnedChannelIds.value];
};

const filteredChannels = computed(() => {
  const q = query.value.trim().toLowerCase();
  const isLegacy = (c: ChatChannel) =>
    (c as any)?.source === "discuz" || (c as any)?.legacy?.source === "discuz" || c.id < 0;

  const list = [...props.channels].filter((c) => {
    if (props.siteMode === "both") return true;
    if (props.siteMode === "old") return isLegacy(c);
    return !isLegacy(c);
  });
  const filtered = !q
    ? list
    : list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.lastMessagePreview.toLowerCase().includes(q) ||
          c.participants.some(
            (p) =>
              p.username.toLowerCase().includes(q) ||
              (p.name || "").toLowerCase().includes(q)
          )
      );

  return filtered.sort((a, b) => {
    const pa = pinnedSet.value.has(a.id) ? 1 : 0;
    const pb = pinnedSet.value.has(b.id) ? 1 : 0;
    if (pa !== pb) return pb - pa;

    const ua = a.unread > 0 ? 1 : 0;
    const ub = b.unread > 0 ? 1 : 0;
    if (ua !== ub) return ub - ua;

    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return tb - ta;
  });
});

const childrenByParent = computed(() => {
  const map = new Map<number | null, BrowseCategory[]>();
  for (const c of props.categories || []) {
    const pid = (c as any)?.parentId ?? null;
    const list = map.get(pid) || [];
    list.push(c);
    map.set(pid, list);
  }
  for (const [k, list] of map.entries()) {
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    map.set(k, list);
  }
  return map;
});

const hasChildren = (catId: number) => (childrenByParent.value.get(catId) || []).length > 0;

const expandedCategoryIds = ref<Set<number>>(new Set());

const toggleExpanded = (catId: number) => {
  if (!hasChildren(catId)) return;
  const next = new Set(expandedCategoryIds.value);
  if (next.has(catId)) next.delete(catId);
  else next.add(catId);
  expandedCategoryIds.value = next;
};

const expandAncestors = (catId: number | null) => {
  if (catId == null) return;
  const byId = new Map(props.categories.map((c) => [c.id, c] as const));
  let cur = byId.get(catId) || null;
  const next = new Set(expandedCategoryIds.value);
  while (cur && cur.parentId != null) {
    const pid: number = Number(cur.parentId);
    if (!Number.isFinite(pid)) break;
    next.add(pid);
    cur = byId.get(pid) || null;
  }
  expandedCategoryIds.value = next;
};

watch(
  () => [props.selectedCategoryId, props.categories.length] as const,
  ([id]) => expandAncestors(id),
  { immediate: true }
);

type FlatCat = { cat: BrowseCategory; depth: number; hasChildren: boolean };

const flatBrowseCategories = computed<FlatCat[]>(() => {
  const q = query.value.trim().toLowerCase();
  const list: FlatCat[] = [];

  const matches = (c: BrowseCategory) => {
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q)
    );
  };

  let allowed: Set<number> | null = null;
  if (q) {
    allowed = new Set<number>();
    const byId = new Map(props.categories.map((c) => [c.id, c] as const));
    for (const c of props.categories) {
      if (!matches(c)) continue;
      allowed.add(c.id);
      let cur: BrowseCategory | null = c;
      while (cur && cur.parentId != null) {
        const parentId: number = Number(cur.parentId);
        if (!Number.isFinite(parentId)) break;
        allowed.add(parentId);
        cur = byId.get(parentId) || null;
      }
    }
  }

  const walk = (parentId: number | null, depth: number) => {
    const kids = childrenByParent.value.get(parentId) || [];
    for (const c of kids) {
      if (allowed && !allowed.has(c.id)) continue;
      const childHasChildren = hasChildren(c.id);
      list.push({ cat: c, depth, hasChildren: childHasChildren });
      const shouldExpand = q ? true : expandedCategoryIds.value.has(c.id);
      if (childHasChildren && shouldExpand) walk(c.id, depth + 1);
    }
  };

  walk(null, 0);
  return list;
});

const initials = (name: string) => name.slice(0, 2);

const formatTime = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
};

const searchPlaceholder = computed(() =>
  props.section === "chat" ? "搜索会话 / 用户ID…" : "搜索分类…"
);

const runUserSearch = async () => {
  if (props.section !== "chat") {
    userHits.value = [];
    userLoading.value = false;
    return;
  }

  const q = query.value.trim();
  if (!q) {
    userHits.value = [];
    userLoading.value = false;
    return;
  }

  userLoading.value = true;
  try {
    const wantDiscourse = props.siteMode !== "old";
    const wantLegacy = props.siteMode !== "new" && !!props.legacyLoggedIn;

    const [a, b] = await Promise.all([
      wantDiscourse ? window.riverside?.forum.searchUsers?.({ term: q, limit: 8 }) : Promise.resolve(null),
      wantLegacy ? window.riverside?.legacy.searchUsers?.({ term: q, limit: 8 }) : Promise.resolve(null),
    ]);

    const listA = Array.isArray((a as any)?.users) ? ((a as any).users as ForumUser[]) : [];
    const listB = Array.isArray((b as any)?.users) ? ((b as any).users as ForumUser[]) : [];

    const taggedA = listA
      .map((u) => (u ? ({ ...u, source: "discourse" as const } as ForumUser) : null))
      .filter(Boolean) as ForumUser[];
    const taggedB = listB
      .map((u) => (u ? ({ ...u, source: "discuz" as const } as ForumUser) : null))
      .filter(Boolean) as ForumUser[];

    const dedup = new Map<string, ForumUser>();
    for (const u of [...taggedA, ...taggedB]) {
      if (!u?.username) continue;
      const key = `${String((u as any).source || "discourse")}:${u.username.toLowerCase()}`;
      if (u.username.toLowerCase() === props.me.username.toLowerCase()) continue;
      if (!dedup.has(key)) dedup.set(key, u);
    }
    userHits.value = Array.from(dedup.values()).slice(0, 8);
  } catch {
    userHits.value = [];
  } finally {
    userLoading.value = false;
  }
};

watch(
  () => [query.value, props.section] as const,
  () => {
    if (userSearchTimer != null) window.clearTimeout(userSearchTimer);
    userSearchTimer = window.setTimeout(() => void runUserSearch(), 260);
  }
);
</script>

<template>
  <aside class="flex h-full w-[340px] flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
    <div class="no-drag flex items-center gap-3 p-4">
      <div class="relative">
        <img
          v-if="me.avatarUrl"
          :src="me.avatarUrl"
          class="h-10 w-10 rounded-xl object-cover"
          alt="me"
          referrerpolicy="no-referrer"
          @error="onAvatarImgError"
        />
        <div
          v-else
          class="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[rgb(var(--accent-500))] to-[rgb(var(--accent-2))] text-sm font-semibold text-white shadow-soft"
        >
          {{ initials(me.username) }}
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
          {{ me.name || me.username }}
        </div>
        <div class="truncate text-xs text-[rgb(var(--rs-text-3))]">
          {{ section === "chat" ? "聊天" : "发现" }}
        </div>
      </div>

      <div class="flex items-center gap-1">
        <button
          class="rs-icon-btn h-10 w-10"
          :class="section === 'chat' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          aria-label="Chats"
          @click="emit('update:section', 'chat')"
        >
          <i class="ri-chat-3-line text-lg"></i>
        </button>
        <button
          class="rs-icon-btn h-10 w-10"
          :class="section === 'discover' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          aria-label="Discover"
          @click="emit('update:section', 'discover')"
        >
          <i class="ri-compass-3-line text-lg"></i>
        </button>
        <button
          class="rs-icon-btn h-10 w-10"
          type="button"
          aria-label="Settings"
          @click="emit('openSettings')"
        >
          <i class="ri-settings-3-line text-lg"></i>
        </button>
      </div>
    </div>

    <div class="no-drag px-4 pb-3">
      <div class="flex items-center justify-between gap-2 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-1">
        <button
          class="rs-btn flex-1 rounded-lg px-3 py-2 text-xs"
          :class="siteMode === 'new' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="emit('update:siteMode', 'new')"
        >
          新论坛
        </button>
        <button
          class="rs-btn flex-1 rounded-lg px-3 py-2 text-xs"
          :class="siteMode === 'old' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="emit('update:siteMode', 'old')"
        >
          旧论坛
        </button>
        <button
          class="rs-btn flex-1 rounded-lg px-3 py-2 text-xs"
          :class="siteMode === 'both' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="emit('update:siteMode', 'both')"
        >
          混合
        </button>
      </div>

      <div
        v-if="siteMode !== 'new' || !legacyLoggedIn"
        class="mt-2 flex items-center justify-between gap-2 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-3 py-2 text-xs text-[rgb(var(--rs-text-2))]"
      >
        <div class="flex items-center gap-2">
          <span
            class="h-2 w-2 rounded-full"
            :class="legacyLoggedIn ? 'bg-emerald-400' : 'bg-rose-400'"
          ></span>
          <span>{{ legacyLoggedIn ? "旧版已登录" : "旧版未登录" }}</span>
        </div>

        <button
          v-if="!legacyLoggedIn"
          class="rounded-lg bg-[rgb(var(--accent-500))] px-3 py-1.5 text-xs font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))]"
          type="button"
          @click="emit('openLegacyLogin')"
        >
          登录旧版
        </button>
      </div>
    </div>

    <div class="no-drag px-4 pb-3">
      <label class="flex items-center gap-2 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-[rgb(var(--rs-text-2))]">
        <i class="ri-search-2-line"></i>
        <input
          v-model="query"
          class="w-full bg-transparent text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
          :placeholder="searchPlaceholder"
          type="text"
        />
      </label>
    </div>

    <div class="flex-1 overflow-auto p-2 scrollbar">
      <div v-if="section === 'chat'" class="space-y-1">
        <div v-if="query.trim().length > 0" class="px-3 pb-2 pt-1 text-xs font-semibold text-[rgb(var(--rs-text-3))]">
          用户
          <span v-if="userLoading" class="ml-2 font-normal opacity-70">搜索中…</span>
        </div>

        <button
          v-for="u in userHits"
          :key="`user-${u.id}-${u.username}`"
          class="no-drag flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-[rgb(var(--rs-border))] hover:bg-[rgb(var(--rs-hover))]"
          type="button"
          @click="emit('startChatWithUser', { username: u.username, userId: u.id, source: (u as any).source || 'discourse' })"
        >
          <img
            v-if="u.avatarUrl"
            :src="u.avatarUrl"
            class="h-11 w-11 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
            alt="avatar"
            referrerpolicy="no-referrer"
            @error="onAvatarImgError"
          />
          <div
            v-else
            class="grid h-11 w-11 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
          >
            {{ initials(u.username) }}
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
                {{ u.name || u.username }}
              </div>
              <span
                v-if="(u as any).source === 'discuz'"
                class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
              >
                旧
              </span>
              <div class="truncate text-xs text-[rgb(var(--rs-text-3))]">@{{ u.username }}</div>
            </div>
            <div v-if="u.title" class="truncate text-xs text-[rgb(var(--rs-text-3))]">{{ u.title }}</div>
            <div v-else class="truncate text-xs text-[rgb(var(--rs-text-3))]">发起私聊</div>
          </div>

          <div class="text-[11px] text-[rgb(var(--rs-text-3))]">#{{ u.id }}</div>
        </button>

        <div v-if="userHits.length > 0" class="my-2 border-t border-[rgb(var(--rs-border))]"></div>

        <button
          v-for="c in filteredChannels"
          :key="c.id"
          class="no-drag flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-[rgb(var(--rs-border))] hover:bg-[rgb(var(--rs-hover))]"
          :class="c.id === selectedChannelId ? 'rs-selected' : ''"
          type="button"
          @click="emit('selectChannel', c.id)"
        >
          <div class="relative">
            <img
              v-if="c.kind === 'dm' && c.avatarUrl"
              :src="c.avatarUrl"
              class="h-11 w-11 rounded-2xl object-cover"
              alt="avatar"
              referrerpolicy="no-referrer"
              @error="onAvatarImgError"
            />
            <div
              v-else
              class="grid h-11 w-11 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
            >
              <i v-if="c.kind === 'public'" class="ri-hashtag text-lg opacity-80"></i>
              <span v-else>{{ initials(c.title) }}</span>
            </div>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
                {{ c.title }}
              </div>
              <span
                v-if="(c as any).source === 'discuz' || (c as any).legacy?.source === 'discuz' || c.id < 0"
                class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
              >
                旧
              </span>
              <span
                v-if="c.kind === 'public'"
                class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
              >
                频道
              </span>
              <span
                v-if="c.isGroup"
                class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
              >
                群聊
              </span>
            </div>
            <div class="truncate text-xs text-[rgb(var(--rs-text-3))]">
              {{ c.lastMessagePreview || c.description || (c.kind === "public" ? "公开频道" : "私聊") }}
            </div>
          </div>

          <div class="flex flex-col items-end gap-2">
            <div class="flex items-center gap-2">
              <div class="text-[11px] text-[rgb(var(--rs-text-3))]">{{ formatTime(c.lastMessageAt || "") }}</div>
              <button
                class="grid h-7 w-7 place-items-center rounded-lg border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-[rgb(var(--rs-text-3))] transition hover:bg-[rgb(var(--rs-hover))]"
                type="button"
                aria-label="Pin"
                @click.stop="togglePin(c.id)"
              >
                <i
                  :class="pinnedSet.has(c.id) ? 'ri-pushpin-fill text-[rgb(var(--rs-text)/0.9)]' : 'ri-pushpin-line opacity-50'"
                ></i>
              </button>
            </div>
            <div
              v-if="c.unread > 0"
              class="grid min-w-6 place-items-center rounded-full bg-[rgb(var(--accent-500))] px-2 py-0.5 text-[11px] font-semibold text-white shadow-soft"
            >
              {{ c.unread > 99 ? "99+" : c.unread }}
            </div>
          </div>
        </button>
      </div>

      <div v-else class="space-y-1">
        <button
          class="no-drag flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-[rgb(var(--rs-border))] hover:bg-[rgb(var(--rs-hover))]"
          :class="selectedCategoryId == null ? 'rs-selected' : ''"
          type="button"
          @click="emit('selectCategory', null)"
        >
          <div
            class="grid h-11 w-11 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
          >
            <i class="ri-time-line text-lg opacity-80"></i>
          </div>

          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">最新</div>
            <div class="truncate text-xs text-[rgb(var(--rs-text-3))]">全站动态</div>
          </div>
        </button>

        <div class="px-3 pt-3 text-xs font-semibold tracking-wide text-[rgb(var(--rs-text-3))]">分类</div>

        <button
          v-for="row in flatBrowseCategories"
          :key="row.cat.id"
          class="no-drag flex w-full items-center gap-3 rounded-2xl border border-transparent pr-3 py-3 text-left transition hover:border-[rgb(var(--rs-border))] hover:bg-[rgb(var(--rs-hover))]"
          :class="row.cat.id === selectedCategoryId ? 'rs-selected' : ''"
          type="button"
          :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
          @click="emit('selectCategory', row.cat.id)"
        >
          <div class="flex items-center gap-2">
            <div
              v-if="row.hasChildren"
              class="grid h-7 w-7 place-items-center rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-[rgb(var(--rs-text-3))] transition hover:bg-[rgb(var(--rs-hover))]"
              role="button"
              @click.stop="toggleExpanded(row.cat.id)"
            >
              <i
                class="ri-arrow-right-s-line transition-transform"
                :class="expandedCategoryIds.has(row.cat.id) ? 'rotate-90' : ''"
              ></i>
            </div>

            <div
              class="grid h-11 w-11 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-[rgb(var(--rs-text-2))]"
              :style="
                row.cat.color
                  ? {
                      borderColor: `#${row.cat.color}55`,
                      backgroundColor: `#${row.cat.color}12`,
                    }
                  : undefined
              "
            >
              <span
                class="h-3 w-3 rounded-sm"
                :style="row.cat.color ? { backgroundColor: `#${row.cat.color}` } : undefined"
              ></span>
            </div>
          </div>

          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
              {{ row.cat.name }}
            </div>
            <div class="truncate text-xs text-[rgb(var(--rs-text-3))]">
              {{ row.cat.description || "分类帖子" }}
            </div>
          </div>
        </button>
      </div>
    </div>

    <div class="no-drag border-t border-[rgb(var(--rs-border))] p-3">
      <div class="flex items-center justify-between rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2">
        <div class="flex items-center gap-2 text-xs text-[rgb(var(--rs-text-2))]">
          <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
          <span>在线</span>
        </div>
        <div class="text-xs text-[rgb(var(--rs-text-3))]">river-side.cc</div>
      </div>
    </div>
  </aside>
</template>
