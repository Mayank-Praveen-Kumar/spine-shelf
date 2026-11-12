const $ = id => document.getElementById(id);
const shelf = $('shelf');
const reader = $('reader');
const chapter = $('chapter');
const colors = ['#733d3d', '#3d5a53', '#755233', '#434b65', '#68506b', '#66572d'];
let books = [];
const shelves = new Map();
let selectedShelf = '';
let backgroundURL;
let artworkRequest = 0;
let active;
let section = 0;
let page = 0;
let pageCount = 1;
let pageWidth = 0;
let chapterReady = false;
let pendingPage = 0;
const importedFonts = new Map();
let opening = false;
let drag;
let lastDrag = -Infinity;

function render() {
  const current = shelves.get(selectedShelf);
  const visible = current ? books.filter(book => current.books.includes(book.id)) : books;
  $('count').textContent = visible.length + (visible.length === 1 ? ' book' : ' books');
  $('background-settings').hidden = !current;
  $('add-existing').hidden = !current;
  $('existing-book').replaceChildren(new Option('Choose a book', ''),
    ...books.filter(book => !current?.books.includes(book.id)).map(book => new Option(book.title, book.id)));
  if (backgroundURL) URL.revokeObjectURL(backgroundURL);
  backgroundURL = current?.background instanceof Blob ? URL.createObjectURL(current.background) : undefined;
  const art = backgroundURL || current?.background;
  if (art) shelf.style.setProperty('--shelf-art', 'url(' + JSON.stringify(art) + ')');
  else shelf.style.removeProperty('--shelf-art');
  $('books').replaceChildren();
  $('hint').hidden = !visible.length;
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = current ? 'Add a book from your library or import an EPUB.' : 'Your shelf is empty. Import an EPUB to get started.';
    $('books').append(empty);
  }
  window.renderBookCarousel?.(visible, colors, (book, bounds, color) => openBook(book, null, bounds, color));
  visible.forEach((book, index) => {
    const spine = document.createElement('button');
    const title = document.createElement('span');
    const author = document.createElement('small');
    spine.className = 'spine';
    spine.title = [book.title, book.author].filter(Boolean).join(' · ');
    spine.style.setProperty('--height', (224 + index * 29 % 66) + 'px');
    spine.style.setProperty('--cloth', colors[index % colors.length]);
    title.textContent = book.title;
    author.textContent = book.author;
    spine.append(title, author);
    spine.addEventListener('dblclick', () => {
      if (performance.now() - lastDrag > 250) openBook(book, spine);
    });
    spine.addEventListener('click', event => {
      if (event.detail === 0) openBook(book, spine);
    });
    $('books').append(spine);
  });
}

