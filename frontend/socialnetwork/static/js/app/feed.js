/**
 * Feed page — thin entry using shared post infinite loader.
 */
import { getCurrentUserId } from "./profile.js";
import {
  buildListUrl,
  POST_ENDPOINTS,
  POST_PAGE_SIZE,
} from "../shared/config.js";
import { PostInfiniteLoader } from "../shared/posts/infinite-loader.js";

const CACHE_KEY = "feed";
const listUrl = buildListUrl(
  POST_ENDPOINTS.feed(),
  POST_PAGE_SIZE.feed
);

let feedLoader = null;

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("post-container");
  if (!container) return;

  feedLoader = new PostInfiniteLoader({
    container,
    cacheKey: CACHE_KEY,
    initialUrl: listUrl,
    getCurrentUserId,
  });

  await feedLoader.init();
});

