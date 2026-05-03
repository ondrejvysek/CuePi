const urlParams = new URLSearchParams(window.location.search);
const isDskOutputMode = urlParams.get('mode') === 'dsk';

if (isDskOutputMode) {
  document.body.classList.add('dsk-output');
} else {
const screenPicker = document.getElementById('screenPicker');
const refreshScreensButton = document.getElementById('refreshScreens');
const dskStatus = document.getElementById('dskStatus');
const closeAppButton = document.getElementById('closeApp');

function formatResolution(display) {
  return `${display.bounds.width}x${display.bounds.height}`;
}

function updateStatus(liveCount) {
  const isLive = liveCount > 0;
  dskStatus.classList.toggle('hidden', !isLive);
  dskStatus.innerHTML = `<span class="status-dot"></span> ${isLive ? 'DSK live' : 'DSK hidden'}`;
}

function createDisplayTile(display, liveDisplayIds) {
  const isModerator = display.isModerator;
  const isLive = liveDisplayIds.has(display.id);

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'screen-tile';
  tile.classList.toggle('moderator', isModerator);
  tile.classList.toggle('selected', isLive);
  tile.classList.toggle('live', isLive);
  tile.setAttribute('aria-pressed', String(isLive));
  tile.setAttribute('aria-label', `${isLive ? 'Stop' : 'Start'} DSK on ${display.label}`);

  const title = isModerator ? `${display.label}<br>Moderator` : display.label;

  tile.innerHTML = `
    <p class="screen-title">${title}</p>
    <div class="screen-footer">
      <p class="screen-meta">${formatResolution(display)}</p>
      <span class="power-indicator" aria-hidden="true">⏻</span>
    </div>
  `;

  tile.addEventListener('click', async () => {
    const updatedState = await window.dskApi.toggleDsk(display.id);
    render(updatedState);
  });

  return tile;
}

function render(state) {
  const displays = state.displays || [];
  const liveDisplayIds = new Set(state.liveDisplayIds || []);

  updateStatus(liveDisplayIds.size);
  screenPicker.innerHTML = '';

  if (!displays.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No displays detected.';
    screenPicker.appendChild(empty);
    return;
  }

  for (const display of displays) {
    screenPicker.appendChild(createDisplayTile(display, liveDisplayIds));
  }
}

async function refreshDisplays() {
  const state = await window.dskApi.listDisplays();
  render(state);
}

refreshScreensButton.addEventListener('click', refreshDisplays);
closeAppButton.addEventListener('click', () => window.dskApi.closeApp());
window.dskApi.onDisplaysChanged(render);

refreshDisplays();

}