shelf.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || event.target.closest('.flex-carousel')) return;
  drag = {id: event.pointerId, x: event.clientX, scroll: shelf.scrollLeft, moved: false};
});
window.addEventListener('pointermove', event => {
  if (drag?.id !== event.pointerId) return;
  const delta = event.clientX - drag.x;
  if (!drag.moved && Math.abs(delta) < 5) return;
  if (!drag.moved) shelf.setPointerCapture(event.pointerId);
  drag.moved = true;
  shelf.scrollLeft = drag.scroll - delta;
});
function endDrag(event) {
  if (drag?.id !== event.pointerId) return;
  if (drag.moved) lastDrag = performance.now();
  drag = undefined;
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

async function openBook(book, spine, bounds, color) {
  if (opening || reader.open) return;
  opening = true;
  active = book;
  const saved = Number(localStorage.getItem('section:' + book.id));
  section = Math.max(0, Math.min(book.chapters.length - 1, saved || 0));
  $('title').textContent = book.title;
  $('sections').replaceChildren(...book.chapters.map((_, index) =>
    new Option('Section ' + (index + 1), index)));
  showSection(Number(localStorage.getItem('page:' + book.id)) || 0);
  const tile = $('transition');
  try {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const start = bounds || spine.getBoundingClientRect();
      const height = Math.min(innerHeight * .68, 450);
      const width = Math.min(height * .67, innerWidth * .8);
      const center = {left: (innerWidth - width) / 2 + 'px', top: (innerHeight - height) / 2 + 'px', width: width + 'px', height: height + 'px'};
      Object.assign(tile.style, {display: 'flex', left: start.left + 'px', top: start.top + 'px',
        width: start.width + 'px', height: start.height + 'px'});
      tile.style.setProperty('--cloth', color || spine.style.getPropertyValue('--cloth'));
      tile.textContent = book.title;
      if (book.cover) {
        const cover = new Image();
        cover.alt = '';
        cover.addEventListener('error', () => cover.remove());
        cover.src = book.cover;
        tile.append(cover);
      }
      if (spine) spine.style.visibility = 'hidden';
      await tile.animate([
        {transform: 'translateY(0)'},
        {transform: 'translateY(-42px)', offset: .27},
        {...center, transform: 'translateY(0)'}
      ], {duration: 520, fill: 'forwards', easing: 'ease-in-out'}).finished;
      await tile.animate([{transform: 'perspective(900px) rotateY(0)'},
        {transform: 'perspective(900px) rotateY(-100deg)', opacity: 0}],
        {delay: 220, duration: 350, fill: 'forwards', easing: 'ease-in'}).finished;
    }
  } finally {
    tile.getAnimations().forEach(animation => animation.cancel());
    tile.style.display = 'none';
    if (spine) spine.style.visibility = '';
    opening = false;
    reader.showModal();
    window.dispatchEvent(new CustomEvent('spine-carousel-paused', {detail: true}));
    paginate();
  }
}

function showSection(startPage = 0) {
  chapterReady = false;
  pendingPage = startPage;
  sections.value = section;
  $('page').textContent = '…';
  chapter.src = active.chapters[section];
}

function updateReadingPage() {
  chapter.contentWindow.scrollTo({left: page * pageWidth, top: 0, behavior: 'instant'});
  $('page').textContent = (page + 1) + ' / ' + pageCount;
  localStorage.setItem('section:' + active.id, String(section));
  localStorage.setItem('page:' + active.id, String(page));
}

function paginate() {
  const doc = chapter.contentDocument;
  if (!chapterReady || !doc?.body || !reader.open || !chapter.clientWidth || !chapter.clientHeight) return;
  const previousCount = pageCount;
  const inset = Math.min(60, Math.floor(chapter.clientWidth * .07));
  pageWidth = chapter.clientWidth;
  let styles = doc.getElementById('spine-shelf-pagination');
  if (!styles) {
    styles = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
    styles.id = 'spine-shelf-pagination';
    (doc.head || doc.documentElement).append(styles);
  }
  const palette = getComputedStyle(reader);
  const paper = palette.getPropertyValue('--paper');
  const ink = palette.getPropertyValue('--ink');
  const size = Number($('text-size').value);
  const font = importedFonts.get($('font').value);
  const family = font ? '"Shelf Custom", Georgia, serif' : 'Georgia, serif';
  const fontFace = font ? `@font-face { font-family: "Shelf Custom"; src: url("${font.url}"); }` : '';
  const layout = `
    ${fontFace}
    html { touch-action: none !important; overflow: hidden !important; direction: ltr !important; background: ${paper} !important; }
    body {
      box-sizing: border-box !important;
      background: ${paper} !important;
      color: ${ink} !important;
      font: ${size}px/1.6 ${family} !important;
      margin: 0 !important;
      width: ${pageWidth}px !important;
      max-width: none !important;
      height: ${chapter.clientHeight}px !important;
      padding: 24px ${inset}px !important;
      column-width: ${pageWidth - inset * 2}px !important;
      column-gap: ${inset * 2}px !important;
      column-fill: auto !important;
      overflow: visible !important;
    }
    ${font ? "body :is(p, li, blockquote, dd, dt, div, span, h1, h2, h3, h4, h5, h6, a) { font-family: inherit !important; }" : ""}
    body :is(p, li, blockquote, dd, dt, div, span) { font-size: inherit !important; line-height: inherit !important; }
    body :is(p, li, blockquote, dd, dt, div, span, h1, h2, h3, h4, h5, h6, a) { color: inherit !important; background: transparent !important; }
    img, svg, video { max-width: 100% !important; max-height: ${Math.max(1, chapter.clientHeight - 48)}px !important; object-fit: contain; }
  `;
  if (styles.textContent !== layout) {
    styles.textContent = layout;
    if (font) {
      doc.fonts.load(size + 'px "Shelf Custom"').then(() => {
        if (chapter.contentDocument === doc && styles.textContent === layout) paginate();
      }).catch(() => {});
    }
  }
  pageCount = Math.max(1, Math.ceil((doc.documentElement.scrollWidth - 1) / pageWidth));
  const target = pendingPage ?? Math.floor(page * pageCount / previousCount);
  page = Math.max(0, Math.min(target, pageCount - 1));
  pendingPage = null;
  updateReadingPage();
}

