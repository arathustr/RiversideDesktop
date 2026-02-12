<script setup lang="ts">
import ChatWindow from "@/components/ChatWindow.vue";
import type { ChatChannel, ForumMessage, ForumUpload, ForumUser } from "@/data/forum";

const props = defineProps<{
  me: ForumUser;
  channel: ChatChannel | null;
  messages: ForumMessage[];
  moreUrl?: string | null;
  loadOlder?: (() => Promise<void>) | null;
  hasMoreHistory?: boolean;
  attachmentsEnabled?: boolean;
  mentionProvider?: "forum" | "legacy" | "none";
}>();

const emit = defineEmits<{
  (e: "send", payload: { text: string; uploadIds?: number[]; uploads?: ForumUpload[]; replyToMessageId?: number | null }): void;
  (e: "refresh"): void;
  (e: "openUser", payload: { username: string; userId?: number | null; avatarUrl?: string | null }): void;
}>();

const subtitle = () => {
  if (!props.channel) return "";
  if (props.channel.kind === "public") return props.channel.description || "公开频道";
  const names = props.channel.participants
    .filter((p) => p.id !== props.me.id)
    .map((p) => p.name || p.username)
    .filter(Boolean);
  return names.length > 0 ? names.join(" · ") : "私聊";
};
</script>

<template>
  <div class="h-full min-w-0 flex-1">
    <ChatWindow
      v-if="channel"
      :me="me"
      :title="channel.title"
      :subtitle="subtitle()"
      :messages="messages"
      :more-url="moreUrl || undefined"
      :load-older="props.loadOlder || undefined"
      :has-more-history="props.hasMoreHistory ?? true"
      :attachments-enabled="props.attachmentsEnabled"
      :mention-provider="props.mentionProvider"
      upload-type="chat_message"
      @send="emit('send', $event)"
      @openUser="emit('openUser', $event)"
    >
      <template #actions>
        <button
          class="rs-icon-btn h-9 w-9"
          type="button"
          aria-label="Refresh"
          @click="emit('refresh')"
        >
          <i class="ri-refresh-line"></i>
        </button>
      </template>
    </ChatWindow>

    <div v-else class="flex h-full items-center justify-center rounded-2xl border border-[rgb(var(--rs-border))] bg-[rgb(var(--rs-panel))] shadow-soft">
      <div class="text-center">
        <div class="text-sm font-semibold text-[rgb(var(--rs-text)/0.8)]">选择一个会话开始聊天</div>
      </div>
    </div>
  </div>
</template>
