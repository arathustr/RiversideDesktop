<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import RichText from "@/components/RichText.vue";
import type { ForumMessage, ForumUser } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

const LEGACY_BASE_URL = "https://bbs.uestc.edu.cn";

const props = defineProps<{
  seed: { tid: number; fid?: number | null; pid?: number | null; page?: number | null } | null;
  me: ForumUser | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "openUser", payload: { username: string; userId?: number | null; avatarUrl?: string | null; source?: "discuz" }): void;
}>();

const loading = ref(false);
const sending = ref(false);
const error = ref<string | null>(null);

const thread = ref<null | { tid: number; fid: number | null; title: string; page: number }>(null);
const posts = ref<ForumMessage[]>([]);

const page = ref(1);
const pidToFocus = ref<number | null>(null);

const draft = ref("");
const replyPid = ref<number | null>(null);
const replyToUsername = ref<string | null>(null);

const safeSeed = computed(() => {
  const s = props.seed;
  if (!s) return null;
  const tid = Number(s.tid);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  return {
    tid: Math.abs(tid),
    fid: s.fid != null ? Math.abs(Number(s.fid)) : null,
    pid: s.pid != null ? Math.abs(Number(s.pid)) : null,
    page: s.page != null ? Math.max(1, Number(s.page)) : 1,
  };
});