function turnPage(direction) {
  if (!chapterReady) return;
  const target = page + direction;
  if (target >= 0 && target < pageCount) {
    page = target;
    updateReadingPage();
  } else if (section + direction >= 0 && section + direction < active.chapters.length) {
    section += direction;
    showSection(direction < 0 ? Infinity : 0);
  }
}

function readerKeys(event) {
  if (event.target.localName === 'select') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const next = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  if (previous || next) {
    event.preventDefault();
    turnPage(previous ? -1 : 1);
  }
}

function bindReaderZoom(surface) {
  const size = $('text-size');
  let wheelDelta = 0;
  let lastWheel = -Infinity;
  let pinchDistance = 0;

  function step(direction) {
    const index = Math.max(0, Math.min(size.options.length - 1, size.selectedIndex + direction));
    if (index === size.selectedIndex) return;
    size.selectedIndex = index;
    size.dispatchEvent(new Event('change'));
  }

  surface.addEventListener('wheel', event => {
    if (surface === reader && !event.ctrlKey) return;
    event.preventDefault();
    if (!event.ctrlKey || !chapterReady) return;
    if (event.timeStamp - lastWheel > 250) wheelDelta = 0;
    lastWheel = event.timeStamp;
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 80 : 1);
    if (Math.abs(wheelDelta) >= 30) {
      step(wheelDelta < 0 ? 1 : -1);
      wheelDelta = 0;
    }
  }, {passive: false});

  function trackPinch(event) {
    if (event.touches.length !== 2 || !chapterReady) {
      pinchDistance = 0;
      return;
    }
    const [first, second] = event.touches;
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    if (event.type === 'touchmove' && event.cancelable) event.preventDefault();
    if (!pinchDistance) pinchDistance = distance;
    if (Math.abs(distance - pinchDistance) >= 28) {
      step(distance > pinchDistance ? 1 : -1);
      pinchDistance = distance;
    }
  }

  for (const name of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    surface.addEventListener(name, trackPinch, {passive: false});
  }
}

