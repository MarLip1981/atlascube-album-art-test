class AtlasCubeAlbumArtTest extends HTMLElement {
  static getStubConfig() {
    return {
      entity: "sensor.atlascube_radio_tytul_utworu"
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("AtlasCube Album Art Test: brak entity");
    }

    this._config = {
      entity: config.entity,
      show_source: config.show_source !== false
    };

    this._cache = new Map();
    this._requestId = 0;
    this._hass = null;
    this._deviceRegistry = null;
    this._entityRegistry = null;
    this._registryLoading = false;

    this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._deviceRegistry && !this._registryLoading) this._loadRegistries().then(() => this._render());
    if (this._lastState !== this._getTrack()) {
      this._lastState = this._getTrack();
      this._loadArtwork();
    }
  }

  getCardSize() {
    return 6;
  }

  async _loadRegistries() {
    if (!this._hass || this._registryLoading) return;
    this._registryLoading = true;
    try {
      const [devices, entities] = await Promise.all([
        this._hass.callWS({ type: "config/device_registry/list" }),
        this._hass.callWS({ type: "config/entity_registry/list" })
      ]);
      this._deviceRegistry = devices || [];
      this._entityRegistry = entities || [];
    } catch (err) {
      console.warn("AtlasCube Album Art Test: nie udało się pobrać rejestru urządzeń.", err);
    } finally {
      this._registryLoading = false;
    }
  }

  _webUrl() {
    const entityIds = [
      this._config.entity,
      "sensor.atlascube_radio_stacja_radiowa",
      "sensor.atlascube_9140_playback",
      "number.salon_atlascube_radio_glosnosc",
      "select.atlascube_9140_source",
      "button.atlascube_9140_previous",
      "button.atlascube_9140_play",
      "button.atlascube_9140_stop",
      "button.atlascube_9140_next"
    ];

    for (const entityId of entityIds) {
      const entity = (this._entityRegistry || []).find(item => item.entity_id === entityId);
      if (!entity?.device_id) continue;
      const device = (this._deviceRegistry || []).find(item => item.id === entity.device_id);
      if (device?.configuration_url) return device.configuration_url;
    }

    return null;
  }

  _getTrack() {
    const stateObj = this._hass?.states?.[this._config.entity];
    const value = stateObj?.state;
    return value && value !== "unknown" && value !== "unavailable"
      ? value
      : "";
  }

  _parseTrack(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(.+?)\s+-\s+(.+)$/);

    if (!match) {
      return { artist: "", title: text };
    }

    return {
      artist: match[1].trim(),
      title: match[2].trim()
    };
  }

  _normalize(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  _scoreResult(result, artist, title) {
    const wantedArtist = this._normalize(artist);
    const wantedTitle = this._normalize(title);
    const resultArtist = this._normalize(result.artistName);
    const resultTitle = this._normalize(result.trackName);

    let score = 0;

    if (resultArtist === wantedArtist) score += 100;
    else if (resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist)) score += 40;

    if (resultTitle === wantedTitle) score += 100;
    else if (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle)) score += 40;

    if (result.collectionName) {
      const album = this._normalize(result.collectionName);
      if (album.includes(wantedTitle)) score += 5;
    }

    return score;
  }

  async _loadArtwork() {
    const rawTrack = this._getTrack();
    const { artist, title } = this._parseTrack(rawTrack);
    const requestId = ++this._requestId;


    if (!rawTrack || !title) {
      this._applyResult({ rawTrack, artist, title, artwork: null, album: "" });
      return;
    }

    const cacheKey = this._normalize(rawTrack);

    if (this._cache.has(cacheKey)) {
      this._applyResult({
        rawTrack,
        artist,
        title,
        ...this._cache.get(cacheKey)
      });
      return;
    }

    try {
      const query = encodeURIComponent(`${artist} ${title}`);
      const url =
        `https://itunes.apple.com/search?term=${query}&country=PL&media=music&entity=song&limit=10`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (requestId !== this._requestId) return;

      const results = Array.isArray(data.results) ? data.results : [];

      let best = null;
      let bestScore = -1;

      for (const result of results) {
        const score = this._scoreResult(result, artist, title);

        if (score > bestScore) {
          bestScore = score;
          best = result;
        }
      }

      const artwork = best?.artworkUrl100
        ? best.artworkUrl100
            .replace(/100x100bb\./i, "600x600bb.")
            .replace(/^http:/i, "https:")
        : null;

      const result = {
        artwork,
        album: best?.collectionName || "",
        matchScore: bestScore
      };

      this._cache.set(cacheKey, result);

      this._applyResult({
        rawTrack,
        artist,
        title,
        ...result
      });
    } catch (error) {
      if (requestId !== this._requestId) return;

      this._applyResult({
        rawTrack,
        artist,
        title,
        artwork: null,
        album: "",
        error: error?.message || "Nieznany błąd"
      });
    }
  }

  _applyResult(data) {
    this._status = "";
    this._data = data;
    this._render();
  }

  _setStatus(status) {
    this._status = status;
    this._render();
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async _press(entityId) {
    if (!this._hass || !entityId) return;
    await this._hass.callService("button", "press", {
      entity_id: entityId
    });
  }

  _render() {
    if (!this.shadowRoot) return;

    const data = this._data || {};
    const artwork = data.artwork || "";
    const station = this._hass?.states?.["sensor.atlascube_radio_stacja_radiowa"]?.state || "";
    const artist = data.artist || "";
    const title = data.title || "Brak informacji o utworze";
    const album = data.album || "";
    const playback = this._hass?.states?.["sensor.atlascube_9140_playback"]?.state || "";
    const playing = playback === "playing";
    const volumeState = this._hass?.states?.["number.salon_atlascube_radio_glosnosc"]?.state;
    const volume = Number(volumeState);
    const volumeValue = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 0;
    const sourceEntity = "select.atlascube_9140_source";
    const sourceState = this._hass?.states?.[sourceEntity];
    const sourceValue = sourceState?.state || "";
    const sourceOptions = Array.isArray(sourceState?.attributes?.options) ? sourceState.attributes.options : [];
    const webUrl = this._webUrl();

    const background = artwork
      ? `
        <img class="blur-bg-image" src="${artwork}" alt="" aria-hidden="true">
        <div class="shade"></div>
      `
      : `<div class="fallback-bg"></div>`;

    const image = artwork
      ? `<img class="cover" src="${artwork}" alt="Okładka">`
      : `<div class="no-cover"><ha-icon class="fallback-radio ${playing ? "rainbow" : "idle"}" icon="mdi:radio"></ha-icon></div>`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color);
        }

        .card {
          position: relative;
          overflow: hidden;
          min-height: 500px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,.10);
          background: transparent;
          box-shadow: 0 4px 18px rgba(0,0,0,.25);
          padding: 18px;
          box-sizing: border-box;
        }

        .blur-bg-image,
        .shade,
        .fallback-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }

        .blur-bg-image {
          display: block;
          object-fit: cover;
          object-position: center;
          filter: blur(24px);
          transform: scale(1.0);
          opacity: .82;
          z-index: 0;
        }

        .shade {
          z-index: 1;
          background: linear-gradient(180deg, rgba(0,0,0,.18), rgba(0,0,0,.58));
        }

        .fallback-bg {
          z-index: 0;
          background: radial-gradient(circle at 50% 42%, rgba(33,150,243,.18) 0%, rgba(33,150,243,.06) 38%, rgba(0,0,0,.18) 100%);
        }

        .content {
          position: relative;
          z-index: 1;
          min-height: 464px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .brand { display:flex; align-items:center; justify-content:center; gap:7px; margin-bottom:5px; font-size:17px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; opacity:.9; }
        .brand-icon { font-size:20px; line-height:1; }
        .brand-cube { opacity:.58; }
        .brand.web { cursor:pointer; }
        .brand.web:active { transform:scale(.995); }

        .station {
          margin-bottom: 12px;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: .04em;
          opacity: .82;
          text-align: center;
        }

        .cover,
        .no-cover {
          width: 200px;
          height: 200px;
          border-radius: 14px;
          object-fit: cover;
          box-shadow: 0 8px 30px rgba(0,0,0,.45);
          background: rgba(0,0,0,.25);
        }

        .no-cover {
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255,255,255,.35);
        }

        .fallback-radio {
          --mdc-icon-size: 92px;
          width: 92px;
          height: 92px;
        }

        .fallback-radio.idle { color: rgba(255,255,255,.55); }

        .fallback-radio.rainbow {
          color: #ff0000;
          animation: atlas-rainbow 4s linear infinite;
        }

        @keyframes atlas-rainbow {
          0% { filter: hue-rotate(0deg) drop-shadow(0 0 4px rgba(255,0,0,.8)); }
          25% { filter: hue-rotate(90deg) drop-shadow(0 0 7px rgba(0,255,0,.8)); }
          50% { filter: hue-rotate(180deg) drop-shadow(0 0 8px rgba(0,220,255,.85)); }
          75% { filter: hue-rotate(270deg) drop-shadow(0 0 8px rgba(180,0,255,.85)); }
          100% { filter: hue-rotate(360deg) drop-shadow(0 0 4px rgba(255,0,0,.8)); }
        }

        .artist {
          margin-top: 16px;
          font-size: 16px;
          opacity: .78;
          text-align: center;
        }

        .title {
          margin-top: 5px;
          font-size: 23px;
          font-weight: 600;
          text-align: center;
          line-height: 1.2;
        }

        .album {
          margin-top: 8px;
          font-size: 14px;
          opacity: .68;
          text-align: center;
        }

        .controls {
          margin-top: 18px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
        }

        button {
          font: inherit;
          color: inherit;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,.10);
          outline: none;
          -webkit-tap-highlight-color: transparent;
        }

        .skip {
          width: 52px;
          height: 52px;
          flex: 0 0 52px;
          border-radius: 18px;
          background: rgba(255,255,255,.06);
          display: grid;
          place-items: center;
          backdrop-filter: blur(6px);
        }

        .skip ha-icon {
          --mdc-icon-size: 25px;
          color: rgba(255,255,255,.78);
        }

        .main {
          width: 60px;
          height: 60px;
          flex: 0 0 60px;
          border-radius: 50%;
          background: rgba(255,255,255,.10);
          border-color: rgba(255,255,255,.16);
          display: grid;
          place-items: center;
          backdrop-filter: blur(6px);
          box-shadow: 0 5px 18px rgba(0,0,0,.22);
        }

        .main.playing {
          background: rgba(33,150,243,.22);
          border-color: rgba(33,150,243,.50);
          box-shadow: 0 0 20px rgba(33,150,243,.25);
        }

        .main ha-icon {
          --mdc-icon-size: 29px;
        }

        .main.playing ha-icon { color: #2196f3; }
        .main.stopped ha-icon { color: rgba(255,255,255,.92); }

        .volume {
          width: min(360px, 90%);
          margin-top: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .volume ha-icon {
          --mdc-icon-size: 22px;
          opacity: .75;
        }

        .volume input {
          flex: 1;
          min-width: 0;
          accent-color: #2196f3;
        }

        .volume-value {
          min-width: 38px;
          text-align: right;
          font-size: 12px;
          opacity: .65;
        }

        .source { width:min(360px,90%); margin-top:12px; display:flex; align-items:center; gap:10px; }
        .source ha-icon { --mdc-icon-size:22px; opacity:.75; }
        .source select { flex:1; min-width:0; height:36px; padding:0 10px; border:1px solid rgba(255,255,255,.12); border-radius:10px; background:rgba(0,0,0,.18); color:inherit; font:inherit; outline:none; }
      </style>

      <div class="card">
        ${background}

        <div class="content">
          <div class="brand ${webUrl ? "web" : ""}" id="brand" title="${webUrl ? "Otwórz panel AtlasCube" : ""}"><span class="brand-icon">◈</span><span>ATLAS <span class="brand-cube">CUBE</span></span></div>
          ${station && station !== "unknown" && station !== "unavailable"
            ? `<div class="station">${this._escape(station)}</div>`
            : ""}
          ${image}
          <div class="artist">${this._escape(artist || "Nieznany wykonawca")}</div>
          <div class="title">${this._escape(title)}</div>
          ${album ? `<div class="album">${this._escape(album)}</div>` : ""}

          <div class="controls">
            <button class="skip" id="previous" aria-label="Poprzednia stacja">
              <ha-icon icon="mdi:skip-previous"></ha-icon>
            </button>

            <button class="main ${playing ? "playing" : "stopped"}" id="playstop" aria-label="${playing ? "Stop" : "Play"}">
              <ha-icon icon="mdi:${playing ? "stop" : "play"}"></ha-icon>
            </button>

            <button class="skip" id="next" aria-label="Następna stacja">
              <ha-icon icon="mdi:skip-next"></ha-icon>
            </button>
          </div>

          <div class="volume">
            <ha-icon icon="mdi:${volumeValue === 0 ? "volume-mute" : volumeValue < 50 ? "volume-medium" : "volume-high"}"></ha-icon>
            <input id="volume" type="range" min="0" max="100" step="1" value="${volumeValue}" aria-label="Głośność">
            <div class="volume-value">${Math.round(volumeValue)}%</div>
          </div>

          ${this._config.show_source && sourceOptions.length ? `<div class="source"><ha-icon icon="mdi:radio-tower"></ha-icon><select id="source" aria-label="Źródło">${sourceOptions.map(option => `<option value="${this._escape(option)}" ${option === sourceValue ? "selected" : ""}>${this._escape(option)}</option>`).join("")}</select></div>` : ""}
        </div>
      </div>
    `;

    this.shadowRoot.querySelector("#brand")?.addEventListener("click", () => {
      if (webUrl) window.open(webUrl, "_blank", "noopener,noreferrer");
    });

    this.shadowRoot.querySelector("#previous")?.addEventListener("click", () =>
      this._press("button.atlascube_9140_previous")
    );

    this.shadowRoot.querySelector("#next")?.addEventListener("click", () =>
      this._press("button.atlascube_9140_next")
    );

    this.shadowRoot.querySelector("#playstop")?.addEventListener("click", () =>
      this._press(
        playing
          ? "button.atlascube_9140_stop"
          : "button.atlascube_9140_play"
      )
    );

    this.shadowRoot.querySelector("#volume")?.addEventListener("input", event => {
      const value = Number(event.target.value);
      const label = this.shadowRoot.querySelector(".volume-value");
      if (label) label.textContent = `${Math.round(value)}%`;
    });

    this.shadowRoot.querySelector("#volume")?.addEventListener("change", async event => {
      if (!this._hass) return;
      await this._hass.callService("number", "set_value", {
        entity_id: "number.salon_atlascube_radio_glosnosc",
        value: Number(event.target.value)
      });
    });

    this.shadowRoot.querySelector("#source")?.addEventListener("change", async event => {
      if (!this._hass) return;
      await this._hass.callService("select", "select_option", {
        entity_id: "select.atlascube_9140_source",
        option: event.target.value
      });
    });
  }
}

customElements.define(
  "atlascube-album-art-test",
  AtlasCubeAlbumArtTest
);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "atlascube-album-art-test",
  name: "AtlasCube Album Art Test",
  description: "Test wyszukiwania okładek utworów AtlasCube",
  preview: true
});
