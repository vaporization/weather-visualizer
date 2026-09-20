# Weather Visualizer — provider keys

Four layers talk to providers that meter usage per account, so each person running the app supplies their own free keys. Nothing is shared, proxied or billed centrally: a key is stored on your machine, sent only to the provider it belongs to, and never shown in full once saved. Everything else in the app works without any key.

| Key | Unlocks | Free allowance | What the app spends |
|---|---|---|---|
| ArcGIS API key | Higher-quota surface imagery (optional) | 2,000,000 basemap tiles a month | One request per imagery tile the camera reveals; tiles are cached on the server and in the browser, so revisiting an area does not spend again |
| NASA FIRMS map key | Active fires | 5,000 transactions per 10 minutes | 3 requests every 30 minutes (one per VIIRS instrument) |
| AISStream API key | Ships | Unmetered stream | One websocket held open while the layer is on; closes 3 minutes after you turn it off |
| TomTom API key | Traffic congestion | 2,500 requests a day | 25 tile requests every 2 minutes while the layer is on, and again when you select a new place (about 3 hours of continuous use a day) |

Without the ArcGIS key, imagery comes from Esri's public endpoint, which Esri intends for personal use. The other three layers stay unavailable until their key is entered, and say so in their status line.

## Where keys go

- **Browser (`npm run dev` or `npm start`, opened at localhost):** open the **Atmosphere** panel, expand **More data** at the bottom, then **Provider keys**. Paste each key into its field and press **Save keys** once. Keys apply immediately — any layer waiting on one loads on the spot — and are written to `.env.local` in the project folder for the next start. Use **Clear** beside a field to remove a key.
- **Desktop app:** **File → Settings**. Saving reloads the globe. Keys are stored in `settings.json` under your Windows user profile.
- **By hand:** add lines such as `TOMTOM_API_KEY=…` to `.env.local` and restart the server. See the technical reference for every variable.

Never commit `.env.local`, paste a key into a chat or ticket, or share a screenshot of a key. If one leaks, delete it at the provider and make a new one — every provider below lets you do that in a minute.

## ArcGIS API key (surface imagery)

Provider: Esri ArcGIS Location Platform · https://location.arcgis.com/ · free account, no card required. The key is a **credential you configure**, so the steps below keep it as narrow as possible: basemap tiles only, nothing else on your account.

1. Sign in at https://location.arcgis.com/ (create a free ArcGIS Location Platform account if you have none).
2. On the dashboard, find **Developer credentials** and choose **Create developer credentials**. This opens a wizard in your ArcGIS portal.
3. **Credential type:** *API key credentials* → Next.
4. **Where will you use these credentials:** *Public application* → Next.
5. **Item access:** *No item access* → Next.
6. **Privileges:** expand **Location services → Basemaps** and switch on both **Basemap styles service** and **Static basemap tiles**. Leave every other privilege off (the counter should read 2 enabled). → Next.
7. **Settings:** set **Expiration date** as far out as allowed (one year). Leave **Referrer URLs** empty — the app's local server fetches tiles, not your browser, so a referrer rule would block it. → Next.
8. **Item details:** give it a title you will recognise, e.g. *Weather Visualizer imagery*. → Next.
9. Review the summary, then choose **Generate the API key now** → Next.
10. Copy the key from the dialog **before closing it** — Esri does not show it again. Paste it into the app as **ArcGIS API key**.

The key expires on the date you chose. When Esri refuses it (expired, deleted, or the basemap privileges were removed), the app falls back to the public endpoint automatically, re-tries the key every ten minutes, and prints *Esri refused the ArcGIS API key* in the server log — you will not lose imagery, only the metering. Open the credential item in your ArcGIS content, generate a new key and paste it in. A key looks like `AAPT…` followed by a long string.

## NASA FIRMS map key (active fires)

Provider: NASA FIRMS · https://firms.modaps.eosdis.nasa.gov/api/map_key/ · free, email only.

1. Open the page above, enter your email address and press **Get MAP Key**.
2. The key arrives by email (32 characters). Paste it into the app as **NASA FIRMS map key**.
3. Optional: check your quota at any time at `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=<your key>`, which reports the transaction limit and how many you have used in the current 10-minute window.

There is no expiry. The app's usage (three requests per half hour) is far below the 5,000-per-10-minute limit, so you can safely reuse the same key for other FIRMS tools.

## AISStream API key (ships)

Provider: AISStream · https://aisstream.io/ · free, sign-in with a GitHub account. AISStream is a volunteer-run relay in beta: no formal terms, no SLA, and coverage depends on where receivers are.

1. Open https://aisstream.io/ and sign in (it authenticates through GitHub).
2. Go to the **API keys** section of your dashboard and create a new key. Copy it.
3. Paste it into the app as **AISStream API key**.

The app opens one websocket to `stream.aisstream.io` while the ship layer is on and closes it three minutes after you turn the layer off. There is no request quota and no expiry. If the layer reports *AISStream rejected the API key*, the key was deleted or mistyped — make a new one.

## TomTom API key (traffic congestion)

Provider: TomTom Developer Portal · https://developer.tomtom.com/ · free tier, no card required.

1. Register or sign in at https://developer.tomtom.com/ and open your dashboard.
2. Create a new key (the dashboard calls this adding a key). Give it a name.
3. In the list of **Self-service APIs**, tick **Traffic API** and **Traffic Flow API** — the congestion layer reads flow tiles from `api.tomtom.com/traffic/map/4/tile/flow/…`, which sits under those products. Optionally also tick **Traffic Incidents API** if you plan to use an incidents layer; leave the *Orbis* entries unticked (different platform, not used). Extra products on a key cost nothing unless called.
4. Save and copy the key. Paste it into the app as **TomTom API key**.

The free tier is 2,500 requests a day across everything on the key. Each traffic refresh spends 25 (one tile per 5×5 block around the selected place, zoom 12) every two minutes, so continuous use lasts about three hours a day; the app also stops at a soft cap it counts itself (`TOMTOM_DAILY_TILE_BUDGET`, default 20,000, for accounts on a paid plan). When TomTom's daily allowance is spent it refuses further requests and the layer reports *TomTom refused the key (HTTP 403)*; it recovers on its own once the allowance resets. There is no expiry.

## Troubleshooting

| Status line | Meaning |
|---|---|
| *Add a free … key via …* | No key entered yet. |
| *… rejected the API key* | The provider refused it: mistyped, deleted or expired. |
| *TomTom refused the key (HTTP 403)* | TomTom does not distinguish: the key is mistyped, the Traffic API products are not ticked on it, or today's 2,500 requests are spent. If it worked earlier in the day, it is the allowance. |
| *TomTom is rate-limiting this key* | Too many requests in a short burst; it clears on its own. |
| *… is unavailable* | The provider is down or unreachable; the key is fine. The layer retries on its normal schedule. |
| *daily tile budget reached* | The app's own soft cap (`TOMTOM_DAILY_TILE_BUDGET`) for today is reached; last good data stays up until midnight UTC. |
| *Esri refused the ArcGIS API key* in the server log | The key expired or lost its basemap privileges; public imagery is being served meanwhile. Generate a new key. |
