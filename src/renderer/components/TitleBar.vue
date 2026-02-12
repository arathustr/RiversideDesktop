<script setup lang="ts">
const props = defineProps<{
  loggedIn?: boolean;
  collapseEnabled?: boolean;
  collapsed?: boolean;
  notificationCount?: number;
}>();

const emit = defineEmits<{
  (e: "logout"): void;
  (e: "toggleCollapse"): void;
  (e: "openNotifications"): void;
}>();

const onMinimize = async () => {
  await window.riverside?.window.minimize?.();
};

const onToggleMaximize = async () => {
  await window.riverside?.window.toggleMaximize?.();
};

const onClose = async () => {
  await window.riverside?.window.close?.();
};
</script>

<template>
  <header class="drag flex h-12 items-center gap-3 border-b border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-bg)/0.85)] px-3">
    <div
      class="pointer-events-none flex h-8 items-center gap-2 rounded-xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] px-3"
    >
      <div class="h-2 w-2 rounded-full bg-[rgb(var(--accent-500))]"></div>
      <div class="text-sm font-semibold tracking-wide text-[rgb(var(--rs-text)/0.92)]">Riverside</div>
    </div>

    <div class="flex-1"></div>

    <div class="no-drag flex items-center gap-1">
      <button
        v-if="props.collapseEnabled"
        class="rs-icon-btn h-8 w-10 rounded-lg"
        type="button"
        :aria-label="props.collapsed ? 'Expand' : 'Collapse'"
        @click="emit('toggleCollapse')"
      >
        <i :class="props.collapsed ? 'ri-layout-right-2-line' : 'ri-layout-left-2-line'"></i>
      </button>

      <button
        v-if="props.loggedIn"
        class="rs-icon-btn relative h-8 w-10 rounded-lg"
        type="button"
        aria-label="Notifications"
        @click="emit('openNotifications')"
      >
        <i class="ri-notification-3-line"></i>
        <div
          v-if="(props.notificationCount || 0) > 0"
          class="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-white/70 bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white shadow-soft"
        >
          {{ (props.notificationCount || 0) > 99 ? "99+" : props.notificationCount }}
        </div>
      </button>
      <button
        v-if="props.loggedIn"
        class="h-8 rounded-lg border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.85)] px-3 text-[rgb(var(--rs-text-2))] transition hover:bg-[rgb(var(--rs-hover))]"
        type="button"
        aria-label="Logout"
        @click="emit('logout')"
      >
        <i class="ri-logout-box-r-line"></i>
      </button>

      <button
        class="rs-icon-btn h-8 w-10 rounded-lg"
        type="button"
        aria-label="Minimize"
        @click="onMinimize"
      >
        <i class="ri-subtract-line"></i>
      </button>
      <button
        class="rs-icon-btn h-8 w-10 rounded-lg"
        type="button"
        aria-label="Maximize"
        @click="onToggleMaximize"
      >
        <i class="ri-checkbox-blank-line"></i>
      </button>
      <button
        class="rs-icon-btn h-8 w-10 rounded-lg hover:bg-rose-500/15 hover:text-rose-600"
        type="button"
        aria-label="Close"
        @click="onClose"
      >
        <i class="ri-close-line"></i>
      </button>
    </div>
  </header>
</template>