const load = async () => {
  const s = safeSeed.value;
  if (!s) return;
  if (!props.me) {
    error.value = "请先登录旧版清水河畔（Discuz）";
    return;
  }

  loading.value = true;
  error.value = null;
  try {
    const res = await window.riverside?.legacy.getThread?.({ tid: s.tid, page: page.value });
    if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");

    const t = (res as any)?.thread || null;
    thread.value = t
      ? {
          tid: Number(t.tid) || s.tid,
          fid: t.fid != null ? Number(t.fid) : s.fid ?? null,
          title: String(t.title || ""),
          page: Number(t.page) || page.value,
        }
      : { tid: s.tid, fid: s.fid ?? null, title: `TID ${s.tid}`, page: page.value };

    const list = Array.isArray((res as any)?.posts) ? ((res as any).posts as ForumMessage[]) : [];
    posts.value = list.map((m) => ({ ...m, source: "discuz" as const }));

    if (s.pid) pidToFocus.value = s.pid;
  } catch (e: any) {
    thread.value = null;
    posts.value = [];
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

const focusPidIfNeeded = async () => {
  const pid = pidToFocus.value;
  if (!pid) return;
  await nextTick();
  const el = document.querySelector(`[data-legacy-pid="${pid}"]`) as HTMLElement | null;
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    pidToFocus.value = null;
  }
};

watch(
  () => props.seed,
  async () => {
    const s = safeSeed.value;
    if (!s) return;
    page.value = s.page || 1;
    pidToFocus.value = s.pid || null;
    replyPid.value = null;
    replyToUsername.value = null;
    draft.value = "";
    await load();
    await focusPidIfNeeded();
  },
  { immediate: true }
);

onMounted(async () => {
  await load();
  await focusPidIfNeeded();
});

const openExternal = async () => {
  const t = thread.value;
  if (!t?.tid) return;
  await window.riverside?.openExternal?.(`${LEGACY_BASE_URL}/forum.php?mod=viewthread&tid=${t.tid}&page=${page.value}`);
};

const onCookedClick = async (ev: MouseEvent) => {
  const target = ev.target as HTMLElement | null;
  const a = target?.closest?.("a") as HTMLAnchorElement | null;
  if (!a?.href) return;
  ev.preventDefault();
  await window.riverside?.openExternal?.(a.href);
};

const openUser = (m: ForumMessage) => {
  const username = String(m.username || "").trim();
  if (!username || username === "system") return;
  emit("openUser", {
    username,
    userId: m.userId ?? null,
    avatarUrl: m.avatarUrl ?? null,
    source: "discuz",
  });
};

const startReply = (m: ForumMessage) => {
  const pid = Number((m as any)?.legacy?.pid ?? m.id);
  if (!Number.isFinite(pid) || pid <= 0) return;
  replyPid.value = pid;
  replyToUsername.value = String(m.username || "").trim() || null;
};

const clearReply = () => {
  replyPid.value = null;
  replyToUsername.value = null;
};

const submit = async () => {
  if (sending.value) return;
  const t = thread.value;
  if (!t?.tid) return;
  const fid = t.fid != null ? Number(t.fid) : null;
  const message = draft.value.trim();
  if (!message) return;
  if (!props.me) {
    error.value = "请先登录旧版清水河畔（Discuz）";
    return;
  }
  if (fid == null || !Number.isFinite(fid) || fid <= 0) {
    error.value = "旧版回帖需要具体板块（fid）";
    return;
  }

  sending.value = true;
  error.value = null;
  try {
    const res = await window.riverside?.legacy.replyThread?.({
      tid: t.tid,
      fid,
      message,
      repquotePid: replyPid.value,
    });
    if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");
    draft.value = "";
    clearReply();
    await load();
    await nextTick();
    const list = document.querySelector("[data-legacy-posts]") as HTMLElement | null;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    sending.value = false;
  }
};

const title = computed(() => thread.value?.title || `TID ${safeSeed.value?.tid || ""}`);
</script>

<template>
  <div v-if="safeSeed" class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div class="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
            {{ title }}
          </div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">
            旧版 · 第 {{ page }} 页
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="rs-btn px-3 py-2 text-xs" type="button" @click="page = Math.max(1, page - 1); load()">
            <i class="ri-arrow-left-s-line mr-1"></i>上一页
          </button>
          <button class="rs-btn px-3 py-2 text-xs" type="button" @click="page = page + 1; load()">
            下一页<i class="ri-arrow-right-s-line ml-1"></i>
          </button>
          <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Open in browser" @click="openExternal">
            <i class="ri-external-link-line"></i>
          </button>
          <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
            <i class="ri-close-line text-lg"></i>
          </button>
        </div>
      </header>

      <div class="flex-1 overflow-hidden">
        <div v-if="loading" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">
          正在加载…
        </div>
        <div v-else-if="error" class="m-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-700">
          {{ error }}
        </div>

        <div v-else class="h-full overflow-auto p-4 scrollbar" data-legacy-posts>
          <div v-if="posts.length === 0" class="grid place-items-center py-16 text-sm text-[rgb(var(--rs-text-2))]">
            暂无内容
          </div>

          <div v-else class="space-y-3">
            <article
              v-for="p in posts"
              :key="p.id"
              class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] p-4"
              :data-legacy-pid="(p as any)?.legacy?.pid || p.id"
            >
              <header class="flex items-start gap-3">
                <button class="no-drag mt-0.5 h-11 w-11 overflow-hidden rounded-2xl" type="button" @click="openUser(p)">
                  <img v-if="p.avatarUrl" :src="p.avatarUrl" class="h-11 w-11 rounded-2xl object-cover" alt="avatar" referrerpolicy="no-referrer" @error="onAvatarImgError" />
                  <div v-else class="grid h-11 w-11 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-xs font-semibold text-[rgb(var(--rs-text-2))]">
                    {{ (p.username || "RS").slice(0, 2) }}
                  </div>
                </button>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--rs-text-3))]">
                    <button class="no-drag font-semibold text-[rgb(var(--rs-text-2))] hover:underline" type="button" @click="openUser(p)">
                      @{{ p.username }}
                    </button>
                    <span v-if="p.userId" class="opacity-80">#{{ p.userId }}</span>
                    <span class="opacity-60">·</span>
                    <span>{{ new Date(p.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) }}</span>
                    <span v-if="p.postNumber" class="opacity-60">·</span>
                    <span v-if="p.postNumber">#{{ p.postNumber }}</span>

                    <div class="ml-auto flex items-center gap-2">
                      <button class="rs-btn px-3 py-1.5 text-xs" type="button" @click="startReply(p)">
                        <i class="ri-reply-line mr-1"></i>引用回复
                      </button>
                    </div>
                  </div>

                  <div class="topic-cooked mt-3 text-[15px] leading-relaxed text-[rgb(var(--rs-text))]" @click="onCookedClick">
                    <RichText :html="p.cooked" :base-url="LEGACY_BASE_URL" />
                  </div>
                </div>
              </header>
            </article>
          </div>
        </div>
      </div>

      <footer class="no-drag border-t border-[rgb(var(--rs-border))] p-3">
        <div v-if="replyPid && replyToUsername" class="mb-2 flex items-center justify-between rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-xs text-[rgb(var(--rs-text-2))]">
          <div class="truncate">
            正在引用回复：@{{ replyToUsername }} (pid {{ replyPid }})
          </div>
          <button class="rs-icon-btn h-8 w-8" type="button" aria-label="Cancel reply" @click="clearReply">
            <i class="ri-close-line"></i>
          </button>
        </div>

        <div class="flex items-end gap-2">
          <textarea
            v-model="draft"
            class="scrollbar min-h-12 flex-1 resize-none rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
            placeholder="写点什么…"
          ></textarea>

          <button
            class="h-12 rounded-2xl bg-[rgb(var(--accent-500))] px-5 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-40"
            type="button"
            :disabled="sending || draft.trim().length === 0"
            @click="submit"
          >
            <i v-if="sending" class="ri-loader-4-line mr-1 animate-spin"></i>
            发送
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>
