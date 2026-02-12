/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare global {
  interface Window {
    riverside?: {
      platform: string;
      window: {
        minimize: () => Promise<void>;
        toggleMaximize: () => Promise<void>;
        close: () => Promise<void>;
        getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
        getMinSize: () => Promise<[number, number]>;
        setBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
        setCollapsed: (collapsed: boolean) => Promise<{ ok: boolean; collapsed?: boolean }>;
      };
      files: {
        pickImages: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      forum: {
        getSession: () => Promise<{
          loggedIn: boolean;
          currentUser: null | {
            id: number;
            username: string;
            name: string;
            title: string;
            avatarUrl: string | null;
            unreadNotifications: number;
          };
          error?: string;
        }>;
        openLogin: () => Promise<void>;
        openProfileSettings: () => Promise<any>;
        logout: () => Promise<void>;
        listEmojis: () => Promise<{ ok: boolean; emojis: { name: string; url: string; group: string }[] }>;
        listDMs: () => Promise<any>;
        listChatChannels: () => Promise<any>;
        getChatMessages: (channelId: number | string, opts?: any) => Promise<any>;
        markChatChannelRead: (channelId: number | string, messageId?: number | null) => Promise<any>;
        sendChatMessage: (
          channelId: number | string,
          message: string,
          uploadIds?: number[],
          replyToMessageId?: number | null
        ) => Promise<any>;
        uploadFile: (filePath: string, type?: string) => Promise<any>;
        uploadBytes: (payload: {
          dataBase64: string;
          fileName?: string;
          mimeType?: string;
          type?: string;
        }) => Promise<any>;
        getMyProfile: () => Promise<any>;
        updateMyProfile: (payload: any) => Promise<any>;
        updateMyAvatar: (filePath: string) => Promise<any>;
        getTopic: (topicId: number | string) => Promise<any>;
        replyTopic: (
          topicId: number | string,
          raw: string,
          uploadIds?: number[],
          replyToPostNumber?: number | null
        ) => Promise<any>;
        listLatest: (opts?: { page?: number }) => Promise<any>;
        listCategoryTopics: (categoryId: number | string, slug?: string, page?: number) => Promise<any>;
        listUserCreatedTopics: (payload: { username: string }) => Promise<any>;
        searchUsers: (payload: { term: string; limit?: number }) => Promise<any>;
        getUser: (username: string) => Promise<any>;
        ensureDmWith: (payload: { username: string; userId?: number }) => Promise<any>;
        createTopic: (payload: {
          title: string;
          raw: string;
          categoryId?: number | null;
          uploadIds?: number[];
        }) => Promise<any>;
        setLikeOnTopic: (topicId: number | string, liked: boolean) => Promise<any>;
        listNotifications: (opts?: {
          limit?: number;
          unreadOnly?: boolean;
          kinds?: Array<"mention" | "reply" | "other">;
        }) => Promise<any>;
        markNotificationRead: (payload: { id: number }) => Promise<any>;
        markAllNotificationsRead: () => Promise<any>;
      };
      legacy: {
        getSession: () => Promise<{
          loggedIn: boolean;
          currentUser: null | {
            id: number;
            username: string;
            name: string;
            avatarUrl: string | null;
          };
          error?: string;
        }>;
        openLogin: () => Promise<void>;
        logout: () => Promise<void>;
        listForumTree: () => Promise<any>;
        listLatest: (payload?: { view?: string; page?: number }) => Promise<any>;
        listForumThreads: (payload: { fid: number; page?: number }) => Promise<any>;
        getThread: (payload: { tid: number; page?: number }) => Promise<any>;
        resolveFindpost: (payload: { ptid: number; pid: number }) => Promise<any>;
        getNewThreadForm: (payload: { fid: number }) => Promise<any>;
        createThread: (payload: {
          fid: number;
          subject: string;
          message: string;
          typeid?: string | number | null;
        }) => Promise<any>;
        getReplyForm: (payload: { fid: number; tid: number; repquotePid?: number | null }) => Promise<any>;
        replyThread: (payload: {
          fid: number;
          tid: number;
          message: string;
          repquotePid?: number | null;
        }) => Promise<any>;
        listPmThreads: () => Promise<any>;
        getPmMessages: (payload: { touid: number; plid?: number; page?: number }) => Promise<any>;
        sendPmMessage: (payload: { touid: number; plid?: number; message: string }) => Promise<any>;
        searchUsers: (payload: { term: string; limit?: number }) => Promise<any>;
        getUser: (payload: { uid?: number | string; username?: string }) => Promise<any>;
        listUserCreatedTopics: (payload: { uid?: number | string; username?: string }) => Promise<any>;
        listNotifications: (opts?: {
          limit?: number;
          kinds?: Array<"mention" | "reply" | "other">;
        }) => Promise<any>;
        openExternal: (url: string) => Promise<any>;
      };
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export {};
