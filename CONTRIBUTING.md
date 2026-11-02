# Contributing to iweb

Thanks for helping. iweb is small on purpose: plain Node, vanilla JavaScript, and no dependencies. Please keep it that way. A pull request that adds an npm package needs a very good reason.

## Getting set up

```bash
npm start      # the app at http://localhost:3000
npm run dev    # the same, restarting when server files change
npm run demo   # the read-only public demo mode
npm test       # unit tests and server tests; none of them need the network
```

You need Node 22 or newer. Copy `.env.example` to `.env` only for the sources you're working on.

## Before you open a pull request

- `npm test` passes. Add a test when you fix a bug or add behaviour in `lib/`.
- The change works in the browser at desktop and phone widths (about 390px). For anything visual, add before/after screenshots to the pull request.
- Visual changes keep the existing look: true black, one blue for the feed's reasoning only, Inter for words and Geist Mono for numbers only, and liquid glass only on floating chrome. The colours, sizes and radii are tokens at the top of `public/styles.css`; use those.
- Keep each pull request to one change. Small ones get reviewed faster.

## Adding a platform

Each platform is a single file in `connectors/` that turns the platform's posts into one common shape. To add one:

1. Create `connectors/<name>.js` and export an object like this:

```js
export default {
  id: 'mastodon',               // stable id, used in settings and post ids
  label: 'Mastodon',            // shown in the sidebar and settings
  color: '#6364ff',             // the source's identity dot; check it doesn't clash with the others
  scoreLabel: 'favourites',     // the word after the number in "120 favourites", or null
  pace: 1,                      // above 1 means posts fade more slowly (use for slow sources)
  note: 'Shown at the top of this source in Tune feed.',
  requiredEnv: [],              // keys that must be in .env before this source can run
  fields: [                     // Tune feed builds its settings form from these
    { key: 'accounts', type: 'list', label: 'Accounts', placeholder: '@user@mastodon.social' },
  ],
  defaults: { enabled: true, weight: 1, accounts: [] },

  async fetch(cfg, ctx) {
    // cfg: this source's settings. ctx: { env, force, interests, token, authFailed }
    return { items: [], errors: [] };
  },
};
```

2. Add it to the list in `connectors/index.js`.

Every post you return should have this shape. Leave out what the platform doesn't have.

```js
{
  id: 'mastodon:109',                    // '<source>:<platform id>', unique
  source: 'mastodon',
  author: 'Display Name', authorHandle: '@user', authorKey: 'mastodon:user@host', avatar: 'https://…',
  community: null,                       // a subreddit, a feed's name…
  title: '', text: 'The post text',      // plain text, not HTML
  url: 'https://…',                      // where "Open" goes
  domain: null, link: null,              // for posts that share an article
  discussion: { url: 'https://…', comments: 12 },
  createdAt: 1730000000000,              // milliseconds
  engagement: { score: 120, comments: 12 },
  media: { type: 'image', thumb: 'https://…', full: 'https://…', w: 1200, h: 800 },  // or 'video' with stream, or 'youtube' with embedId
}
```

**Rules for connectors:**

- **Official APIs and public feeds only.** No scraping, no spoofing a browser's user agent, and no getting around rate limits or bot checks.
- **Use the helpers.** Fetch through `getJSON`/`getText` in `lib/http.js`, which cache responses. Pass `untrusted: true` for any URL a user typed in. Use `gather()` in `connectors/_shared.js` to fetch a list of accounts in parallel, so one bad entry doesn't sink the whole source.
- **Report problems, don't crash.** Throw `SetupError` when a key is missing, and return per-entry problems in `errors`. They appear in Tune feed.
- **Treat everything from the platform as untrusted text.** The app renders it with `textContent`. Never build HTML from it.
- **Keep sign-in tokens on the server.** If the platform has user sign-in, add it to `lib/accounts.js` next to Google and Reddit.

## Where things live

`server.js` serves the API and the app. `lib/` holds ranking, de-duplication, storage, sign-in, the password gate and the network guard. `public/` holds the web app.

## License of contributions

By contributing, you agree that your contribution is licensed under the project's license, the [GNU AGPL-3.0](LICENSE) or later.
