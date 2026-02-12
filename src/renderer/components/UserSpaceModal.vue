<script setup lang="ts">
import { computed, ref, watch } from "vue";
import RichText from "@/components/RichText.vue";
import type { FeedPost, ForumUser } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

type UserProfile = ForumUser & {
  bioRaw?: string;
  bioCooked?: string;
  location?: string;
  website?: string;
  createdAt?: string | null;
  lastSeenAt?: string | null;
  trustLevel?: number | null;
};

const props = defineProps<{
  username: string | null;
  source?: "discourse" | "discuz";
  userId?: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "startChat", payload: { username: string; source?: "discourse" | "discuz"; userId?: number | null }): void;
  (e: "openTopic", post: FeedPost): void;
}>();

const safeUsername = computed(() => String(props.username || "").trim() || null);

const loading = ref(false);
const error = ref<string | null>(null);
const user = ref<UserProfile | null>(null);
const topics = ref<FeedPost[]>([]);

const load = async () => {
  const u = safeUsername.value;
  if (!u) return;

  loading.value = true;
  error.value = null;
  try {
    const src = props.source === "discuz" ? "discuz" : "discourse";
    const [uRes, tRes] =
      src === "discuz"
        ? await Promise.all([
            window.riverside?.legacy.getUser?.({
              uid: props.userId ?? undefined,
              username: props.userId ? undefined : u,
            }),
            window.riverside?.legacy.listUserCreatedTopics?.({
              uid: props.userId ?? undefined,
              username: u,
            }),
          ])
        : await Promise.all([
            window.riverside?.forum.getUser?.(u),
            window.riverside?.forum.listUserCreatedTopics?.({ username: u }),
          ]);

    user.value = (uRes?.user as UserProfile) || null;
    const rawPosts = Array.isArray((tRes as any)?.posts)
      ? ((tRes as any).posts as FeedPost[])
      : Array.isArray((tRes as any)?.threads)
        ? ((tRes as any).threads as FeedPost[])
        : [];
    topics.value = rawPosts.map((p) =>
      src === "discuz"
        ? ({ ...p, source: "discuz", author: p.author ? { ...p.author, source: "discuz" } : p.author } as FeedPost)
        : p
    );
  } catch (e: any) {
    user.value = null;
    topics.value = [];
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

watch(
  () => [props.username, props.source, props.userId] as const,
  async () => {
    user.value = null;
    topics.value = [];
    error.value = null;
    if (safeUsername.value) await load();
  },
  { immediate: true }
);

const avatar = computed(() => user.value?.avatarUrl || null);
const displayName = computed(() => user.value?.name || user.value?.username || safeUsername.value || "");
const bioHtml = computed(() => user.value?.bioCooked || "");

const onBioClick = async (ev: MouseEvent) => {
  const target = ev.target as HTMLElement | null;
  const a = target?.closest?.("a") as HTMLAnchorElement | null;
  if (!a?.href) return;
  ev.preventDefault();
  await window.riverside?.openExternal?.(a.href);
};

const formatDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
};
</script>

<template>
  <div v-if="safeUsername" class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div class="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">空间</div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">@{{ safeUsername }}</div>
        </div>
        <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="flex-1 overflow-hidden p-4">
        <div class="flex h-full flex-col gap-3">
          <div class="flex items-start gap-3 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] p-4">
            <img
              v-if="avatar"
              :src="avatar"
              class="h-16 w-16 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
              alt="avatar"
              referrerpolicy="no-referrer"
              @error="onAvatarImgError"
            />
            <div
              v-else
              class="grid h-16 w-16 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-sm font-semibold text-[rgb(var(--rs-text-2))]"
            >
              {{ (safeUsername || "RS").slice(0, 2) }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <div class="truncate text-base font-semibold text-[rgb(var(--rs-text)/0.92)]">{{ displayName }}</div>
                <div v-if="user?.id" class="text-xs text-[rgb(var(--rs-text-3))]">#{{ user.id }}</div>
              </div>
              <div v-if="user?.title" class="mt-1 text-sm text-[rgb(var(--rs-text-2)/0.92)]">{{ user.title }}</div>
              <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--rs-text-3))]">
                <span v-if="user?.location"><i class="ri-map-pin-line mr-1"></i>{{ user.location }}</span>
                <span v-if="user?.website"><i class="ri-links-line mr-1"></i>{{ user.website }}</span>
                <span v-if="user?.createdAt"><i class="ri-time-line mr-1"></i>注册 {{ formatDate(user.createdAt) }}</span>
              </div>
            </div>

            <button
              class="h-10 rounded-xl bg-[rgb(var(--accent-500))] px-3 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))]"
              type="button"
              @click="emit('startChat', { username: user?.username || safeUsername!, source: props.source || 'discourse', userId: user?.id || props.userId || null })"
            >
              <i class="ri-chat-3-line mr-1"></i>发起聊天
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))]">
            <div class="border-b border-[rgb(var(--rs-border))] px-4 py-3">
              <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">TA 的主题</div>
            </div>

            <div class="h-full overflow-auto p-4 scrollbar">
              <div v-if="loading" class="py-10 text-center text-sm text-[rgb(var(--rs-text-2))]">正在加载…</div>
              <div v-else-if="error" class="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700">
                {{ error }}
              </div>
              <div v-else-if="topics.length === 0" class="py-10 text-center text-sm text-[rgb(var(--rs-text-2))]">暂无主题</div>

              <div v-else class="space-y-3">
                <button
                  v-for="p in topics"
                  :key="p.id"
                  class="no-drag block w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] p-3 text-left transition hover:bg-[rgb(var(--rs-hover))]"
                  type="button"
                  @click="emit('openTopic', p)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">{{ p.title }}</div>
                      <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--rs-text-3))]">
                        <span v-if="p.category" class="rounded-full border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-2 py-0.5">
                          {{ p.category.name }}
                        </span>
                        <span>{{ formatDate(p.createdAt) }}</span>
                        <span>回复 {{ p.replyCount }}</span>
                        <span>赞 {{ p.likeCount }}</span>
                        <span>浏览 {{ p.views }}</span>
                      </div>
                      <div v-if="p.excerpt" class="mt-2 line-clamp-2 text-sm text-[rgb(var(--rs-text-2)/0.92)]">
                        {{ p.excerpt.replaceAll("&hellip;", "…") }}
                      </div>
                    </div>
                    <i class="ri-arrow-right-s-line mt-1 text-xl text-[rgb(var(--rs-text-3))]"></i>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div v-if="bioHtml" class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-4">
            <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">简介</div>
            <div class="topic-cooked mt-2 text-sm text-[rgb(var(--rs-text-2)/0.92)]" @click="onBioClick">
              <RichText :html="bioHtml" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
