# Implementation Plan for Social Network Updates

This document outlines the approach for the extensive updates to the Social Network frontend and backend, ensuring high-quality, production-ready implementation similar to Facebook.

## User Review Required

> [!IMPORTANT]
> The architectural change in `auth.js` introduces a "Stale-While-Revalidate" caching pattern. This requires the frontend components to be updated to handle two consecutive data updates (one from cache, one from network).

> [!WARNING]
> Updating `backend/api/views.py` to support group name search might require a small database migration or just query changes. I will only touch `views.py`.

## Open Questions

1. **Caching Target**: Are there specific pages or components you want to prioritize for `authFetchCache` other than Profile and Friends?
2. **Chatbot Identification**: How is the chatbot currently identified in the conversation list? (e.g., a specific `user_id`, or `is_chatbot` flag?)

## Proposed Changes

---

### Caching Architecture (`auth.js`)

#### [MODIFY] [auth.js](file:///c:/Code/ALL/project-djangio/SocialNetwork/frontend/socialnetwork/static/js/authenticate/auth.js)
- Implement `authFetchCache(url, options, onCacheData, onNetworkData)`.
- Use `sessionStorage` or a fast RAM map to store GET request responses.
- When called:
  1. Synchronously look up `sessionStorage`. If found, call `onCacheData(parsedData)`.
  2. Asynchronously call `authFetch`.
  3. Compare network response with cache. If different, update cache and call `onNetworkData(newData)`.

---

### Backend Updates

#### [MODIFY] [views.py](file:///c:/Code/ALL/project-djangio/SocialNetwork/backend/api/views.py)
- **ConversationSearch**: Update the search query to also match group `name` (`Q(name__icontains=search)`).

---

### Chat & UI Updates

#### [MODIFY] [chat.js](file:///c:/Code/ALL/project-djangio/SocialNetwork/frontend/socialnetwork/static/js/pages/chat.js)
- **Chatbot Fixes**: 
  - Render user message instantly, then show a "typing..." indicator until the backend responds.
  - Remove "Delete", "View Members", "Create Vote" buttons for the chatbot.
  - Pin chatbot to the top or a fixed location.
- **Group Chat Restrictions**:
  - When `is_active` is false / left group, replace the input box with a disabled banner: "Bạn đã không còn trong group này".
- **Infinite Loading Fix**: 
  - Fix the bug where clicking the 3rd conversation causes a freeze. This is likely a Promise resolving state issue or race condition in DOM update.
- **Todo Task Modal**:
  - Integrate Task API. Add "In Progress" status toggle. 
  - Hide "Mark Done" if already done.
  - Restrict edit/complete actions to the creator (check `task.created_by.id == currentUser.id`).
- **Vote Group Modal**:
  - Integrate Vote API endpoints (Create, Delete, Update, AddOption, UpdateOption, DeleteOption, ListVote, ListUserVote, UserVote).
  - Calculate percentage for options dynamically.
- **Search Integration**:
  - Add search bar to the conversation list -> calls `ConversationSearch`.
  - Add search bar to Task modal -> calls Task List API with `?search=`.
  - Add search bar to Vote modal -> calls Vote List API with `?search=`.

#### [MODIFY] [settings.html / userpage.js / css]
- **Mobile UI/UX**: Ensure CSS media queries properly display the settings and user page on mobile devices.
- **Aesthetics**: Apply premium design changes (dynamic animations, beautiful UI elements) as per requirements.

## Verification Plan

### Automated Tests
- N/A

### Manual Verification
- **Cache**: Load profile page, refresh, check if data loads instantly from cache.
- **Chat**: 
  - Send message to chatbot, ensure no lag for user message.
  - Leave group, ensure input box is disabled.
  - Click through 4 conversations rapidly to ensure no freezing.
- **Tasks & Votes**: Open modals, interact with all CRUD operations. Check permissions (creator vs non-creator).
- **Mobile UI**: View app in mobile simulator, ensure aesthetics and layout are perfect.
