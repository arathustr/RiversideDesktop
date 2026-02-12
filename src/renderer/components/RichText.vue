<script setup lang="ts">
import DOMPurify from "dompurify";
import { computed } from "vue";

const props = defineProps<{
  html: string;
  baseUrl?: string;
}>();

const baseUrl = computed(() => props.baseUrl || "https://river-side.cc");

const absolutizeUrl = (url: string) => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${baseUrl.value}${url}`;
  return url;
};

const absolutizeSrcset = (srcset: string) => {
  if (!srcset) return srcset;
  return srcset
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...rest] = part.split(/\s+/);
      if (!url) return part;
      const abs = absolutizeUrl(url);
      return [abs, ...rest].join(" ");
    })
    .join(", ");
};

const safeHtml = computed(() => {
  const html = props.html || "";
  let normalized = html;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (img.src) img.src = absolutizeUrl(img.getAttribute("src") || img.src);
      const srcset = img.getAttribute("srcset");
      if (srcset) img.setAttribute("srcset", absolutizeSrcset(srcset));
    });

    doc.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (href) a.setAttribute("href", absolutizeUrl(href));
    });

    doc.querySelectorAll<HTMLElement>("source").forEach((s) => {
      const src = s.getAttribute("src");
      if (src) s.setAttribute("src", absolutizeUrl(src));
      const srcset = s.getAttribute("srcset");
      if (srcset) s.setAttribute("srcset", absolutizeSrcset(srcset));
    });

    normalized = doc.body.innerHTML;
  } catch {
    normalized = html;
  }

  return DOMPurify.sanitize(normalized, {
    USE_PROFILES: { html: true },
  });
});
</script>

<template>
  <div v-html="safeHtml"></div>
</template>

