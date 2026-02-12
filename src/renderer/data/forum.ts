export interface ForumUser {
  id: number;
  username: string;
  name: string;
  title?: string;
  avatarUrl: string | null;
  source?: "discourse" | "discuz";
  legacy?: Record<string, any>;
}

export type ChatChannelKind = "public" | "dm";

export interface ChatChannel {
  id: number;
  kind: ChatChannelKind;
  title: string;
  description: string;
  participants: ForumUser[];
  avatarUrl: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  unread: number;
  isGroup: boolean;
  url: string;
  source?: "discourse" | "discuz";
  legacy?: Record<string, any>;
}

export interface ForumTopic {
  id: number;
  title: string;
  slug: string;
  participants: ForumUser[];
}

export type MessageFrom = "me" | "them" | "system";

export type ReplyToInfo = {
  messageId?: number | null;
  postNumber?: number | null;
  username: string;
  avatarUrl: string | null;
  excerpt?: string | null;
};

export type ForumUpload = {
  url: string;
  thumbnailUrl?: string | null;
  originalFilename?: string | null;
  width?: number | null;
  height?: number | null;
};

export type ForumEmoji = {
  name: string;
  url: string;
  group?: string | null;
};

export interface ForumMessage {
  id: number;
  renderKey?: string;
  from: MessageFrom;
  userId?: number | null;
  username: string;
  avatarUrl: string | null;
  cooked: string;
  createdAt: string;
  postNumber?: number | null;
  replyTo?: ReplyToInfo | null;
  uploads?: ForumUpload[] | null;
  localOnly?: boolean;
  localSig?: string;
  localBaseId?: number | null;
  source?: "discourse" | "discuz";
  legacy?: Record<string, any>;
}

export interface ForumCategory {
  id: number;
  name: string;
  color: string;
  textColor: string;
}

export interface BrowseCategory extends ForumCategory {
  slug: string;
  description: string;
  position: number;
  parentId?: number | null;
  permission?: number | null;
}

export interface FeedPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  likeCount: number;
  liked: boolean;
  replyCount: number;
  views: number;
  lastPostedAt: string;
  createdAt: string;
  category: ForumCategory | null;
  author: ForumUser | null;
  url: string;
  source?: "discourse" | "discuz";
  legacy?: Record<string, any>;
}

export type ForumNotificationKind = "mention" | "reply" | "other";

export type ForumNotification = {
  id: number;
  kind: ForumNotificationKind;
  read: boolean;
  createdAt: string;
  username: string | null;
  userId: number | null;
  avatarUrl: string | null;
  title: string | null;
  excerpt: string | null;
  topicId: number | null;
  postNumber: number | null;
  chatChannelId: number | null;
  chatMessageId: number | null;
  url: string | null;
  source?: "discourse" | "discuz";
  legacy?: Record<string, any>;
};
