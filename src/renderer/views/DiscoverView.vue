<script setup lang="ts">
import { computed, ref } from "vue";
import FeedCard from "@/components/FeedCard.vue";
import type { FeedPost } from "@/data/forum";

const props = defineProps<{
  posts: FeedPost[];
  categoryName?: string | null;
  categoryId?: number | null;
  categoryOptions?: { id: number; name: string }[];
  loadingMore?: boolean;
  hasMore?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggleLike", postId: number): void;
  (e: "quickComment", payload: { postId: number; text: string }): void;
  (e: "openTopic", postId: number): void;
  (e: "openExternal", url: string): void;
  (e: "refresh"): void;
  (e: "newTopic"): void;
  (e: "openUser", payload: { username: string; userId?: number | null; avatarUrl?: string | null; source?: "discourse" | "discuz" }): void;
  (e: "selectCategory", categoryId: number): void;
  (e: "loadMore"): void;
}>();

const activeCommentPostId = ref<number | null>(null);
const commentDraft = ref("");
const mode = ref<"hot" | "latest">("latest");
const listRef = ref<HTMLDivElement | null>(null);

const visiblePosts = computed(() => {
  const list = [...props.posts];
  if (mode.value === "hot") {
    return list.sort(
      (a, b) =>
        b.likeCount - a.likeCount ||
        b.replyCount - a.replyCount ||
        b.views - a.views ||
        Date.parse(b.lastPostedAt || b.createdAt) - Date.parse(a.lastPostedAt || a.createdAt)
    );
  }

  return list.sort(
    (a, b) => Date.parse(b.lastPostedAt || b.createdAt) - Date.parse(a.lastPostedAt || a.createdAt)
  );
});

const onQuickComment = (postId: number) => {
  activeCommentPostId.value = postId;
  commentDraft.value = "";
};

const submit = () => {
  if (activeCommentPostId.value == null) return;
  const text = commentDraft.value.trim();
  if (!text) return;
  emit("quickComment", { postId: activeCommentPostId.value, text });
  activeCommentPostId.value = null;
  commentDraft.value = "";
};

const onSelectCategory = (ev: Event) => {
  const sel = ev.target as HTMLSelectElement | null;
  if (!sel) return;
  const v = Number(sel.value);
  if (!Number.isFinite(v)) return;
  emit("selectCategory", v);
};

const onScroll = () => {
  const el = listRef.value;
  if (!el) return;
  if (props.loadingMore) return;
  if (props.hasMore === false) return;
  const remain = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (remain < 280) emit("loadMore");
};
</script>

<template>
  <section class="flex h-full flex-1 flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
    <header class="no-drag flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
      <div class="flex items-center gap-2">
        <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">发现</div>
        <span
          v-if="props.categoryName"
          class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
        >
          {{ props.categoryName }}
        </span>
        <select
          v-if="Array.isArray(props.categoryOptions) && props.categoryOptions.length > 0"
          class="h-8 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 text-xs text-[rgb(var(--rs-text-2))] focus:outline-none"
          :value="String(props.categoryId ?? '')"
          @change="onSelectCategory"
        >
          <option v-for="o in props.categoryOptions" :key="o.id" :value="String(o.id)">{{ o.name }}</option>
        </select>
      </div>
      <div class="flex items-center gap-2">
        <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Refresh" @click="emit('refresh')">
          <i class="ri-refresh-line"></i>
        </button>
        <button
          class="rounded-xl bg-[rgb(var(--accent-500))] px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))]"
          type="button"
          @click="emit('newTopic')"
        >
          <i class="ri-add-line mr-1"></i>发帖
        </button>
        <button
          class="rs-btn text-xs"
          :class="mode === 'hot' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="mode = 'hot'"
        >
          <i class="ri-fire-line mr-1"></i>热门
        </button>
        <button
          class="rs-btn text-xs"
          :class="mode === 'latest' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="mode = 'latest'"
        >
          <i class="ri-time-line mr-1"></i>最新
        </button>
      </div>
    </header>

    <div ref="listRef" class="flex-1 overflow-auto scrollbar" @scroll.passive="onScroll">
      <div v-if="visiblePosts.length === 0" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">
        暂无内容
      </div>

      <div v-else class="divide-y divide-[rgb(var(--rs-border))]">
        <div v-for="p in visiblePosts" :key="p.id" class="px-4">
          <FeedCard
            :post="p"
            @toggleLike="emit('toggleLike', $event)"
            @quickComment="onQuickComment"
            @openTopic="emit('openTopic', $event)"
            @openExternal="emit('openExternal', $event)"
            @openUser="emit('openUser', $event)"
          />

          <div v-if="activeCommentPostId === p.id" class="no-drag mb-4 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-3">
            <div class="flex items-center gap-2">
              <i class="ri-chat-1-line text-[rgb(var(--rs-text-2))]"></i>
              <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">快速评论</div>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <input
                v-model="commentDraft"
                class="flex-1 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
                placeholder="写点什么…"
                type="text"
                @keydown.enter.prevent="submit"
              />
              <button
                class="rounded-xl bg-[rgb(var(--accent-500))] px-3 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-40"
                type="button"
                :disabled="commentDraft.trim().length === 0"
                @click="submit"
              >
                发送
              </button>
              <button
                class="rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-3 py-2 text-sm text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))]"
                type="button"
                @click="activeCommentPostId = null"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="visiblePosts.length > 0"
        class="flex items-center justify-center gap-2 py-5 text-xs text-[rgb(var(--rs-text-3))]"
      >
        <i v-if="props.loadingMore" class="ri-loader-4-line animate-spin"></i>
        <span v-if="props.loadingMore">正在加载更多...</span>
        <span v-else-if="props.hasMore === false">没有更多了</span>
        <span v-else>继续下滑加载更多</span>
      </div>
    </div>
  </section>
</template>
