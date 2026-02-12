<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ForumUser } from "@/data/forum";
import { onAvatarImgError } from "@/lib/avatar";

type Tab = "account" | "appearance";

const props = defineProps<{
  me: ForumUser;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "saved"): void;
}>();

const tab = ref<Tab>("account");
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const ok = ref<string | null>(null);

const profile = ref<{
  username: string;
  avatarUrl: string | null;
  name: string;
  title: string;
  bioRaw: string;
} | null>(null);

const name = ref("");
const title = ref("");
const bioRaw = ref("");
const legacyStatus = ref<{ loggedIn: boolean; currentUser?: { id: number; username: string } | null }>({
  loggedIn: false,
  currentUser: null,
});

const SCHEME_KEY = "riverside.scheme";
const scheme = ref<"light" | "dark">("light");

const ACCENT_KEY = "riverside.accent";
const accent = ref<string>("blue");

const schemeOptions: Array<{ id: "light" | "dark"; name: string; desc: string }> = [
  { id: "light", name: "浅色", desc: "更接近 QQ 的清爽风格" },
  { id: "dark", name: "深色", desc: "夜间更护眼" },
];

const accentOptions = [
  { id: "blue", name: "蓝色", from: "#2d8cf0", to: "#38bdf8" },
  { id: "sky", name: "浅蓝", from: "#0ea5e9", to: "#93c5fd" },
  { id: "cyan", name: "青蓝", from: "#06b6d4", to: "#67e8f9" },
  { id: "teal", name: "青绿", from: "#14b8a6", to: "#99f6e4" },
  { id: "purple", name: "紫色", from: "#8b5cf6", to: "#ec4899" },
  { id: "indigo", name: "靛蓝", from: "#6366f1", to: "#a78bfa" },
  { id: "rose", name: "浅粉", from: "#f43f5e", to: "#f9a8d4" },
  { id: "green", name: "绿色", from: "#22c55e", to: "#06b6d4" },
  { id: "mint", name: "薄荷", from: "#10b981", to: "#22d3ee" },
  { id: "amber", name: "琥珀", from: "#f59e0b", to: "#f97316" },
  { id: "orange", name: "橙色", from: "#f97316", to: "#fdba74" },
  { id: "slate", name: "浅灰", from: "#94a3b8", to: "#cbd5e1" },
];

const applyScheme = (id: "light" | "dark") => {
  scheme.value = id;
  document.documentElement.dataset.scheme = id;
  try {
    localStorage.setItem(SCHEME_KEY, id);
  } catch {
    // ignore
  }
};

const loadScheme = () => {
  try {
    const raw = localStorage.getItem(SCHEME_KEY);
    if (raw === "light" || raw === "dark") return raw;
    const ds = document.documentElement.dataset.scheme;
    if (ds === "light" || ds === "dark") return ds;
    return "light";
  } catch {
    const ds = document.documentElement.dataset.scheme;
    return ds === "dark" ? "dark" : "light";
  }
};

const applyAccent = (id: string) => {
  accent.value = id;
  document.documentElement.dataset.accent = id;
  try {
    localStorage.setItem(ACCENT_KEY, id);
  } catch {
    // ignore
  }
};

const loadAccent = () => {
  try {
    return localStorage.getItem(ACCENT_KEY) || document.documentElement.dataset.accent || "blue";
  } catch {
    return document.documentElement.dataset.accent || "blue";
  }
};

