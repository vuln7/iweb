# iweb: your personal internet

One feed built from the places you already follow: YouTube channels, subreddits, X accounts, Bluesky follows, Instagram creators, Hacker News and any RSS feed. It ranks everything together for you and learns from what you like.

## Run it

Requires Node 20+. There are no dependencies to install.

```bash
npm start
```

Open http://localhost:3000, then click **Tune my feed** to add your interests and accounts.

Out of the box, Bluesky, Hacker News and RSS work with no keys. For everything else, copy `.env.example` to `.env`, add the keys you want, and restart.

## Sign in with your accounts

**Tune my feed → Your accounts** has "Sign in with Google" (imports your YouTube subscriptions) and "Sign in with Reddit" (imports your Reddit home feed). Each one needs a free developer app, set up once. The settings panel walks you through it and shows the exact redirect URI to register:

- **Google:** in [Cloud Console](https://console.cloud.google.com/apis/credentials), enable *YouTube Data API v3* and create an OAuth client ID of type *Web application*. Set the redirect URI to `http://localhost:3000/auth/youtube/callback`, add yourself as a test user, then put `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in `.env`. While the app is in Testing mode, Google ends the sign-in after 7 days, so you reconnect weekly. Publishing the app removes this.
- **Reddit:** at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps), create a *web app* with redirect URI `http://localhost:3000/auth/reddit/callback`, then put `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` in `.env`.

Sign-in is a standard OAuth authorization-code flow with a CSRF `state` check, and it requests read-only scopes. Tokens are stored in `data/accounts.json` on your machine and never sent to the browser. They refresh automatically. "Disconnect" deletes and revokes them.

| Source | What it pulls | What it needs |
|---|---|---|
| Bluesky | Everyone your handle follows, plus any extra accounts | Nothing (public API) |
| Hacker News | Front page, plus stories matching your interests | Nothing |
| Blogs & RSS | Any RSS/Atom feed: news, Substack, Mastodon (`@user.rss`), podcasts | Nothing |
| Reddit | Your home feed (signed in), plus any subreddits you list | Sign in with Reddit. Without it, iweb falls back to public RSS, which gets rate-limited |
| YouTube | Your subscriptions (signed in), plus channels you list and discovery by interest | Sign in with Google, or a `YOUTUBE_API_KEY` for listed channels only |
| X | Recent posts from accounts you list | `X_BEARER_TOKEN`, which requires a **paid** X API plan |
| Instagram | Recent posts from public Business/Creator accounts | Meta developer app plus an Instagram professional account (`IG_ACCESS_TOKEN`, `IG_USER_ID`). Instagram has no API for a personal home feed |

## How the feed is curated

Each post's score is built from these parts (see `lib/ranker.js`):

- **Interests.** Posts that mention your topics get boosted, and HN/YouTube also search for them.
- **Learned taste.** "More like this" and "Less like this" adjust the weights of words and authors. Settings shows what it has learned, and you can reset it.
- **Popularity, relative to each platform.** A post is compared with its own source's top 10%, so a million YouTube views and 300 HN points are on a comparable scale.
- **Freshness.** Older posts fade out. Slow sources such as YouTube and blogs fade more slowly, so Reddit's constant churn doesn't bury them.
- **Your source weights.** A per-source slider sets "less ↔ more of this".
- **Balance.** Sources with lots of posts get a volume correction, and a final pass stops any single source or author from dominating a stretch of the feed.

Every card shows **why** it's there ("Matches 'space'", "Trending", "You've liked X before"). When the same link appears in several places, it becomes one card with "Also on r/space · 340 comments" links.

## Layout

```
server.js            HTTP server + JSON API (no framework)
connectors/*.js      one file per platform → normalized items
lib/ranker.js        scoring, diversity, learning from feedback
lib/dedupe.js        cross-platform duplicate merging
lib/profile.js       your settings + learned taste (data/profile.json)
public/              the web app (vanilla JS)
```

To add a platform, write `connectors/<name>.js` exporting `{ id, label, color, fields, defaults, fetch(cfg, ctx) }` and add it to `connectors/index.js`. The settings UI is generated from `fields`.

## Next steps toward a multi-user product

- **Sign in with X** (OAuth 2.0 PKCE plus the reverse-chronological timeline endpoint) can follow the same pattern in `lib/accounts.js`. It needs a paid X API plan.
- **User accounts and a database** in place of `data/profile.json`, plus a background job that fetches sources on a schedule instead of on page load.
- **Embedding-based relevance** (semantic similarity to posts you liked) in place of keyword affinity.
