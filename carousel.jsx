import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import './search-home';
import FlexCarousel from './FlexCarousel';
import './FlexCarousel.css';

class CarouselBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const root = createRoot(document.getElementById('cover-gallery'));
const placeholders = new Map();

function placeholder(book, color) {
  if (placeholders.has(book.id)) return placeholders.get(book.id);
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 240, 320);
  ctx.strokeStyle = '#f4d5a388';
  ctx.strokeRect(12, 12, 216, 296);
  ctx.fillStyle = '#fff0d8';
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px Georgia';
  const lines = [];
  let line = '';
  for (const word of book.title.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && ctx.measureText(next).width > 192) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, 5).forEach((text, index) => ctx.fillText(text, 120, 95 + index * 26, 192));
  ctx.font = '16px system-ui';
  ctx.fillText(book.author, 120, 278, 192);
  const image = canvas.toDataURL();
  placeholders.set(book.id, image);
  return image;
}

let lastClick;
let lastBooks = [];
window.renderBookCarousel = (books, colors, onOpen) => {
  if (books.length === lastBooks.length && books.every((book, index) => book === lastBooks[index])) return;
  lastBooks = books;
  lastClick = undefined;
  const items = books.map((book, index) => ({
    src: book.cover || placeholder(book, colors[index % colors.length]),
    alt: book.title,
    title: book.title,
    subtitle: book.author
  }));
  function openCover(index, hit) {
    const box = document.getElementById('cover-gallery').getBoundingClientRect();
    const height = box.height * .56;
    const width = height * .75;
    const bounds = hit ? {
      left: box.left + hit.x0, top: box.top + hit.y0,
      width: hit.x1 - hit.x0, height: hit.y1 - hit.y0
    } : {
      left: box.left + (box.width - width) / 2,
      top: box.top + (box.height - height) / 2,
      width, height
    };
    onOpen(books[index], bounds, colors[index % colors.length]);
  }
  root.render(items.length ? (
    <CarouselBoundary>
      <FlexCarousel items={items} preset="liquid" intro="rise" fit="portrait"
        cardHeight={0.56} radius={12} gap={16} focusOnClick={false}
        onCardClick={(index, event, hit) => {
          const click = {index, time: event.timeStamp};
          if (lastClick?.index === index && click.time - lastClick.time < 500) {
            lastClick = undefined;
            openCover(index, hit);
          } else {
            lastClick = click;
          }
        }}
        onSelect={(index, item, event) => {
          if (event.type === 'keydown') openCover(index);
        }} />
    </CarouselBoundary>
  ) : null);
};
window.dispatchEvent(new Event('book-carousel-ready'));