const load = async () => {
  loading.value = true;
  error.value = null;
  ok.value = null;
  try {
    const res = await window.riverside?.forum.getMyProfile?.();
    const p = res?.profile;
    if (!p) throw new Error("无法读取个人资料（请检查登录状态）");
    profile.value = p;
    name.value = p.name || "";
    title.value = p.title || "";
    bioRaw.value = p.bioRaw || "";
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

const save = async () => {
  saving.value = true;
  error.value = null;
  ok.value = null;
  try {
    await window.riverside?.forum.updateMyProfile?.({
      name: name.value,
      title: title.value,
      bioRaw: bioRaw.value,
    });
    ok.value = "已保存";
    emit("saved");
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    saving.value = false;
  }
};

const changeAvatar = async () => {
  error.value = null;
  ok.value = null;
  try {
    const picker = await window.riverside?.files.pickImages?.();
    const filePath = picker?.filePaths?.[0];
    if (!filePath) return;

    saving.value = true;
    await window.riverside?.forum.updateMyAvatar?.(filePath);
    ok.value = "头像已更新";
    await load();
    emit("saved");
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    saving.value = false;
  }
};

const openForumProfile = async () => {
  await window.riverside?.forum.openProfileSettings?.();
};

const loadLegacyStatus = async () => {
  try {
    const res = await window.riverside?.legacy.getSession?.();
    legacyStatus.value = {
      loggedIn: !!res?.loggedIn,
      currentUser: res?.currentUser ? { id: res.currentUser.id, username: res.currentUser.username } : null,
    };
  } catch {
    legacyStatus.value = { loggedIn: false, currentUser: null };
  }
};

const openLegacyLogin = async () => {
  await window.riverside?.legacy.openLogin?.();
  await loadLegacyStatus();
};

const logoutLegacy = async () => {
  await window.riverside?.legacy.logout?.();
  await loadLegacyStatus();
};

onMounted(async () => {
  applyScheme(loadScheme());
  applyAccent(loadAccent());
  await load();
  await loadLegacyStatus();
});
</script>

<template>
  <div class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div
      class="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft"
    >
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">设置</div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">账号 · 外观</div>
        </div>
        <button
          class="rs-icon-btn h-9 w-9"
          type="button"
          aria-label="Close"
          @click="emit('close')"
        >
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="flex items-center gap-2 border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <button
          class="rs-btn text-xs"
          :class="tab === 'account' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="tab = 'account'"
        >
          <i class="ri-user-3-line mr-1"></i>账号
        </button>
        <button
          class="rs-btn text-xs"
          :class="tab === 'appearance' ? 'rs-selected text-[rgb(var(--rs-text))]' : ''"
          type="button"
          @click="tab = 'appearance'"
        >
          <i class="ri-palette-line mr-1"></i>外观
        </button>
      </div>

      <div class="flex-1 overflow-auto p-4 scrollbar">
        <div v-if="tab === 'account'" class="space-y-4">
          <div class="flex items-start gap-4 rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] p-4">
            <img
              v-if="profile?.avatarUrl || props.me.avatarUrl"
              :src="profile?.avatarUrl || props.me.avatarUrl || ''"
              class="h-16 w-16 rounded-2xl border border-[rgb(var(--rs-border))] object-cover"
              alt="avatar"
              referrerpolicy="no-referrer"
              @error="onAvatarImgError"
            />
            <div
              v-else
              class="grid h-16 w-16 place-items-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] text-sm font-semibold text-[rgb(var(--rs-text-2))]"
            >
              {{ (profile?.username || props.me.username).slice(0, 2) }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">
                {{ profile?.name || props.me.name || props.me.username }}
              </div>
              <div class="mt-1 truncate text-xs text-[rgb(var(--rs-text-3))]">@{{ profile?.username || props.me.username }}</div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  class="rs-btn text-xs disabled:opacity-40"
                  type="button"
                  :disabled="saving"
                  @click="changeAvatar"
                >
                  <i class="ri-image-edit-line mr-1"></i>更换头像
                </button>
                <button
                  class="rs-btn text-xs"
                  type="button"
                  @click="openForumProfile"
                >
                  <i class="ri-external-link-line mr-1"></i>论坛更多设置
                </button>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label class="space-y-1">
              <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">昵称</div>
              <input
                v-model="name"
                class="w-full rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
                placeholder="显示昵称"
                type="text"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">头衔</div>
              <input
                v-model="title"
                class="w-full rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
                placeholder="个性签名 / 头衔"
                type="text"
              />
            </label>
          </div>

          <label class="space-y-1">
            <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">个人简介</div>
            <textarea
              v-model="bioRaw"
              class="scrollbar min-h-28 w-full resize-none rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
              placeholder="写点自我介绍…"
            ></textarea>
          </label>

          <div class="flex items-center justify-between gap-3">
            <div class="text-xs text-[rgb(var(--rs-text-3))]">
              <span v-if="loading">正在读取…</span>
              <span v-else-if="saving">正在保存…</span>
              <span v-else-if="ok" class="text-emerald-200/80">{{ ok }}</span>
              <span v-else-if="error" class="text-rose-200/80">{{ error }}</span>
              <span v-else>可在应用内直接修改资料</span>
            </div>
            <button
              class="rounded-xl bg-[rgb(var(--accent-500))] px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-40"
              type="button"
              :disabled="saving"
              @click="save"
            >
              保存
            </button>
          </div>

          <div class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">旧版清水河畔（Discuz）</div>
                <div class="mt-1 text-xs text-[rgb(var(--rs-text-3))]">
                  <span v-if="legacyStatus.loggedIn">
                    已登录：{{ legacyStatus.currentUser?.username }} (#{{ legacyStatus.currentUser?.id }})
                  </span>
                  <span v-else>未登录</span>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <button class="rs-btn px-3 py-2 text-xs" type="button" @click="loadLegacyStatus">
                  <i class="ri-refresh-line mr-1"></i>刷新
                </button>
                <button
                  v-if="!legacyStatus.loggedIn"
                  class="rounded-xl bg-[rgb(var(--accent-500))] px-3 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))]"
                  type="button"
                  @click="openLegacyLogin"
                >
                  <i class="ri-login-box-line mr-1"></i>登录旧版
                </button>
                <button
                  v-else
                  class="rs-btn px-3 py-2 text-xs"
                  type="button"
                  @click="logoutLegacy"
                >
                  <i class="ri-logout-box-line mr-1"></i>退出旧版
                </button>
              </div>
            </div>

            <div class="mt-3 text-xs text-[rgb(var(--rs-text-3))]">
              提示：点击“登录旧版”会弹出旧站的登录窗口，完成登录后回到客户端即可。
            </div>
          </div>
        </div>

        <div v-else class="space-y-4">
          <div class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] p-4">
            <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">外观</div>
            <div class="mt-1 text-xs text-[rgb(var(--rs-text-3))]">即时生效，自动保存到本地</div>
          </div>

          <div class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-4">
            <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">主题模式</div>
            <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                v-for="s in schemeOptions"
                :key="s.id"
                class="rs-btn rounded-2xl px-3 py-3 text-left"
                :class="scheme === s.id ? 'rs-selected' : ''"
                type="button"
                @click="applyScheme(s.id)"
              >
                <div class="flex items-center justify-between">
                  <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.9)]">{{ s.name }}</div>
                  <i v-if="scheme === s.id" class="ri-check-line text-lg text-emerald-600/90"></i>
                </div>
                <div class="mt-1 text-xs text-[rgb(var(--rs-text-3))]">{{ s.desc }}</div>
              </button>
            </div>
          </div>

          <div class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-4">
            <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">主题色</div>
            <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                v-for="t in accentOptions"
                :key="t.id"
                class="overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] text-left transition hover:bg-[rgb(var(--rs-hover))]"
                :class="accent === t.id ? 'rs-selected' : ''"
                type="button"
                @click="applyAccent(t.id)"
              >
                <div class="h-12 w-full" :style="{ background: `linear-gradient(90deg, ${t.from}, ${t.to})` }"></div>
                <div class="flex items-center justify-between px-4 py-3">
                  <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.9)]">{{ t.name }}</div>
                  <i v-if="accent === t.id" class="ri-check-line text-lg text-emerald-600/90"></i>
                  <i v-else class="ri-paint-line text-lg text-[rgb(var(--rs-text-3))]"></i>
                </div>
              </button>
            </div>
          </div>

          <div class="rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.65)] p-4 text-xs text-[rgb(var(--rs-text-3))]">
            提示：主题只影响应用界面，不会修改论坛网页主题。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
