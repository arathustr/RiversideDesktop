<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { ForumUser } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

const props = defineProps<{
  username: string | null;
  source?: "discourse" | "discuz";
  seed?: { userId?: number | null; avatarUrl?: string | null } | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "startChat", payload: { username: string; source?: "discourse" | "discuz"; userId?: number | null }): void;
  (e: "openProfile", payload: { username: string; source?: "discourse" | "discuz"; userId?: number | null }): void;
}>();

const loading = ref(false);
const error = ref<string | null>(null);
const user = ref<ForumUser | null>(null);

const safeUsername = computed(() => String(props.username || "").trim() || null);

const load = async () => {
  const u = safeUsername.value;
  if (!u) return;

  loading.value = true;
  error.value = null;
  try {
    const src = props.source === "discuz" ? "discuz" : "discourse";
    const res =
      src === "discuz"
        ? await window.riverside?.legacy.getUser?.({
            uid: props.seed?.userId ?? undefined,
            username: props.seed?.userId ? undefined : u,
          })
        : await window.riverside?.forum.getUser?.(u);
    user.value = (res?.user as ForumUser) || null;
    if (!user.value) throw new Error("无法读取用户信息");
  } catch (e: any) {
    user.value = null;
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

watch(
  () => [props.username, props.source, props.seed?.userId] as const,
  async () => {
    user.value = null;
    error.value = null;
    if (safeUsername.value) await load();
  },
  { immediate: true }
);

onMounted(async () => {
  if (!safeUsername.value) return;
  if (!user.value) await load();
});

const avatar = computed(() => user.value?.avatarUrl || props.seed?.avatarUrl || null);
const displayName = computed(
  () => user.value?.name || user.value?.username || safeUsername.value || ""
);
</script>

<template>
  <div v-if="safeUsername" class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div class="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">名片</div>
        <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="p-4">
        <div class="flex items-start gap-3">
          <img
            v-if="avatar"
            :src="avatar"
            class="h-14 w-14 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
            alt="avatar"
            referrerpolicy="no-referrer"
            @error="onAvatarImgError"
          />
          <div v-else class="grid h-14 w-14 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] text-sm font-semibold text-[rgb(var(--rs-text-2))]">
            {{ (safeUsername || "RS").slice(0, 2) }}
          </div>

          <div class="min-w-0 flex-1">
            <div class="truncate text-base font-semibold text-[rgb(var(--rs-text)/0.92)]">{{ displayName }}</div>
            <div class="mt-1 text-xs text-[rgb(var(--rs-text-3))]">
              @{{ user?.username || safeUsername }}
              <span v-if="user?.id || props.seed?.userId" class="ml-2">#{{ user?.id || props.seed?.userId }}</span>
            </div>
            <div v-if="user?.title" class="mt-2 line-clamp-2 text-sm text-[rgb(var(--rs-text-2)/0.92)]">
              {{ user.title }}
            </div>
          </div>
        </div>

        <div v-if="loading" class="mt-3 text-xs text-[rgb(var(--rs-text-3))]">正在读取…</div>
        <div v-else-if="error" class="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-700">
          {{ error }}
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <button
            class="rounded-xl bg-[rgb(var(--accent-500))] px-3 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))]"
            type="button"
            @click="emit('startChat', { username: user?.username || safeUsername!, source: props.source || 'discourse', userId: user?.id || props.seed?.userId || null })"
          >
            <i class="ri-chat-3-line mr-1"></i>发起聊天
          </button>
          <button
            class="rs-btn px-3 py-2.5 text-sm font-semibold"
            type="button"
            @click="emit('openProfile', { username: user?.username || safeUsername!, source: props.source || 'discourse', userId: user?.id || props.seed?.userId || null })"
          >
            <i class="ri-user-3-line mr-1"></i>进入空间
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