bindReaderZoom(reader);
chapter.addEventListener('load', () => {
  if (!active || !chapter.hasAttribute('src') || !chapter.contentDocument?.body) return;
  chapterReady = true;
  chapter.contentDocument.addEventListener('keydown', readerKeys);
  bindReaderZoom(chapter.contentDocument);
  paginate();
});
new ResizeObserver(paginate).observe(chapter);
reader.addEventListener('keydown', readerKeys);
const libraryDatabase = new Promise((resolve, reject) => {
  const request = indexedDB.open('spine-shelf-fonts', 2);
  request.onupgradeneeded = event => {
    if (event.oldVersion < 1) request.result.createObjectStore('fonts', {keyPath: 'name'});
    if (event.oldVersion < 2) request.result.createObjectStore('shelves', {keyPath: 'id'});
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function registerFont(record) {
  if (importedFonts.has(record.name)) URL.revokeObjectURL(importedFonts.get(record.name).url);
  else $('font').add(new Option(record.name, record.name));
  importedFonts.set(record.name, {url: URL.createObjectURL(record.file)});
}

function fontStatus(message) {
  $('font-status').textContent = message;
  $('font-status').hidden = !message;
}

$('add-font').disabled = true;
libraryDatabase.then(database => {
  const request = database.transaction('fonts').objectStore('fonts').getAll();
  request.onsuccess = () => {
    request.result.forEach(registerFont);
    const saved = localStorage.getItem('reader:font');
    if (importedFonts.has(saved)) $('font').value = saved;
    $('add-font').disabled = false;
    paginate();
  };
  request.onerror = () => fontStatus('Saved fonts could not be loaded.');
}).catch(() => fontStatus('Font storage is unavailable.'));

$('add-font').onclick = () => $('font-file').click();
$('font-file').addEventListener('change', async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  fontStatus('');
  $('add-font').disabled = true;
  try {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name) || file.size > 20 * 1024 * 1024) {
      throw new Error('Choose a TTF, OTF, WOFF, or WOFF2 file up to 20 MB.');
    }
    try {
      await new FontFace('Shelf Font Check', await file.arrayBuffer()).load();
    } catch {
      throw new Error('This font file could not be opened.');
    }
    const record = {name: file.name, file};
    const database = await libraryDatabase;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('fonts', 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(new Error('The font could not be saved.'));
      transaction.objectStore('fonts').put(record);
    });
    registerFont(record);
    $('font').value = record.name;
    $('font').dispatchEvent(new Event('change'));
  } catch (error) {
    fontStatus(error.message);
  } finally {
    $('add-font').disabled = false;
  }
});

for (const name of ['theme', 'text-size', 'font']) {
  const control = $(name);
  const saved = localStorage.getItem('reader:' + name);
  if ([...control.options].some(option => option.value === saved)) control.value = saved;
  control.addEventListener('change', () => {
    localStorage.setItem('reader:' + name, control.value);
    reader.dataset.theme = $('theme').value;
    paginate();
  });
}
reader.dataset.theme = $('theme').value;
$('sections').addEventListener('change', event => {
  section = Number(event.target.value);
  showSection();
});
$('close').onclick = () => reader.close();
reader.addEventListener('close', () => {
  window.dispatchEvent(new CustomEvent('spine-carousel-paused', {detail: false}));
  chapterReady = false;
  chapter.removeAttribute('src');
});

function selectShelf(id) {
  selectedShelf = id;
  $('shelf-select').value = id;
  localStorage.setItem('shelf:selected', id);
  shelf.scrollLeft = 0;
  render();
}

