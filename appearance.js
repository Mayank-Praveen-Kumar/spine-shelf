(() => {
  const root = document.documentElement;
  const native = window.chrome?.webview;
  const key = 'spine-undertone-appearance';
  const fields = {background:'--bg',sidebar:'--rail',surface:'--surface',field:'--field',hover:'--hover',foreground:'--ink',muted:'--muted',border:'--line',accent:'--accent',accentForeground:'--accent-ink'};
  let palettes = {};
  let timer;
  let pending;
  let signature;
  const visible = () => !document.hidden && !document.getElementById('reader').open;
  const validColour = value => typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);

  function apply(value) {
    if (!value || typeof value.isDark !== 'boolean' || !Object.hasOwn(palettes,value.iconVariant) || !value.colors) return;
    if (!Object.keys(fields).every(name => validColour(value.colors[name]))) return;
    const next = JSON.stringify(value);
    if (next === signature) return;
    signature = next;
    root.style.colorScheme = value.isDark ? 'dark' : 'light';
    root.dataset.undertoneTheme = value.isDark ? 'dark' : 'light';
    for (const [name, variable] of Object.entries(fields)) root.style.setProperty(variable, value.colors[name]);
    root.style.setProperty('--accent-hover', `color-mix(in srgb, ${value.colors.accent} 85%, ${value.isDark ? 'white' : 'black'})`);
    root.style.setProperty('--ui-ink', value.colors.foreground);
    const palette = palettes[value.iconVariant];
    root.style.setProperty('--icon-gradient', `linear-gradient(145deg, ${palette.colors.join(', ')})`);
    root.style.setProperty('--icon-ink', palette.ink);
    document.querySelector('link[rel="icon"]').href = '/assets/icons/spine-' + value.iconVariant + '.ico';
    native?.postMessage({type:'undertone.appearance', iconVariant:value.iconVariant, background:value.colors.background.slice(0,7)});
    try { localStorage.setItem(key,next); } catch {}
    window.dispatchEvent(new CustomEvent('spine-appearance-changed'));
  }

  async function refresh() {
    clearTimeout(timer);
    if (!visible() || pending) return;
    pending = new AbortController();
    try {
      const response = await fetch('/undertone/appearance',{cache:'no-store',signal:pending.signal});
      if (response.ok) apply(await response.json());
    } catch {} finally {
      pending = null;
      if (visible()) timer = setTimeout(refresh,15000);
    }
  }

  function visibility() {
    clearTimeout(timer);
    if (!visible()) pending?.abort();
    else refresh();
  }
  fetch('/assets/icon-palettes.json').then(response=>response.json()).then(value=>{
    palettes = value;
    try { apply(JSON.parse(localStorage.getItem(key))); } catch {}
    refresh();
  }).catch(()=>{});
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('focus',visibility);
  window.addEventListener('spine-carousel-paused',visibility);
})();
