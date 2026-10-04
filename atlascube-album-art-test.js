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
      show_debug: config.show_debug === true
    };

    this._cache = new Map();
    this._requestId = 0;
    this._hass = null;

    this.attachShadow({ mode: "open" });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._lastState !== this._getTrack()) {
      this._lastState = this._getTrack();
      this._loadArtwork();
    }
  }

  getCardSize() {
    return 5;
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
      return {
        artist: "",
        title: text
      };
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

    this._setStatus("TEST V2 — SZUKAM OKŁADKI…");

    if (!rawTrack || !title) {
      this._applyResult({
        rawTrack,
        artist,
        title,
        artwork: null,
        album: ""
      });
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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  _render() {
    if (!this.shadowRoot) return;

    const data = this._data || {};
    const artwork = data.artwork || "";
    const artist = data.artist || "";
    const title = data.title || "Brak informacji o utworze";
    const album = data.album || "";

    const background = artwork
      ? `
        <div class="blur-bg" style="background-image:url("${artwork}")"></div>
        <div class="shade"></div>
      `
      : `
        <div class="fallback-bg"></div>
      `;

    const image = artwork
      ? `<img class="cover" src="${artwork}" alt="Okładka">`
      : `<div class="no-cover">♪</div>`;

    const status =
      this._status ||
      (data.error
        ? `TEST V2 — BŁĄD: ${this._escape(data.error)}`
        : artwork
          ? "TEST V2 — OKŁADKA ZNALEZIONA"
          : data.rawTrack
            ? "TEST V2 — BRAK OKŁADKI"
            : "TEST V2 — CZEKAM NA UTWÓR…");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color);
        }

        .card {
          position: relative;
          overflow: hidden;
          min-height: 430px;
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,.10);
          background: #101318;
          box-shadow: 0 4px 18px rgba(0,0,0,.25);
          padding: 18px;
          box-sizing: border-box;
        }

        .blur-bg,
        .shade,
        .fallback-bg {
          position: absolute;
          inset: 0;
        }

        .blur-bg {
          background-position: center;
          background-size: cover;
          filter: blur(28px);
          transform: scale(1.15);
          opacity: .48;
        }

        .shade {
          background:
            linear-gradient(
              180deg,
              rgba(0,0,0,.30),
              rgba(0,0,0,.72)
            );
        }

        .fallback-bg {
          background:
            radial-gradient(
              circle at 50% 42%,
              rgba(33,150,243,.18) 0%,
              rgba(33,150,243,.06) 38%,
              rgba(0,0,0,.18) 100%
            );
        }

        .content {
          position: relative;
          z-index: 1;
          min-height: 394px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .cover,
        .no-cover {
          width: 220px;
          height: 220px;
          border-radius: 14px;
          object-fit: cover;
          box-shadow: 0 8px 30px rgba(0,0,0,.45);
          background: rgba(0,0,0,.25);
        }

        .no-cover {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 72px;
          color: rgba(255,255,255,.35);
        }

        .artist {
          margin-top: 18px;
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

        .status {
          margin-top: auto;
          padding-top: 14px;
          font-size: 11px;
          opacity: .55;
          text-align: center;
        }

        .debug {
          margin-top: 10px;
          font-size: 11px;
          opacity: .5;
          text-align: center;
        }
      </style>

      <div class="card">
        ${background}

        <div class="content">
          ${image}
          <div class="artist">${this._escape(artist || "Nieznany wykonawca")}</div>
          <div class="title">${this._escape(title)}</div>
          ${album ? `<div class="album">${this._escape(album)}</div>` : ""}
          <div class="status">${status}</div>

          ${this._config.show_debug
            ? `<div class="debug">Źródło: iTunes Search API</div>`
            : ""}
        </div>
      </div>
    `;
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
