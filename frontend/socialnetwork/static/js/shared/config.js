/** Shared API and UI constants (single source of truth). */
export const API_BASE_URL =
  window.APP_CONFIG?.API_BASE_URL || "http://localhost:80";

export const FRONTEND_URL =
  window.APP_CONFIG?.FRONTEND_URL || "http://localhost:3000";

export function shareLink(shareCode) {
  return `${FRONTEND_URL}/post/share/${shareCode}/`;
}

export const DEFAULT_AVATAR =
  window.APP_CONFIG?.DEFAULT_AVATAR ||
  "https://res.cloudinary.com/dec8t19tm/image/upload/v1781533632/default-avatar_qprrlr.jpg";

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
export function buildListUrl(basePath, pageSize, ordering = "") {
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
  reportComment: (commentId) => `${API_BASE_URL}/api/comment/${commentId}/report/`,

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
  friendsAvailableForGroup: (convId) =>
    `${API_BASE_URL}/api/friends/?exclude_group_id=${encodeURIComponent(convId)}`,
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
  notificationDelete: (id) => `${API_BASE_URL}/api/notification/${id}/delete/`,
  fcmToken: () => `${API_BASE_URL}/api/fcm-token/`,

  conversations: () => `${API_BASE_URL}/api/chat/conversations/`,
  searchConversations: (q) => `${API_BASE_URL}/api/chat/search-conversations/?search=${encodeURIComponent(q)}`,
  startChat: (profileId) => `${API_BASE_URL}/api/chat/start/${profileId}/`,
  messages: (convId) => `${API_BASE_URL}/api/chat/messages/list/${convId}/`,
  conversationMembers: (convId) => `${API_BASE_URL}/api/chat/conversation/members/${convId}/`,
  seenMessage: (convId) => `${API_BASE_URL}/api/chat/messages/seen/${convId}/`,
  unsendMessage: (id) => `${API_BASE_URL}/api/chat/messages/unsend/${id}/`,
  updateMessage: (id) => `${API_BASE_URL}/api/chat/messages/update/${id}/`,
  acceptConv: (id) => `${API_BASE_URL}/api/chat/accept/conversation/${id}/`,
  rejectConv: (id) => `${API_BASE_URL}/api/chat/reject/conversation/${id}/`,
  hideConv: (id) => `${API_BASE_URL}/api/chat/conversation/${id}/toogle-hidden/`,
  deleteConv: (id) => `${API_BASE_URL}/api/chat/conversation/${id}/delete/`,
  hiddenChats: () => `${API_BASE_URL}/api/chat/conversation/hidden-chat/`,
  chatUpload: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/upload/`,
  chatFiles: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/file-list/`,
  createGroupChat: () => `${API_BASE_URL}/api/chat/conversation/group/create-group/`,
  transferGroupAdmin: (convId) => `${API_BASE_URL}/api/chat/conversation/group/${convId}/transfer-admin/`,
  addGroupMembers: (convId) => `${API_BASE_URL}/api/chat/conversation/group/${convId}/add/`,
  modifyGroupChat: (convId) => `${API_BASE_URL}/api/chat/conversation/group/${convId}/modify/`,
  deleteGroupChat: (convId) => `${API_BASE_URL}/api/chat/conversation/group/${convId}/delete/`,
  kickGroupMember: (convId, userId) => `${API_BASE_URL}/api/chat/conversation/group/${convId}/kick/${userId}/`,
  leaveGroupChat: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/leave/`,
  createTask: (convId) => `${API_BASE_URL}/api/chat/conversation/task/${convId}/create-task/`,
  addTaskMembers: (convId) => `${API_BASE_URL}/api/chat/conversation/task/${convId}/add-member/`,
  taskMembers: (convId, taskId) => `${API_BASE_URL}/api/chat/conversation/${convId}/task/${taskId}/member/`,
  updateTask: (convId, taskId) => `${API_BASE_URL}/api/chat/conversation/${convId}/task/${taskId}/update/`,
  deleteTask: (convId, taskId) => `${API_BASE_URL}/api/chat/conversation/${convId}/task/${taskId}/delete/`,
  listTasks: (convId, search = "") => {
    const base = `${API_BASE_URL}/api/chat/conversation/task/${convId}/list-task/`;
    return search ? `${base}?search=${encodeURIComponent(search)}` : base;
  },
  createVote: (convId) => `${API_BASE_URL}/api/chat/conversation/vote/${convId}/create-vote/`,
  deleteVote: (convId, voteId) => `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/delete-vote/`,
  updateVote: (convId, voteId) => `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/update-vote/`,
  addVoteOptions: (convId, voteId) => `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/add-option/`,
  updateVoteOption: (convId, voteId, optionId) =>
    `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/option/${optionId}/update-option/`,
  deleteVoteOption: (convId, voteId, optionId) =>
    `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/option/${optionId}/delete-option/`,
  listVotes: (convId, search = "") => {
    const base = `${API_BASE_URL}/api/chat/conversation/${convId}/vote/list-vote/`;
    return search ? `${base}?search=${encodeURIComponent(search)}` : base;
  },
  listUserVotes: (convId, voteId, optionId) => `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/option/${optionId}/user/`,
  userVote: (convId, voteId, optionId) =>
    `${API_BASE_URL}/api/chat/conversation/${convId}/vote/${voteId}/option/${optionId}/vote/`,

  // Video call
  createVideoRoom: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/call-video/create/`,
  joinVideoRoom: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/call-video/join/`,
  declineCall: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/call-video/decline/`,

  // Events
  createEvent: (convId) => `${API_BASE_URL}/api/chat/conversation/${convId}/create-event/`,
  listEvents: (convId, search = "") => {
    const base = `${API_BASE_URL}/api/chat/conversation/${convId}/create-event/`;
    return search ? `${base}?search=${encodeURIComponent(search)}` : base;
  },
  eventDetail: (convId, eventId) => `${API_BASE_URL}/api/chat/conversation/${convId}/event/${eventId}/`,
  updateEventStatus: (convId, eventId) => `${API_BASE_URL}/api/chat/conversation/${convId}/event/${eventId}/update-status/`,

  emails: () => `${API_BASE_URL}/api/user/email/`,
  addEmail: () => `${API_BASE_URL}/api/email/add/`,
  setPrimaryEmail: (id) => `${API_BASE_URL}/api/email/set/${id}/`,
  deleteEmail: (id) => `${API_BASE_URL}/api/email/delete/${id}/`,
  confirmPrimaryEmailOtp: () => `${API_BASE_URL}/api/email/confirm-change-primary/`,
  checkPassword: () => `${API_BASE_URL}/api/auth/check-password/`,
  hasPassword: () => `${API_BASE_URL}/api/auth/has-password/`,
  passwordChange: () => `${API_BASE_URL}/api/auth/password/change/`,
  deleteAccount: () => `${API_BASE_URL}/api/auth/delete-account/`,
  confirmDeleteAccount: () => `${API_BASE_URL}/api/email/cofirm-delete-account/`,
  supportTicket: () => `${API_BASE_URL}/api/support/`,

  wsChat: (convId) => {
    // Web: session cookie auth via AuthMiddlewareStack (no token param)
    return `${WS_BASE_URL}/ws/chat/${convId}/`;
  },
  wsNotifications: () => {
    // Web: session cookie auth via AuthMiddlewareStack (no token param)
    return `${WS_BASE_URL}/ws/notifications/`;
  },
  wsConversations: () => {
    // Web: session cookie auth via AuthMiddlewareStack (no token param)
    return `${WS_BASE_URL}/ws/conversations/`;
  },
};
