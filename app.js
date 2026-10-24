// Nobsnews: every reader gets the same labelled stories, and this page applies
// their own choices to them. Nothing about the reader leaves the browser.

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'nobsnews.prefs.v1';
const SEEN_KEY = 'nobsnews.seen.v1';  // when the reader last had the page open
const TOP_COUNT = 5;
const LEFT_OUT_SHOWN = 60;
const SOURCES_SHOWN = 3;  // outlets named under a story before "+N more"
const FLAGS = [
  ['clickbait', 'Clickbait', 'Headlines that tease instead of saying what happened.'],
  ['outrage', 'Outrage bait', 'Stories about people being angry, with nothing new underneath.'],
  ['opinion', 'Opinion and hot takes', 'Columns, commentary and predictions rather than reports.'],
  ['celebrity', 'Celebrity and gossip', 'Entertainers, influencers, royals, who said what about whom.'],
  ['sport', 'Sport', 'Match reports, results, transfers and sports personalities.'],
  ['filler', 'Filler', 'Viral moments, quirky one-offs, and updates with nothing new.'],
];
// A flag is ignored when the reader follows the topic it describes.
const FLAG_TOPIC = {sport: 'sport', celebrity: 'entertainment'};
// Topics as they are grouped wherever the reader picks them. A topic missing from here goes under "More".
const GROUPS = [
  ['Australia', ['australia', 'au-politics', 'au-economy', 'property']],
  ['World', ['world', 'conflict', 'us', 'asia']],
  ['Money', ['business', 'markets', 'crypto']],
  ['Science and technology', ['tech', 'ai', 'science', 'health']],
  ['Climate and energy', ['climate', 'energy', 'ev']],
  ['Sport and culture', ['sport', 'entertainment']],
];
// Starting points for a first-time reader: name, what it holds, its topics. No topics means all of them.
const PACKS = [
  ['The main news', 'The biggest stories from every topic', []],
  ['Australia', 'National news, politics, rates and housing', ['australia', 'au-politics', 'au-economy', 'property']],
  ['Money', 'Rates, markets, property and crypto', ['au-economy', 'business', 'markets', 'property', 'crypto']],
  ['Tech and science', 'Technology, AI, science and health', ['tech', 'ai', 'science', 'health']],
];
const EXAMPLE_LENGTH = [20, 70];  // headlines shown as examples in the welcome: short enough to read at a glance
const DEFAULTS = {
  topics: [], keywords: [], leaveOut: ['clickbait', 'outrage'], region: 'all',
  perTopic: 6, days: 2, bigOnly: false, outletsOff: [],
  welcomed: false,  // false until a first-time reader has been through, or skipped, the welcome
};

let data = null;       // {generated, stories, outlets}
let catalogue = [];    // [{id, label, about}]
let prefs = loadPrefs();
let justWelcomed = false;    // true for the rest of the visit in which the reader finished the welcome
const expanded = new Set();  // sections whose full list is open
const allSources = new Set();  // stories whose full list of outlets is open
let since = readSeen();  // stories updated after this are new to the reader; none on a first visit
let tabs = [];  // [button, section] in the bar of the reader's sections

function readSeen() {
  try { return new Date(localStorage.getItem(SEEN_KEY) || NaN); } catch { return new Date(NaN); }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* nothing is marked new next time */ }
}

function isNew(story) {
  return new Date(story.updated) > since;  // false while there is no last visit to compare with
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {})};
  } catch {
    return {...DEFAULTS};  // private windows and blocked storage: the page still works
  }
}

function setPrefs(patch) {
  prefs = {...prefs, ...patch};
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* choices last for this visit only */ }
  render();
}

function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function toggled(list, value) {
  return list.includes(value) ? list.filter((other) => other !== value) : [...list, value];
}

// --- which stories this reader sees --------------------------------------------

