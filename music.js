(() => {
  const el = id => document.getElementById(id);
  const native = window.chrome?.webview;
  let connected = false;
  let now = {};
  let queue = [];
  let timer;
  let inFlight;
  let queueAt = 0;
  let commandRunning = false;
  let searchVersion = 0;
  let artworkId;
  let seeking = false;
  let adjustingVolume = false;
  const time = ms => {
    const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  };
  const visible = () => location.hash === '#music' && !document.hidden && !el('reader').open;
  const message = text => { el('music-message').textContent = text; };

  async function api(path, body, signal) {
    const response = await fetch('/undertone/' + path, {cache: 'no-store', signal,
      ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'Undertone could not complete that request.');
      error.code = result.code;
      throw error;
    }
    return result;
  }

  function setConnected(value) {
    connected = value;
    el('music-connection').textContent = value ? 'Connected to Undertone' : 'Not connected';
    el('music-connection').classList.toggle('is-connected', value);
    el('music-setup').hidden = value;
    el('music-search-button').disabled = !value;
    el('music-refresh-queue').disabled = !value;
    for (const button of document.querySelectorAll('[data-music-control]')) button.disabled = !value || commandRunning;
    for (const button of document.querySelectorAll('.music-track-list button')) button.disabled = !value || commandRunning;
    el('music-query').disabled = !value;
    if (!value) {
      now = {};
      artworkId = undefined;
      el('music-artwork').hidden = true;
      el('music-art-placeholder').hidden = false;
      el('music-title').textContent = 'Make yourself at home.';
      el('music-artist').textContent = 'Connect Undertone to choose something to listen to.';
      el('music-album').textContent = '';
      el('music-state-label').textContent = 'A SOUNDTRACK FOR YOUR NEXT CHAPTER';
      el('music-play').setAttribute('aria-label', 'Play');
      el('music-play-glyph').firstElementChild.setAttribute('d', 'm8 5 11 7-11 7z');
      el('music-search-message').textContent = 'Connect to search the music you already love.';
      el('music-elapsed').textContent = '0:00';
      el('music-duration').textContent = '0:00';
      el('music-seek').value = 0;
    }
  }

  function renderState(value) {
    now = value;
    const track = value.track;
    el('music-title').textContent = track?.title || 'Nothing playing yet.';
    el('music-artist').textContent = track?.artist || (value.artists || []).join(', ') || 'Search your library below to get started.';
    el('music-album').textContent = track?.album || value.album || '';
    el('music-state-label').textContent = value.playing ? 'NOW PLAYING IN UNDERTONE' : track ? 'TAKE YOUR TIME' : 'READY WHEN YOU ARE';
    el('music-play').setAttribute('aria-label', value.playing ? 'Pause' : 'Play');
    el('music-play-glyph').firstElementChild.setAttribute('d', value.playing ? 'M7 5h3v14H7zM14 5h3v14h-3z' : 'm8 5 11 7-11 7z');
    el('music-shuffle').setAttribute('aria-pressed', String(Boolean(value.shuffle)));
    el('music-repeat').setAttribute('aria-pressed', String(value.repeat && value.repeat !== 'off' || false));
    el('music-repeat').setAttribute('aria-label', 'Repeat: ' + (value.repeat || 'off'));
    el('music-repeat-one').hidden = value.repeat !== 'one';
    el('music-duration').textContent = time(value.durationMs);
    if (!seeking) {
      el('music-seek').max = Math.max(1, Number(value.durationMs) || 1);
      el('music-seek').value = Number(value.positionMs) || 0;
      el('music-elapsed').textContent = time(value.positionMs);
    }
    if (!adjustingVolume) {
      el('music-volume').value = value.volume ?? 70;
      el('music-volume-value').textContent = (value.volume ?? 70) + '%';
    }
    el('music-seek').disabled = !track || commandRunning;
    el('music-play').disabled = commandRunning || (!track && !queue.length);
    const id = track?.id || value.trackId;
    if (id !== artworkId) {
      artworkId = id;
      const image = el('music-artwork');
      image.hidden = true;
      el('music-art-placeholder').hidden = false;
      if (id) image.src = '/undertone/artwork/' + encodeURIComponent(id);
      else image.removeAttribute('src');
    }
  }

  function trackRows(container, tracks, fromQueue = false) {
    container.replaceChildren();
    tracks.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = 'music-track-row';
      const number = document.createElement('span');
      number.className = 'music-track-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const details = document.createElement('div');
      details.className = 'music-track-details';
      const title = document.createElement('strong');
      title.textContent = track.title || 'Untitled';
      const artist = document.createElement('span');
      artist.textContent = [track.artist, track.album].filter(Boolean).join(' · ');
      details.append(title, artist);
      const duration = document.createElement('span');
      duration.className = 'music-track-duration';
      duration.textContent = time(track.durationMs);
      row.append(number, details, duration);
      if (!fromQueue) {
        const play = document.createElement('button');
        play.textContent = 'Play';
        play.setAttribute('aria-label', 'Play ' + track.title);
        play.onclick = () => control('play-track', {trackId: track.id});
        const add = document.createElement('button');
        add.textContent = '+';
        add.className = 'music-add-track';
        add.setAttribute('aria-label', 'Add ' + track.title + ' to queue');
        add.onclick = () => control('queue-track', {trackId: track.id});
        row.append(play, add);
      }
      container.append(row);
    });
  }

  async function refreshQueue(signal) {
    const result = await api('queue', null, signal);
    queue = Array.isArray(result.upNext) ? result.upNext : [];
    trackRows(el('music-queue-list'), queue, true);
    el('music-queue-message').textContent = queue.length ? (result.upNextTotal || queue.length) + ' tracks in your queue' : 'A little quiet. Add a song from your library.';
    queueAt = Date.now();
  }

  async function refresh() {
    clearTimeout(timer);
    if (!visible() || inFlight) return;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const result = await api('state', null, controller.signal);
      const changed = result.nowPlaying.trackId !== now.trackId;
      const first = !connected;
      setConnected(true);
      if (first || changed || Date.now() - queueAt > 15000) await refreshQueue(controller.signal);
      renderState(result.nowPlaying);
      if (first) {
        message('Connected. Playback stays in Undertone, even while you read.');
        el('music-search-message').textContent = 'Search for a song, artist, or album.';
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        setConnected(false);
        message(error.message);
      }
    } finally {
      inFlight = null;
      if (visible()) timer = setTimeout(refresh, connected ? (now.playing ? 2000 : 5000) : 10000);
    }
  }

  function syncVisibility() {
    clearTimeout(timer);
    if (!visible()) { inFlight?.abort(); return; }
    refresh();
  }

  async function control(action, values = {}) {
    if (!connected || commandRunning) return;
    commandRunning = true;
    setConnected(true);
    try {
      await api('control', {action, ...values});
      message(action === 'queue-track' ? 'Added to your Undertone queue.' : '');
      queueAt = 0;
    } catch (error) {
      message(error.message);
    } finally {
      commandRunning = false;
      setConnected(connected);
      if (connected) renderState(now);
      refresh();
    }
  }

  el('music-connect').onclick = () => { message('Connecting to Undertone…'); refresh(); };
  for (const action of ['previous', 'next', 'shuffle', 'repeat']) el('music-' + action).onclick = () => control(action);
  el('music-play').onclick = () => control('toggle');
  el('music-seek').oninput = event => { seeking = true; el('music-elapsed').textContent = time(event.target.value); };
  el('music-seek').onchange = event => { seeking = false; control('seek', {positionMs: Number(event.target.value)}); };
  el('music-seek').onblur = () => { seeking = false; };
  el('music-volume').oninput = event => { adjustingVolume = true; el('music-volume-value').textContent = event.target.value + '%'; };
  el('music-volume').onchange = event => { adjustingVolume = false; control('volume', {volume: Number(event.target.value)}); };
  el('music-volume').onblur = () => { adjustingVolume = false; };
  el('music-refresh-queue').onclick = async () => { try { await refreshQueue(); renderState(now); } catch (error) { message(error.message); } };
  el('music-search-form').onsubmit = async event => {
    event.preventDefault();
    if (!connected) return;
    const query = el('music-query').value.trim();
    if (!query) return;
    const version = ++searchVersion;
    el('music-search-button').disabled = true;
    el('music-search-message').textContent = 'Searching your Undertone library…';
    try {
      const result = await api('search?q=' + encodeURIComponent(query));
      if (version !== searchVersion) return;
      const tracks = Array.isArray(result.tracks) ? result.tracks : [];
      trackRows(el('music-results'), tracks);
      el('music-search-message').textContent = tracks.length ? tracks.length + (tracks.length === 1 ? ' track' : ' tracks') : 'No matches. Try another title, artist, or album.';
    } catch (error) {
      if (version === searchVersion) el('music-search-message').textContent = error.message;
    } finally {
      if (version === searchVersion) el('music-search-button').disabled = !connected;
    }
  };
  el('music-artwork').onload = () => {
    if (!connected || !artworkId) return;
    el('music-artwork').hidden = false;
    el('music-art-placeholder').hidden = true;
  };
  el('music-artwork').onerror = () => { el('music-artwork').hidden = true; el('music-art-placeholder').hidden = false; };
  const nativeAction = type => { message('Opening Undertone…'); native?.postMessage({type}); };
  for (const [id, type] of [['music-open', 'undertone.open'], ['music-open-player', 'undertone.open'], ['music-locate', 'undertone.locate'], ['music-data-folder', 'undertone.data-folder']]) {
    el(id).disabled = !native;
    el(id).onclick = () => nativeAction(type);
  }
  el('music-desktop-note').hidden = Boolean(native);
  native?.addEventListener('message', event => {
    if (event.data?.type !== 'undertone-result') return;
    message(event.data.message);
    if (event.data.success) { clearTimeout(timer); timer = setTimeout(refresh, 1000); }
  });
  window.addEventListener('hashchange', syncVisibility);
  document.addEventListener('visibilitychange', syncVisibility);
  window.addEventListener('spine-carousel-paused', syncVisibility);
  setConnected(false);
  syncVisibility();
})();
