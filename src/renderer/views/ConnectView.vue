<script setup lang="ts">
defineProps<{
  loading: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  (e: "login"): void;
  (e: "refresh"): void;
}>();
</script>

<template>
  <section class="flex h-full flex-1 items-center justify-center">
    <div class="w-full max-w-lg rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] p-6 shadow-soft">
      <div class="flex items-start gap-4">
        <div
          class="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-[rgb(var(--accent-500))] to-[rgb(var(--accent-2))] text-white shadow-soft"
        >
          <i class="ri-chat-3-line text-2xl"></i>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-base font-semibold text-[rgb(var(--rs-text)/0.92)]">连接 River Side</div>
          <div class="mt-1 text-sm leading-relaxed text-[rgb(var(--rs-text-2)/0.92)]">
            站点为 Discourse（非 Discuz!）。请在弹出的登录窗口完成登录，应用会自动读取会话并加载你的聊天频道与发现帖子。若登录后未自动进入，请关闭登录窗口后点“刷新”。
          </div>
        </div>
      </div>

      <div v-if="error" class="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-100/90">
        {{ error }}
      </div>

      <div class="mt-5 flex items-center gap-2">
        <button
          class="flex-1 rounded-xl bg-[rgb(var(--accent-500))] px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-50"
          type="button"
          :disabled="loading"
          @click="emit('login')"
        >
          {{ loading ? "正在打开登录…" : "打开登录窗口" }}
        </button>
        <button
          class="rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-4 py-3 text-sm text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))]"
          type="button"
          :disabled="loading"
          @click="emit('refresh')"
        >
          刷新
        </button>
      </div>

      <div class="mt-4 text-xs text-[rgb(var(--rs-text-3))]">
        提示：登录一次后会保持会话（无需每次输入账号密码）。
      </div>
    </div>
  </section>
</template>
