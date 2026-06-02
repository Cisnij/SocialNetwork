/** Shared API and UI constants (single source of truth). */
export const API_BASE_URL =
  window.APP_CONFIG?.API_BASE_URL || "http://localhost:8000";

export const FRONTEND_URL =
  window.APP_CONFIG?.FRONTEND_URL || "http://localhost:3000";

export function shareLink(shareCode) {
  return `${FRONTEND_URL}/post/share/${shareCode}/`;
}

export const DEFAULT_AVATAR =
  window.APP_CONFIG?.DEFAULT_AVATAR ||
  "https://res.cloudinary.com/dec8t19tm/image/upload/v1779183832/default.jpg";

/** Override backend default page sizes (feed 20, userpage 5) for consistent UX. */
export const POST_PAGE_SIZE = {
  feed: 20,
  userpage: 10,
};

export const POST_LIST_TTL_MS = 5 * 60 * 1000;

export const POST_ENDPOINTS = {
  feed: () => `${API_BASE_URL}/api/user/post/show/`,
  userpage: (profileId) =>
    `${API_BASE_URL}/api/user/post/userpage/${profileId}/`,
  react: (postId) => `${API_BASE_URL}/api/posts/${postId}/react/`,
  reactions: (postId) => `${API_BASE_URL}/api/user/reaction/post/${postId}/`,
  post: (postId) => `${API_BASE_URL}/api/user/post/${postId}/`,
  deletePhoto: (photoId) =>
    `${API_BASE_URL}/api/user/delete-photo/${photoId}/`,
  addPhoto: (postId) => `${API_BASE_URL}/api/user/post-photo/${postId}/`,
  create: () => `${API_BASE_URL}/api/user/post/create/v2/`,
};

export function profileUrl(profileId) {
  return `/profile/${profileId}`;
}

/** Append query params to an absolute API list URL. */
export function buildListUrl(basePath, pageSize, ordering = "-created_at") {
  const url = new URL(basePath);
  if (pageSize != null && !url.searchParams.has("page_size")) {
    url.searchParams.set("page_size", String(pageSize));
  }
  if (ordering && !url.searchParams.has("ordering")) {
    url.searchParams.set("ordering", ordering);
  }
  return url.toString();
}

/** Page size only — avoids invalid ordering on friends/chat/etc. */
export function withPageSize(basePath, pageSize) {
  const url = new URL(basePath);
  url.searchParams.set("page_size", String(pageSize));
  return url.toString();
}

export const WS_BASE_URL =
  window.APP_CONFIG?.WS_BASE_URL ||
  API_BASE_URL.replace(/^http/, "ws");

