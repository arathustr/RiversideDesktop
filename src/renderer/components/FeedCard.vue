<script setup lang="ts">
import { computed } from "vue";
import type { FeedPost } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

const props = defineProps<{
  post: FeedPost;
}>();

const emit = defineEmits<{
  (e: "toggleLike", postId: number): void;
  (e: "quickComment", postId: number): void;
  (e: "openTopic", postId: number): void;
  (e: "openExternal", url: string): void;
  (e: "openUser", payload: { username: string; userId?: number | null; avatarUrl?: string | null; source?: "discourse" | "discuz" }): void;
}>();

const openAuthor = () => {
  const a = props.post.author;
  const username = String(a?.username || "").trim();
  if (!username) return;
  emit("openUser", {
    username,
    userId: a?.id ?? null,
    avatarUrl: a?.avatarUrl ?? null,
    source: props.post.source || "discourse",
  });
};

const categoryStyle = computed(() => {
  const c = props.post.category;
  if (!c?.color) return null;
  return {
    borderColor: `#${c.color}55`,
    backgroundColor: `#${c.color}12`,
  };
});

const formatTime = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("zh-CN", {
    year: sameYear ? undefined : "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

const excerptText = computed(() =>
  (props.post.excerpt || "").replaceAll("&hellip;", "…").trim()
);
</script>

<template>
  <article class="no-drag py-4">
    <header class="flex items-start gap-3">
      <button class="no-drag relative" type="button" aria-label="Open author" @click="openAuthor">
        <img
          v-if="post.author?.avatarUrl"
          :src="post.author.avatarUrl"
          class="h-11 w-11 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
          alt="author"
          referrerpolicy="no-referrer"
          @error="onAvatarImgError"
        />
        <div
          v-else
          class="grid h-11 w-11 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] text-xs font-semibold text-[rgb(var(--rs-text-2))]"
        >
          {{ (post.author?.username || "RS").slice(0, 2) }}
        </div>
      </button>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            class="no-drag truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)] hover:underline"
            type="button"
            @click="openAuthor"
          >
            {{ post.author?.name || post.author?.username || "River Side" }}
          </button>

          <span class="text-xs text-[rgb(var(--rs-text-3))]">·</span>

          <div class="text-xs text-[rgb(var(--rs-text-3))]">{{ formatTime(post.createdAt) }}</div>

          <span
            v-if="post.source === 'discuz'"
            class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-3))]"
            title="旧版"
          >
            旧
          </span>

          <span v-if="post.category" class="text-xs text-[rgb(var(--rs-text-3))]">·</span>

          <span
            v-if="post.category"
            class="rounded-full border px-2 py-0.5 text-[11px] text-[rgb(var(--rs-text-2))]"
            :style="categoryStyle || undefined"
          >
            {{ post.category.name }}
          </span>
        </div>

        <button
          class="mt-2 block w-full text-left text-[15px] font-semibold leading-snug text-[rgb(var(--rs-text)/0.95)] hover:underline"
          type="button"
          @click="emit('openTopic', post.id)"
        >
          {{ post.title }}
        </button>

        <p v-if="excerptText" class="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-[rgb(var(--rs-text-2)/0.92)]">
          {{ excerptText }}
        </p>

        <div class="mt-3 flex items-center justify-between">
          <div class="flex items-center gap-3 text-xs text-[rgb(var(--rs-text-3))]">
            <span class="flex items-center gap-1">
              <i class="ri-chat-1-line"></i>
              {{ post.replyCount }}
            </span>
            <span class="flex items-center gap-1">
              <i class="ri-heart-3-line"></i>
              {{ post.likeCount }}
            </span>
            <span class="flex items-center gap-1">
              <i class="ri-eye-line"></i>
              {{ post.views }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <button
              class="inline-flex items-center gap-2 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] px-3 py-2 text-xs font-semibold text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))]"
              type="button"
              @click="emit('quickComment', post.id)"
            >
              <i class="ri-chat-3-line text-base"></i>
              评论
            </button>

            <button
              class="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-soft transition"
              :class="
                post.liked
                  ? 'border-[rgb(var(--accent-500))] bg-[rgb(var(--accent-500)/0.12)] text-[rgb(var(--accent-500))] hover:bg-[rgb(var(--accent-500)/0.16)]'
                  : 'border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] text-[rgb(var(--rs-text-2))] hover:bg-[rgb(var(--rs-hover))]'
              "
              type="button"
              @click="emit('toggleLike', post.id)"
            >
              <i class="ri-thumb-up-line text-base" :class="post.liked ? '' : 'opacity-60'"></i>
              {{ post.liked ? "已赞" : "点赞" }}
            </button>

            <button
              class="rs-icon-btn h-9 w-9"
              type="button"
              aria-label="Open"
              @click="emit('openExternal', post.url)"
            >
              <i class="ri-external-link-line"></i>
            </button>
          </div>
        </div>
      </div>
    </header>
  </article>
</template>