function mentions(story, keyword) {
  const text = `${story.headline} ${story.summary} ${story.tags.join(' ')}`.toLowerCase();
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

// The flag that keeps a story off this reader's page, if any.
function leftOutBy(story) {
  return story.flags.find((flag) => prefs.leaveOut.includes(flag) && !prefs.topics.includes(FLAG_TOPIC[flag])) || null;
}

function sourcesShown(story) {
  return story.sources.filter((source) => !prefs.outletsOff.includes(source.outlet));
}

// Passes everything except the reader's topics and flags: date, region, size and sources.
function inRange(story) {
  if (Date.now() - new Date(story.updated) > prefs.days * 86400000) return false;
  if (prefs.region !== 'all' && story.region !== prefs.region) return false;
  if (prefs.bigOnly && story.importance < 3 && story.outlets < 2) return false;
  return sourcesShown(story).length > 0;
}

// The reader's sections in order: followed topics, then followed words.
function sections() {
  const following = catalogue.filter((topic) => prefs.topics.includes(topic.id))
    .map((topic) => ({key: topic.id, label: topic.label, has: (story) => story.topics.includes(topic.id)}));
  const words = prefs.keywords
    .map((word) => ({key: `word:${word}`, label: word, has: (story) => mentions(story, word)}));
  return [...following, ...words];
}

function rank(a, b) {
  return b.importance - a.importance || b.outlets - a.outlets || b.updated.localeCompare(a.updated);
}

// --- rendering -----------------------------------------------------------------

function link(url, text) {
  return el('a', {href: url, target: '_blank', rel: 'noopener noreferrer', textContent: text});
}

// The most specific of a story's topics, shown above its headline where the section doesn't already say it.
function kicker(story) {
  const id = story.topics.find((topic) => topic !== 'australia' && topic !== 'world') || story.topics[0];
  const topic = catalogue.find((entry) => entry.id === id);
  return topic ? topic.label : '';
}

function storyNode(story, {lead = false, labelled = false} = {}) {
  const sources = sourcesShown(story);
  const parts = [];
  if (labelled && kicker(story)) parts.push(el('p', {className: 'kicker', textContent: kicker(story)}));
  parts.push(el('h3', {}, link(sources[0].url, story.headline)));
  if (story.summary) parts.push(el('p', {className: 'sum', textContent: story.summary}));  // not every feed gives an excerpt

  const meta = el('div', {className: 'meta'});
  if (isNew(story)) meta.append(el('span', {className: 'new', textContent: 'New'}), ' · ');
  meta.append(ago(story.updated));
  // How widely a story ran is what ranks it, so say so once it's more than a couple of outlets.
  if (story.outlets >= 3) meta.append(' · ', el('span', {className: story.outlets >= 5 ? 'wide' : '', textContent: `${story.outlets} outlets`}));
  const open = allSources.has(story.id);
  for (const source of open ? sources : sources.slice(0, SOURCES_SHOWN)) meta.append(' · ', link(source.url, source.outlet));
  if (sources.length > SOURCES_SHOWN) {
    const toggle = el('button', {type: 'button', textContent: open ? 'fewer' : `+${sources.length - SOURCES_SHOWN} more`});
    toggle.onclick = () => {
      if (open) allSources.delete(story.id); else allSources.add(story.id);
      render();
    };
    meta.append(' · ', toggle);
  }
  parts.push(meta);
  return el('article', {className: lead ? 'lead' : ''}, ...parts);
}

function sectionNode(key, label, stories, limit) {
  const top = key === 'top';
  const heading = el('h2', {}, el('span', {textContent: label}));
  const mixed = key === 'more';  // the rest of the news, from every topic
  if (stories.length && !top && !mixed) heading.append(el('span', {className: 'count', textContent: String(stories.length)}));
  const section = el('section', {className: 'sec'}, heading);
  if (!stories.length) {
    section.append(el('p', {className: 'empty', textContent: 'Nothing new here.'}));
  } else if (top) {
    // The biggest story leads, with the second under it; the next few sit beside them, or below on a phone.
    const [first, second, ...rest] = stories;
    const main = el('div', {className: 'main'}, storyNode(first, {lead: true, labelled: true}));
    if (second) main.append(storyNode(second, {labelled: true}));
    const grid = el('div', {className: rest.length ? 'lead-grid' : 'lead-grid solo'}, main);
    if (rest.length) grid.append(el('div', {className: 'side'}, ...rest.map((story) => storyNode(story, {labelled: true}))));
    section.append(grid);
  } else {
    const open = expanded.has(key) || !limit;
    section.append(el('div', {className: 'grid'},
      ...(open ? stories : stories.slice(0, limit)).map((story) => storyNode(story, {labelled: mixed}))));
    if (limit && stories.length > limit) {
      const toggle = el('button', {type: 'button', className: 'more',
        textContent: open ? 'Show fewer' : `Show ${stories.length - limit} more`});
      toggle.onclick = () => {
        if (open) expanded.delete(key); else expanded.add(key);
        render();
      };
      section.append(toggle);
    }
  }
  return section;
}

function renderStories() {
  const mine = sections();
  const everything = !mine.length;  // nothing chosen yet: show the main news from all topics
  const inScope = data.stories.filter((story) => inRange(story) && (everything || mine.some((s) => s.has(story))));
  const shown = inScope.filter((story) => !leftOutBy(story)).sort(rank);
  const hidden = inScope.filter(leftOutBy);

  const nodes = [];
  const bar = [];  // [label, section] for the bar of the reader's sections
  const top = shown.filter((story) => story.importance >= 3).slice(0, TOP_COUNT);
  if (top.length) {
    nodes.push(sectionNode('top', 'Top stories', top, 0));
    bar.push(['Top', nodes[0]]);
  }
  const used = new Set(top.map((story) => story.id));

  if (everything) {
    const rest = shown.filter((story) => !used.has(story.id));
    nodes.push(sectionNode('more', 'More news', rest, prefs.perTopic || 6));
  }
  for (const section of mine) {
    // A story sits under the first of the reader's sections it belongs to.
    const stories = shown.filter((story) => !used.has(story.id) && section.has(story));
    stories.forEach((story) => used.add(story.id));
    const node = sectionNode(section.key, section.label, stories, prefs.perTopic);
    bar.push([section.label, node]);
    nodes.push(node);
  }
  if (!nodes.length) nodes.push(el('p', {className: 'empty', textContent: 'Nothing to show with these choices.'}));
  $('stories').replaceChildren(...nodes);
  renderBar(everything || !prefs.welcomed ? [] : bar);

  $('left-out').hidden = !hidden.length;
  $('left-out-count').replaceChildren(`Left out: ${hidden.length} ${hidden.length === 1 ? 'story' : 'stories'}`,
    el('span', {textContent: ' · see which, and why'}));
  $('left-out-list').replaceChildren(...hidden.sort(rank).slice(0, LEFT_OUT_SHOWN)
    .map((story) => leftOutItem(story, leftOutBy(story), sourcesShown(story)[0])));
  return shown.filter(isNew).length;
}

// The bar of the reader's sections: a tap jumps to one, and the one in view is marked.
function renderBar(entries) {
  tabs = entries.map(([label, section]) => {
    const button = el('button', {type: 'button', textContent: label});
    button.onclick = () => section.scrollIntoView({block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    return [button, section];
  });
  $('jump').hidden = tabs.length < 2;
  $('jump').replaceChildren(...tabs.map(([button]) => button));
  markCurrentTab();
}

function markCurrentTab() {
  if (!tabs.length) return;
  const below = $('jump').getBoundingClientRect().bottom + 24;
  let current = tabs[0][0];
  for (const [button, section] of tabs) {
    if (section.getBoundingClientRect().top <= below) current = button;
  }
  for (const [button] of tabs) button.setAttribute('aria-current', String(button === current));
  const strip = $('jump');  // keep the marked section in sight when the bar scrolls sideways
  if (current.offsetLeft < strip.scrollLeft || current.offsetLeft + current.offsetWidth > strip.scrollLeft + strip.clientWidth) {
    strip.scrollTo({left: current.offsetLeft - 16});
  }
}

// Rebuild a list only when what it shows has changed, so a control in use keeps its focus.
function rebuild(node, key, build) {
  const text = JSON.stringify(key);
  if (node.dataset.key === text) return;
  node.dataset.key = text;
  node.replaceChildren(...build());
}

// The topics to pick from, under their group headings: used by the welcome and by the settings.
function renderTopicChips(node) {
  rebuild(node, catalogue, () => {
    const grouped = GROUPS.flatMap(([, ids]) => ids);
    const rest = catalogue.filter((topic) => !grouped.includes(topic.id)).map((topic) => topic.id);
    return [...GROUPS, ['More', rest]].flatMap(([label, ids]) => {
      const topics = catalogue.filter((topic) => ids.includes(topic.id));
      if (!topics.length) return [];
      const chips = el('ul', {className: 'chips'}, ...topics.map((topic) => {
        const chip = el('button', {type: 'button', className: 'chip pick', textContent: topic.label, title: topic.about});
        chip.dataset.topic = topic.id;
        chip.onclick = () => setPrefs({topics: toggled(prefs.topics, topic.id)});
        return el('li', {}, chip);
      }));
      chips.setAttribute('aria-label', label);
      return [el('p', {className: 'group', textContent: label}), chips];
    });
  });
  for (const chip of node.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(prefs.topics.includes(chip.dataset.topic)));
  }
}

function renderSettings() {
  renderTopicChips($('topic-chips'));
  rebuild($('keyword-chips'), prefs.keywords, () => prefs.keywords.map((word) => {
    const chip = el('button', {type: 'button', className: 'chip', textContent: `${word} ×`, title: `Stop following ${word}`});
    chip.setAttribute('aria-pressed', 'true');
    chip.onclick = () => setPrefs({keywords: prefs.keywords.filter((other) => other !== word)});
    return el('li', {}, chip);
  }));
  rebuild($('leave-out'), prefs.leaveOut, () => FLAGS.map(([key, label, about]) => {
    const box = el('input', {type: 'checkbox', id: `leave-${key}`, checked: prefs.leaveOut.includes(key)});
    box.onchange = () => setPrefs({leaveOut: toggled(prefs.leaveOut, key)});
    return el('li', {}, el('label', {}, box, el('span', {}, label, el('small', {textContent: about}))));
  }));
  const outlets = data.outlets || [];
  $('outlet-count').textContent = `${outlets.length - prefs.outletsOff.length} of ${outlets.length}`;
  rebuild($('outlets'), [outlets, prefs.outletsOff], () => outlets.map((name, index) => {
    const box = el('input', {type: 'checkbox', id: `outlet-${index}`, checked: !prefs.outletsOff.includes(name)});
    box.onchange = () => setPrefs({outletsOff: toggled(prefs.outletsOff, name)});
    return el('li', {}, el('label', {}, box, el('span', {textContent: name})));
  }));
  $('region').value = prefs.region;
  $('per-topic').value = String(prefs.perTopic);
  $('days').value = String(prefs.days);
  $('big-only').checked = prefs.bigOnly;
}

// One left-out story as the trays show it: the headline in quotes, and under it why it was left out.
function leftOutItem(story, kind, source) {
  const [, label, about] = FLAGS.find(([key]) => key === kind);
  const reason = (story.flags[0] === kind && story.flag_reason) || about;  // the engine's reason is for the first flag
  const why = reason.replace(/^The headline (is )?/, '').replace(/\.$/, '').replace(/"([^"]*)"/g, '“$1”');
  const quote = el('q', {textContent: story.headline});
  const note = el('small', {}, el('b', {textContent: label}), ` · ${why.charAt(0).toLowerCase()}${why.slice(1)}`);
  if (source) note.append(` · ${source.outlet}`);
  const headline = source ? el('a', {href: source.url, target: '_blank', rel: 'noopener noreferrer'}, quote) : quote;
  return el('li', {}, headline, note);
}

// Real headlines the standard filter is holding back, as proof: the newest readable one of each kind.
function renderExamples() {
  const kinds = DEFAULTS.leaveOut;
  const held = data.stories.filter((story) => Date.now() - new Date(story.updated) < DEFAULTS.days * 86400000
    && story.flags.some((flag) => kinds.includes(flag)));
  const readable = held
    .filter((story) => story.headline.length >= EXAMPLE_LENGTH[0] && story.headline.length <= EXAMPLE_LENGTH[1])
    .filter((story) => !/\([A-Z]+:[A-Z.]+\)|(\.\.\.|…)$/.test(story.headline))  // no share codes, no cut-off headlines
    .sort((a, b) => b.updated.localeCompare(a.updated));
  const picks = [];
  for (const kind of [...kinds, ...kinds]) {
    const story = readable.find((other) => other.flags.includes(kind) && !picks.some(([picked]) => picked === other));
    if (story && picks.length < 3) picks.push([story, kind]);
  }
  $('examples').hidden = !picks.length;
  $('examples-count').textContent = String(held.length);
  rebuild($('examples-list'), picks.map(([story]) => story.id), () => picks.map(([story, kind]) => leftOutItem(story, kind)));
}

function finishWelcome(patch) {
  justWelcomed = true;
  setPrefs({...patch, welcomed: true});
  window.scrollTo({top: 0});
}

function renderWelcome() {
  renderExamples();
  rebuild($('packs'), PACKS, () => PACKS.map(([name, holds, topics], index) => {
    const pack = el('button', {type: 'button', className: index ? 'pack' : 'pack suggested'},
      el('b', {textContent: name}), el('small', {textContent: holds}));
    pack.onclick = () => finishWelcome({topics});
    return pack;
  }));
  renderTopicChips($('welcome-topics'));
  $('welcome-done').textContent = prefs.topics.length ? 'Show me my news' : 'Show me the main news';
}

function showOwnTopics(open) {
  $('own').hidden = !open;
  $('own-toggle').setAttribute('aria-expanded', String(open));
}

function greeting() {
  if (justWelcomed) return "You're all set. Here's your news.";
  const hour = new Date().getHours();
  const part = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}. Here's what matters.`;
}

