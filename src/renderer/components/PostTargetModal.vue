<script setup lang="ts">
const emit = defineEmits<{
  (e: "close"): void;
  (e: "choose", target: "new" | "old"): void;
}>();
</script>

<template>
  <div class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div class="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">选择发帖站点</div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">混合模式下可选择发到新版或旧版</div>
        </div>
        <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="space-y-2 p-4">
        <button
          class="w-full rounded-2xl bg-[rgb(var(--accent-500))] px-4 py-3 text-left text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))]"
          type="button"
          @click="emit('choose', 'new')"
        >
          发到新版（river-side.cc）
        </button>

        <button
          class="w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-4 py-3 text-left text-sm font-semibold text-[rgb(var(--rs-text))] shadow-soft transition hover:bg-[rgb(var(--rs-hover))]"
          type="button"
          @click="emit('choose', 'old')"
        >
          发到旧版（bbs.uestc.edu.cn）
        </button>

        <button class="rs-btn w-full py-3 text-sm" type="button" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>

