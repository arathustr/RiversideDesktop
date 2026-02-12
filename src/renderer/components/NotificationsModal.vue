<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ForumNotification } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

const props = defineProps<{
  notifications: ForumNotification[];
  loading?: boolean;
  error?: string | null;
  siteMode?: "new" | "old" | "both";
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "refresh"): void;
  (e: "markAllRead"): void;
  (e: "open", n: ForumNotification): void;
}>();

type Filter = "all" | "mention" | "reply";
const filter = ref<Filter>("all");
const unreadOnly = ref(true);
type SourceFilter = "all" | "new" | "old";
const sourceFilter = ref<SourceFilter>(
  props.siteMode === "new" ? "new" : props.siteMode === "old" ? "old" : "all"
);

watch(
  () => props.siteMode,
  (next) => {
    sourceFilter.value = next === "new" ? "new" : next === "old" ? "old" : "all";
  }
);

const formatTime = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
};

const unreadCount = computed(() => props.notifications.filter((n) => !n.read).length);

const filtered = computed(() => {
  let list = Array.isArray(props.notifications) ? props.notifications : [];
  if (filter.value !== "all") list = list.filter((n) => n.kind === filter.value);
  if (sourceFilter.value === "new") list = list.filter((n) => (n as any)?.source !== "discuz");
  if (sourceFilter.value === "old") list = list.filter((n) => (n as any)?.source === "discuz");
  if (unreadOnly.value) list = list.filter((n) => !n.read);
  return [...list].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
});

const kindIcon = (kind: ForumNotification["kind"]) => {
  if (kind === "mention") return "ri-at-line";
  if (kind === "reply") return "ri-reply-line";
  return "ri-notification-3-line";
};

const kindLabel = (kind: ForumNotification["kind"]) => {
  if (kind === "mention") return "提及你";
  if (kind === "reply") return "回复了你";
  return "通知";
};

const sourceLabel = (n: ForumNotification) => (n.chatChannelId ? "聊天" : n.topicId ? "论坛" : "");
const sourceSiteLabel = (n: ForumNotification) => ((n as any)?.source === "discuz" ? "旧版" : "新版");
</script>

<template>
  <div class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div
      class="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft"
    >
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">通知</div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">
            <span v-if="unreadCount">未读 {{ unreadCount }}</span>
            <span v-else>暂无未读</span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Refresh" @click="emit('refresh')">
            <i class="ri-refresh-line"></i>
          </button>
          <button
            class="rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))] disabled:opacity-40"
            type="button"
            :disabled="unreadCount === 0"
            @click="emit('markAllRead')"
          >
            全部已读
          </button>
          <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
            <i class="ri-close-line text-lg"></i>
          </button>
        </div>
      </header>

      <div class="border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-1 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-1">
            <button
              class="rounded-xl px-3 py-1 text-xs transition"
              :class="filter === 'all' ? 'rs-selected' : 'text-[rgb(var(--rs-text-2))]'"
              type="button"
              @click="filter = 'all'"
            >
              全部
            </button>
            <button
              class="rounded-xl px-3 py-1 text-xs transition"
              :class="filter === 'mention' ? 'rs-selected' : 'text-[rgb(var(--rs-text-2))]'"
              type="button"
              @click="filter = 'mention'"
            >
              提及
            </button>
            <button
              class="rounded-xl px-3 py-1 text-xs transition"
              :class="filter === 'reply' ? 'rs-selected' : 'text-[rgb(var(--rs-text-2))]'"
              type="button"
              @click="filter = 'reply'"
            >
              回复
            </button>
          </div>

          <div class="flex items-center gap-1 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-1">
            <button
              class="rounded-xl px-3 py-1 text-xs transition"
              :class="sourceFilter === 'all' ? 'rs-selected' : 'text-[rgb(var(--rs-text-2))]'"
              type="button"
              @click="sourceFilter = 'all'"
            >
              混合
            </button>
            <button
              class="rounded-xl px-3 py-1 text-xs transition"
              :class="sourceFilter === 'new' ? 'rs-selected' : 'text-[rgb(var(--rs-text-2))]'"
              type="button"
              @click="sourceFilter = 'new'"
            >
              新版
            </button>
            <button
              class="rounded-xl px-3 py-1 text-xs transition"
              :class="sourceFilter === 'old' ? 'rs-selected' : 'text-[rgb(var(--rs-text-2))]'"
              type="button"
              @click="sourceFilter = 'old'"
            >
              旧版
            </button>
          </div>

          <label class="ml-auto flex select-none items-center gap-2 text-xs text-[rgb(var(--rs-text-2))]">
            <input v-model="unreadOnly" type="checkbox" class="h-4 w-4" />
            仅未读
          </label>
        </div>
      </div>

      <div class="flex-1 overflow-auto p-4 scrollbar">
        <div v-if="props.loading" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">
          正在加载…
        </div>
        <div
          v-else-if="props.error"
          class="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-700"
        >
          {{ props.error }}
        </div>
        <div v-else-if="filtered.length === 0" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">
          暂无通知
        </div>

        <div v-else class="space-y-2">
          <button
            v-for="n in filtered"
            :key="n.id"
            class="group w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] p-3 text-left transition hover:bg-[rgb(var(--rs-hover))]"
            type="button"
            @click="emit('open', n)"
          >
            <div class="flex items-start gap-3">
              <div class="relative mt-0.5">
                <img
                  v-if="n.avatarUrl"
                  :src="n.avatarUrl"
                  class="h-10 w-10 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
                  alt="avatar"
                  referrerpolicy="no-referrer"
                  @error="onAvatarImgError"
                />
                <div
                  v-else
                  class="grid h-10 w-10 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
                >
                  {{ (n.username || "RS").slice(0, 2) }}
                </div>
                <div
                  class="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-[rgb(var(--rs-text-2))]"
                  :title="kindLabel(n.kind)"
                >
                  <i :class="[kindIcon(n.kind), 'text-sm']"></i>
                </div>
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
                    {{ (n.username || "有人") + " " + kindLabel(n.kind) }}
                  </div>
                  <div v-if="sourceLabel(n)" class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]">
                    {{ sourceLabel(n) }}
                  </div>
                  <div
                    class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
                    :title="sourceSiteLabel(n)"
                  >
                    {{ sourceSiteLabel(n) }}
                  </div>
                  <div class="ml-auto text-xs text-[rgb(var(--rs-text-3))]">{{ formatTime(n.createdAt) }}</div>
                </div>

                <div v-if="n.title" class="mt-1 truncate text-xs text-[rgb(var(--rs-text-3))]">
                  {{ n.title }}
                </div>
                <div v-if="n.excerpt" class="mt-1 truncate text-xs text-[rgb(var(--rs-text-2))]">
                  {{ n.excerpt }}
                </div>
              </div>

              <div class="mt-1 flex items-center gap-2">
                <div
                  v-if="!n.read"
                  class="h-2.5 w-2.5 rounded-full bg-rose-500"
                  aria-label="Unread"
                  title="未读"
                ></div>
                <i class="ri-arrow-right-s-line text-lg text-[rgb(var(--rs-text-3))] transition group-hover:translate-x-0.5"></i>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