/** All REST endpoints (excludes auth, spectacular, post-article). */
export const API = {
  user: () => `${API_BASE_URL}/api/user/`,
  profile: (id) => `${API_BASE_URL}/api/user/profile/${id}/`,
  profileUserpage: (id) => `${API_BASE_URL}/api/auth/profile/userpage/${id}/`,
  privateProfile: (id) => `${API_BASE_URL}/api/user/private-profile/${id}/`,
  relationship: (profileId) => `${API_BASE_URL}/api/relationship/${profileId}/`,

  comments: (postId) => `${API_BASE_URL}/api/user/comments/post/${postId}/`,
  comment: (id) => `${API_BASE_URL}/api/user/comments/${id}/`,
  nestedComments: (id) => `${API_BASE_URL}/api/user/nested-comments/${id}/`,
  pinComment: (id) => `${API_BASE_URL}/api/user/comment/pin/${id}/`,
  commentReact: (id) => `${API_BASE_URL}/api/comments/${id}/react/`,
  commentReactions: (id) =>
    `${API_BASE_URL}/api/user/reaction/comment/${id}/`,

  postPrivacy: (postId) => `${API_BASE_URL}/api/post/${postId}/privacy-change/`,
  postShares: (postId) => `${API_BASE_URL}/api/posts/${postId}/share/`,
  pinPost: (postId) => `${API_BASE_URL}/api/post/${postId}/pin/`,
  reportPost: (postId) => `${API_BASE_URL}/api/post/${postId}/report/`,
  shareDelete: (id) => `${API_BASE_URL}/api/posts/share/${id}/delete/`,
  sharesFeed: () => `${API_BASE_URL}/api/posts/share/`,
  userShares: (profileId) => `${API_BASE_URL}/api/posts/user/${profileId}/share/`,
  sharePrivacy: (shareId) =>
    `${API_BASE_URL}/api/post/share/${shareId}/privacy-change/`,
  shareDetail: (code) => `${API_BASE_URL}/api/share-detail/${code}/`,

  friends: () => `${API_BASE_URL}/api/friends/`,
  friendsOf: (profileId) => `${API_BASE_URL}/api/friends/${profileId}/`,
  friendRequest: (profileId) =>
    `${API_BASE_URL}/api/friends/request/${profileId}/`,
  incomingRequests: () => `${API_BASE_URL}/api/friends/requests/incoming/`,
  outgoingRequests: () => `${API_BASE_URL}/api/friends/requests/outgoing/`,
  acceptRequest: (id) => `${API_BASE_URL}/api/friends/request/${id}/accept/`,
  rejectRequest: (id) => `${API_BASE_URL}/api/friends/request/${id}/reject/`,
  cancelRequest: (id) => `${API_BASE_URL}/api/friends/request/${id}/cancel/`,
  unfriend: (profileId) => `${API_BASE_URL}/api/friends/unfriend/${profileId}/`,
  friendSuggest: () => `${API_BASE_URL}/api/user/friend-suggest/`,

  follow: (profileId) => `${API_BASE_URL}/api/follow/${profileId}/`,
  unfollow: (profileId) => `${API_BASE_URL}/api/unfollow/${profileId}/`,
  followers: () => `${API_BASE_URL}/api/followers/`,
  following: () => `${API_BASE_URL}/api/following/`,

  block: (profileId) => `${API_BASE_URL}/api/block/${profileId}/`,
  unblock: (profileId) => `${API_BASE_URL}/api/unblock/${profileId}/`,
  blockedByMe: () => `${API_BASE_URL}/api/block/user/`,
  blockedMe: () => `${API_BASE_URL}/api/block/touser/`,

  setting: (id) => `${API_BASE_URL}/api/user/setting/${id}/`,
  userSetting: () => `${API_BASE_URL}/api/user/setting/`,
  activity: () => `${API_BASE_URL}/api/user/activity/`,
  search: (q, type = "all") =>
    `${API_BASE_URL}/api/search/?q=${encodeURIComponent(q)}&type=${type}`,
  searchHistory: () => `${API_BASE_URL}/api/user/search-history/`,
  searchHistoryDelete: (id) => `${API_BASE_URL}/api/search-history/${id}/delete/`,
  searchHistoryDeleteAll: () => `${API_BASE_URL}/api/search-history/delete/`,

  notifications: () => `${API_BASE_URL}/api/notifications/`,
  notificationsMarkRead: () => `${API_BASE_URL}/api/notifications/mark-read/`,
  notificationsCount: () => `${API_BASE_URL}/api/notifications/count/`,
  fcmToken: () => `${API_BASE_URL}/api/fcm-token/`,

  conversations: () => `${API_BASE_URL}/api/chat/conversations/`,
  startChat: (profileId) => `${API_BASE_URL}/api/chat/start/${profileId}/`,
  messages: (convId) => `${API_BASE_URL}/api/chat/messages/list/${convId}/`,
  seenMessage: (convId) => `${API_BASE_URL}/api/chat/messages/seen/${convId}/`,
  unsendMessage: (id) => `${API_BASE_URL}/api/chat/messages/unsend/${id}/`,
  updateMessage: (id) => `${API_BASE_URL}/api/chat/messages/update/${id}/`,
  acceptConv: (id) => `${API_BASE_URL}/api/chat/accept/conversation/${id}/`,
  rejectConv: (id) => `${API_BASE_URL}/api/chat/reject/conversation/${id}/`,
  hideConv: (id) => `${API_BASE_URL}/api/chat/conversation/${id}/toogle-hidden/`,
  deleteConv: (id) => `${API_BASE_URL}/api/chat/conversation/${id}/delete/`,
  hiddenChats: () => `${API_BASE_URL}/api/chat/conversation/hidden-chat/`,
  chatUpload: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/upload/`,

  emails: () => `${API_BASE_URL}/api/user/email/`,
  addEmail: () => `${API_BASE_URL}/api/email/add/`,
  setPrimaryEmail: (id) => `${API_BASE_URL}/api/email/set/${id}/`,
  deleteEmail: (id) => `${API_BASE_URL}/api/email/delete/${id}/`,
  deleteAccount: () => `${API_BASE_URL}/api/auth/delete-account/`,
  supportTicket: () => `${API_BASE_URL}/api/support-ticket/`,

  wsChat: (convId) => {
    const token = localStorage.getItem("accessToken");
    const base = `${WS_BASE_URL}/ws/chat/${convId}/`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  wsNotifications: () => {
    const token = localStorage.getItem("accessToken");
    const base = `${WS_BASE_URL}/ws/notifications/`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  wsConversations: () => {
    const token = localStorage.getItem("accessToken");
    const base = `${WS_BASE_URL}/ws/conversations/`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
};
