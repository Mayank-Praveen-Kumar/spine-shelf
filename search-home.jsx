import { createRoot } from 'react-dom/client';
import PromptBar from './PromptBar';

const sources = [
  {key: 'oceanofpdf', name: 'OceanofPDF'},
  {key: '1lib', name: '1lib'}
];

async function searchOnline(title, {model}) {
  const status = document.getElementById('search-status');
  status.textContent = '';
  if (model.key === '1lib') {
    const query = new URL('https://1lib.sk/s/');
    query.searchParams.set('q', title);
    query.searchParams.set('languages[]', 'english');
    query.searchParams.set('extensions[]', 'EPUB');
    window.open(query.href, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    const response = await fetch('/open-ocean', {
      method: 'POST', headers: {'Content-Type': 'text/plain'}, body: title
    });
    if (!response.headers.get('Content-Type')?.startsWith('application/json')) {
      throw new Error('The search service returned an unexpected response. Restart Spine Shelf and try again.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    window.dispatchEvent(new Event('ocean-window-opened'));
    status.textContent = 'English EPUB downloads from this window are added to your library automatically.';
  } catch (error) {
    status.textContent = error.message;
  }
}

createRoot(document.getElementById('epub-search')).render(
  <PromptBar placeholder="Search by book title…"
    sources={[]} commands={[]} efforts={[]} models={sources}
    width={640} radius={24} maxRows={3}
    background="#323232" color="#f5f5f5" menuBackground="#383838" sparkColor="#e74856"
    onSend={searchOnline} />
);