function render() {
  if (!data) return;
  const firstVisit = !prefs.welcomed;
  $('welcome').hidden = !firstVisit;
  $('open-settings').hidden = firstVisit;
  if (firstVisit) {
    $('settings').hidden = true;
    renderWelcome();
  }
  $('front').hidden = firstVisit;
  $('greeting').textContent = greeting();
  $('small-print').textContent = data.written_by === 'model'
    ? "Headlines and summaries are written by an AI model from each outlet's own headline and feed excerpt, not from the full article. Follow the links for the full story. Your choices are saved in this browser only."
    : "Headlines and excerpts are the outlets' own. Stories are grouped, ranked by how many outlets reported them, and filtered by fixed rules; no AI is involved. Your choices are saved in this browser only.";
  renderSettings();
  const fresh = renderStories();
  const today = new Date().toLocaleDateString(undefined, {weekday: 'long', day: 'numeric', month: 'long'});
  $('dateline').textContent = [today, `Updated ${ago(data.generated)}`, fresh && !firstVisit ? `${fresh} new since you last looked` : '']
    .filter(Boolean).join(' · ');
}

// --- loading and wiring ----------------------------------------------------------

async function load() {
  try {
    const [stories, topics] = await Promise.all([
      // Ask the server whether the news changed since the copy this device holds: an
      // unchanged file costs a few hundred bytes instead of the whole download.
      fetch('data/stories.json', {cache: 'no-cache'}).then((response) => response.json()),
      fetch('data/catalogue.json').then((response) => response.json()),
    ]);
    const changed = !data || stories.generated !== data.generated;
    data = stories;
    catalogue = topics;
    if (changed) render();
  } catch {
    if (!data) $('stories').replaceChildren(el('p', {className: 'empty', textContent: 'The news could not be loaded. Try again in a minute.'}));
  }
}

