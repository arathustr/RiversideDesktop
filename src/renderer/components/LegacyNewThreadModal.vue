<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

type LegacyGroup = { gid: number; name: string; forums: { fid: number; name: string; url: string }[] };

const props = defineProps<{
  groups: LegacyGroup[];
  initialGid?: number | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "posted", payload: { tid?: number | null; fid?: number | null; url?: string | null }): void;
}>();

const loading = ref(false);
const sending = ref(false);
const error = ref<string | null>(null);
const ok = ref<string | null>(null);

const fid = ref<number | null>(null);
const subject = ref("");
const message = ref("");
const typeid = ref<string | null>(null);
const typeOptions = ref<Array<{ value: string; label: string }>>([]);

const forumOptions = computed(() => {
  const out: Array<{ fid: number; gid: number; label: string }> = [];
  for (const g of props.groups || []) {
    for (const f of g.forums || []) {
      const nf = Number(f?.fid);
      if (!Number.isFinite(nf) || nf <= 0) continue;
      const label = `${g.name} / ${f.name || `FID ${nf}`}`;
      out.push({ fid: nf, gid: Number(g.gid) || 0, label });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
});

const loadForm = async () => {
  const id = fid.value;
  if (id == null) return;
  loading.value = true;
  error.value = null;
  ok.value = null;
  try {
    const res = await window.riverside?.legacy.getNewThreadForm?.({ fid: id });
    if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");
    const opts = Array.isArray((res as any)?.typeOptions)
      ? ((res as any).typeOptions as Array<{ value: string; label: string }>)
      : [];
    typeOptions.value = opts.filter((o) => o && typeof o.value === "string" && typeof o.label === "string");
    if (typeOptions.value.length === 0) {
      typeid.value = null;
    } else if (!typeOptions.value.some((o) => o.value === typeid.value)) {
      typeid.value = typeOptions.value[0]?.value ?? null;
    }
  } catch (e: any) {
    typeOptions.value = [];
    typeid.value = null;
    error.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
};

const submit = async () => {
  const id = fid.value;
  if (sending.value) return;
  if (id == null) return;
  const s = subject.value.trim();
  const m = message.value.trim();
  if (!s) {
    error.value = "请填写标题";
    return;
  }
  if (!m) {
    error.value = "请填写内容";
    return;
  }

  sending.value = true;
  error.value = null;
  ok.value = null;
  try {
    const res = await window.riverside?.legacy.createThread?.({
      fid: id,
      subject: s,
      message: m,
      typeid: typeid.value,
    });
    if (!(res as any)?.loggedIn) throw new Error("旧版未登录，请重新登录旧版");
    ok.value = "已发布";
    emit("posted", { tid: (res as any)?.tid ?? null, fid: id, url: (res as any)?.url ?? null });
  } catch (e: any) {
    error.value = String(e?.message || e);
  } finally {
    sending.value = false;
  }
};

watch(
  () => fid.value,
  () => {
    typeOptions.value = [];
    typeid.value = null;
    if (fid.value != null) void loadForm();
  }
);

onMounted(() => {
  if (fid.value != null) return;
  const gid = props.initialGid != null ? Number(props.initialGid) : null;
  if (gid != null && Number.isFinite(gid) && gid > 0) {
    const hit = forumOptions.value.find((o) => o.gid === gid) || null;
    if (hit) {
      fid.value = hit.fid;
      return;
    }
  }
  fid.value = forumOptions.value[0]?.fid ?? null;
});
</script>

<template>
  <div class="no-drag absolute inset-0 z-50 bg-black/70 p-4" @click.self="emit('close')">
    <div class="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <header class="flex items-center justify-between border-b border-[rgb(var(--rs-border))] px-4 py-3">
        <div>
          <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.92)]">发帖（旧版）</div>
          <div class="mt-0.5 text-xs text-[rgb(var(--rs-text-3))]">Discuz · 选择板块发布主题</div>
        </div>
        <button class="rs-icon-btn h-9 w-9" type="button" aria-label="Close" @click="emit('close')">
          <i class="ri-close-line text-lg"></i>
        </button>
      </header>

      <div class="flex-1 overflow-auto p-4 scrollbar">
        <div v-if="error" class="mb-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-700">
          {{ error }}
        </div>
        <div v-else-if="ok" class="mb-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-700">
          {{ ok }}
        </div>

        <label class="block">
          <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">板块</div>
          <select
            v-model.number="fid"
            class="mt-2 w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] focus:outline-none"
          >
            <option v-for="o in forumOptions" :key="o.fid" :value="o.fid">{{ o.label }}</option>
          </select>
          <div class="mt-1 text-xs text-[rgb(var(--rs-text-3))]">
            旧版发主题必须选择具体板块（fid），大类仅用于浏览。
          </div>
        </label>

        <label v-if="typeOptions.length" class="mt-4 block">
          <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">主题分类</div>
          <select
            v-model="typeid"
            class="mt-2 w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] focus:outline-none"
          >
            <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>

        <label class="mt-4 block">
          <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">标题</div>
          <input
            v-model="subject"
            class="mt-2 w-full rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
            type="text"
            placeholder="请输入标题…"
          />
        </label>

        <label class="mt-4 block">
          <div class="text-xs font-semibold text-[rgb(var(--rs-text-2))]">内容</div>
          <textarea
            v-model="message"
            class="scrollbar mt-2 min-h-52 w-full resize-none rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel-2)/0.75)] px-3 py-2 text-sm text-[rgb(var(--rs-text))] placeholder:text-[rgb(var(--rs-text-3))] focus:outline-none"
            placeholder="请输入内容…"
          ></textarea>
        </label>

        <div class="mt-4 flex items-center justify-end gap-2">
          <button class="rs-btn px-4 py-2.5 text-sm" type="button" @click="emit('close')">取消</button>
          <button
            class="rounded-2xl bg-[rgb(var(--accent-500))] px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-[rgb(var(--accent-400))] disabled:opacity-40"
            type="button"
            :disabled="sending || loading"
            @click="submit"
          >
            <i v-if="sending" class="ri-loader-4-line mr-1 animate-spin"></i>
            发布
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