async function saveShelf(id, update) {
  const database = await libraryDatabase;
  const record = await new Promise((resolve, reject) => {
    const transaction = database.transaction('shelves', 'readwrite');
    const store = transaction.objectStore('shelves');
    const request = store.get(id);
    let next;
    request.onsuccess = () => {
      next = update(request.result);
      store.put(next);
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onabort = () => reject(new Error('The shelf could not be saved.'));
  });
  shelves.set(id, record);
  render();
}

function addBooksToShelf(id, bookIds) {
  return saveShelf(id, current => ({...current, books: [...new Set([...current.books, ...bookIds])]}));
}

$('shelf-name').disabled = true;
libraryDatabase.then(database => {
  const request = database.transaction('shelves').objectStore('shelves').getAll();
  request.onsuccess = () => {
    for (const record of request.result) {
      shelves.set(record.id, record);
      $('shelf-select').add(new Option(record.name, record.id));
    }
    const saved = localStorage.getItem('shelf:selected');
    selectShelf(shelves.has(saved) ? saved : '');
    $('shelf-name').disabled = false;
  };
  request.onerror = () => { $('status').textContent = 'Saved shelves could not be loaded.'; };
}).catch(() => { $('status').textContent = 'Shelf storage is unavailable.'; });

$('shelf-select').onchange = event => selectShelf(event.target.value);
$('create-shelf').onsubmit = async event => {
  event.preventDefault();
  const input = $('shelf-name');
  const name = input.value.trim();
  if (!name || input.disabled) return;
  input.disabled = true;
  try {
    const id = crypto.randomUUID();
    await saveShelf(id, () => ({id, name, books: [], background: null}));
    $('shelf-select').add(new Option(name, id));
    selectShelf(id);
    input.value = '';
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    input.disabled = false;
  }
};
$('existing-book').onchange = async event => {
  if (!event.target.value) return;
  try {
    await addBooksToShelf(selectedShelf, [event.target.value]);
  } catch (error) {
    $('status').textContent = error.message;
  }
};

const backgroundDialog = $('background-dialog');
function showArtwork(choices) {
  const results = $('artwork-results');
  results.replaceChildren();
  for (const choice of choices) {
    const button = document.createElement('button');
    const image = new Image();
    button.className = 'artwork-choice';
    button.type = 'button';
    button.hidden = true;
    image.alt = '';
    image.onload = () => {
      if (!button.isConnected) return;
      if (image.naturalWidth <= 1 || image.naturalHeight <= 1) {
        image.onerror();
        return;
      }
      button.hidden = false;
      $('artwork-status').textContent = '';
    };
    image.onerror = () => {
      if (!button.isConnected) return;
      button.remove();
      if (!results.children.length) $('artwork-status').textContent = 'No artwork was available for this book.';
    };
    button.append(image, choice.label);
    button.onclick = () => setBackground(choice.url);
    results.append(button);
    image.src = choice.url;
  }
  if (!choices.length) $('artwork-status').textContent = 'No artwork was available for this book.';
}

function selectedArtworkBook() {
  return books.find(book => book.id === $('artwork-book').value);
}

function embeddedArtwork(book) {
  return book?.cover ? [{label: 'EPUB cover', url: book.cover}] : [];
}

function resetArtwork() {
  artworkRequest++;
  const book = selectedArtworkBook();
  $('lookup-artwork').disabled = !book;
  if (book?.cover) {
    showArtwork(embeddedArtwork(book));
  } else {
    $('artwork-results').replaceChildren();
    $('artwork-status').textContent = book ? 'Try an online lookup for this book.' : 'Add books to this shelf to find related artwork.';
  }
}

async function setBackground(background) {
  const current = shelves.get(selectedShelf);
  if (!current) return;
  try {
    await saveShelf(current.id, record => ({...record, background}));
    backgroundDialog.close();
  } catch (error) {
    $('artwork-status').textContent = error.message;
  }
}

$('background-settings').onclick = () => {
  const current = shelves.get(selectedShelf);
  if (!current) return;
  $('background-title').textContent = current.name + ' background';
  $('artwork-book').replaceChildren(...books.filter(book => current.books.includes(book.id))
    .map(book => new Option(book.title, book.id)));
  resetArtwork();
  backgroundDialog.showModal();
};
backgroundDialog.addEventListener('close', () => { artworkRequest++; });
$('artwork-book').onchange = resetArtwork;
$('clear-background').onclick = () => setBackground(null);
$('upload-background').onclick = () => $('background-file').click();
$('background-file').onchange = async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type) ||
      file.size > 20 * 1024 * 1024) {
    $('artwork-status').textContent = 'Choose a PNG, JPEG, WebP, GIF, or AVIF image up to 20 MB.';
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    if (backgroundDialog.open) await setBackground(file);
  } catch {
    $('artwork-status').textContent = 'This image could not be opened.';
  }
};
$('lookup-artwork').onclick = async () => {
  const book = selectedArtworkBook();
  if (!book) return;
  const request = ++artworkRequest;
  $('lookup-artwork').disabled = true;
  $('artwork-status').textContent = 'Looking up artwork…';
  try {
    const response = await fetch('/artwork/' + book.id);
    if (!response.ok) throw new Error('Online artwork lookup is unavailable.');
    const choices = await response.json();
    if (request === artworkRequest) {
      $('artwork-status').textContent = 'Loading artwork…';
      showArtwork([...embeddedArtwork(book), ...choices]);
    }
  } catch (error) {
    if (request === artworkRequest) $('artwork-status').textContent = error.message;
  } finally {
    if (request === artworkRequest) $('lookup-artwork').disabled = false;
  }
};