// Choosing your news opens over the page. It is an entry in the browser's history, so
// the phone's back button closes it rather than leaving the app.
function showSettings(open, {fromHistory = false} = {}) {
  if (open === !$('settings').hidden) return;
  $('settings').hidden = !open;
  document.documentElement.classList.toggle('sheet-open', open);
  $('open-settings').setAttribute('aria-expanded', String(open));
  try {
    if (open && !fromHistory) history.pushState({settings: true}, '');
    if (!open && !fromHistory && history.state?.settings) history.back();
  } catch { /* without history the sheet still opens and closes */ }
  if (open) $('settings-title').focus();
  else $('open-settings').focus({preventScroll: true});
  render();
}
$('open-settings').onclick = () => showSettings(true);
$('settings-done').onclick = () => showSettings(false);
window.addEventListener('popstate', () => showSettings(Boolean(history.state?.settings), {fromHistory: true}));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('settings').hidden) showSettings(false);
});
if (location.hash === '#choose') showSettings(true);  // a link straight to the choices
if (location.hash === '#welcome') prefs = {...prefs, welcomed: false};  // a link that shows the welcome again
$('add-keyword').onsubmit = (event) => {
  event.preventDefault();
  const word = $('keyword-input').value.trim().replace(/\s+/g, ' ');
  $('keyword-input').value = '';
  if (word && !prefs.keywords.some((other) => other.toLowerCase() === word.toLowerCase())) {
    setPrefs({keywords: [...prefs.keywords, word].slice(0, 20)});
  }
};
$('welcome-done').onclick = () => finishWelcome({});
$('own-toggle').onclick = () => showOwnTopics($('own').hidden);
$('reset').onclick = () => {
  try { localStorage.removeItem(PREFS_KEY); } catch { /* nothing was saved */ }
  prefs = {...DEFAULTS};
  justWelcomed = false;
  showOwnTopics(false);
  showSettings(false);
  window.scrollTo({top: 0});
};
$('region').onchange = () => setPrefs({region: $('region').value});
$('per-topic').onchange = () => setPrefs({perTopic: Number($('per-topic').value)});
$('days').onchange = () => setPrefs({days: Number($('days').value)});
$('big-only').onchange = () => setPrefs({bigOnly: $('big-only').checked});

// --- installing as an app ---------------------------------------------------------

// Chrome, Edge and Android offer an install prompt the page can trigger; iPhones
// don't, which is what the written instructions beside the button are for.
let installOffer = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installOffer = event;
  $('install').hidden = false;
});
$('install').onclick = async () => {
  if (!installOffer) return;
  installOffer.prompt();
  await installOffer.userChoice;
  installOffer = null;
  $('install').hidden = true;
};
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
  $('get-app').hidden = true;  // already running as the installed app
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* the page works without it */ });
}

load();
setInterval(load, 10 * 60 * 1000);  // pick up the engine's next update without a reload
// Leaving the page marks everything so far as seen. The installed app is usually reopened
// from the background hours later: fetch the latest news at once, and mark what came in since.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    markSeen();
  } else {
    since = readSeen();
    if (data) render();
    load();
  }
});
window.addEventListener('pagehide', markSeen);
setInterval(() => { if (!String(window.getSelection())) render(); }, 60 * 1000);  // keep "x min ago" true
let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; markCurrentTab(); });
}, {passive: true});