$('import').onclick = () => $('files').click();
$('files').addEventListener('change', async event => {
  const files = [...event.target.files];
  $('import').disabled = true;
  const failures = [];
  const destination = selectedShelf;
  const imported = [];
  let added = 0;
  for (const file of files) {
    $('status').textContent = 'Importing ' + file.name + '…';
    try {
      const response = await fetch('/import', {method: 'POST', headers: {'Content-Type': 'application/epub+zip'}, body: file});
      const book = await response.json();
      if (!response.ok) throw new Error(book.error);
      imported.push(book.id);
      if (!books.some(existing => existing.id === book.id)) {
        books.push(book);
        added++;
      }
    } catch (error) {
      failures.push(file.name + ' — ' + error.message);
    }
  }
  render();
  if (destination && imported.length) {
    try {
      await addBooksToShelf(destination, imported);
    } catch (error) {
      failures.push(error.message);
    }
  }
  $('status').textContent = [added ? 'Added ' + added + (added === 1 ? ' book.' : ' books.') : '', ...failures].filter(Boolean).join(' ');
  if (!destination && !added && !failures.length && files.length) $('status').textContent = 'These books are already on your shelf.';
  event.target.value = '';
  $('import').disabled = false;
});
$('import').disabled = true;
fetch('/library').then(response => response.json()).then(result => {
  books = result;
  render();
}).catch(() => {
  $('status').textContent = 'The library could not be loaded.';
}).finally(() => { $('import').disabled = false; });








window.addEventListener('book-carousel-ready', render);

function showPage() {
  const libraryOpen = location.hash === '#library';
  document.getElementById('library').hidden = !libraryOpen;
  document.getElementById('search-home').hidden = libraryOpen;
  document.getElementById('nav-search').setAttribute('aria-current', libraryOpen ? 'false' : 'page');
  document.getElementById('nav-library').setAttribute('aria-current', libraryOpen ? 'page' : 'false');
}
window.addEventListener('hashchange', showPage);
showPage();

let oceanWatchTimer;
let oceanWindowOpened = false;
let oceanCheckRunning = false;
function scheduleOceanCheck() {
  clearTimeout(oceanWatchTimer);
  if (oceanWindowOpened && !document.hidden) oceanWatchTimer = setTimeout(checkOceanDownloads, 10000);
}
async function checkOceanDownloads() {
  if (document.hidden || oceanCheckRunning) return;
  oceanCheckRunning = true;
  try {
    const response = await fetch('/ocean-imports', {cache: 'no-store'});
    if (!response.ok) return;
    const imported = await response.json();
    if (!imported.length) return;
    for (const book of imported) {
      if (!books.some(existing => existing.id === book.id)) books.push(book);
    }
    render();
    $('search-status').textContent = 'Imported ' + imported.map(book => book.title).join(', ') + ' into your library.';
  } catch {
    // A transient network error should not interrupt reading.
  } finally {
    oceanCheckRunning = false;
    scheduleOceanCheck();
  }
}
window.addEventListener('ocean-window-opened', () => { oceanWindowOpened = true; scheduleOceanCheck(); });
document.addEventListener('visibilitychange', scheduleOceanCheck);

const buttonClickSound = new Audio('/button-click.wav');
buttonClickSound.preload = 'auto';

document.addEventListener('click', event => {
  const control = event.target.closest('button, .app-nav a');
  if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
  buttonClickSound.currentTime = 0;
  buttonClickSound.play().catch(() => {});
}, {capture: true});
