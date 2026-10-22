let sources = [];
let selectedId = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function updateShareState() {
  const btn = document.getElementById("shareBtn");
  btn.disabled = !selectedId;
}

function render() {
  const container = document.getElementById("sources");
  if (!sources.length) {
    container.innerHTML = '<div class="empty">No screens or windows found.</div>';
    return;
  }
  container.innerHTML = sources
    .map(
      (source) => `
      <article class="source-card${selectedId === source.id ? " selected" : ""}" data-id="${escapeHtml(source.id)}" role="option" aria-selected="${selectedId === source.id}" tabindex="0">
        <img class="thumb" src="${source.thumbnail}" alt="" />
        <div class="info">
          <div class="name">${escapeHtml(source.name)}</div>
          <div class="type">${source.id.startsWith("screen:") ? "screen" : "window"}</div>
        </div>
      </article>`,
    )
    .join("");
}

function selectFromEvent(event) {
  const card = event.target.closest(".source-card");
  if (!card) return;
  const id = card.dataset.id;
  selectedId = selectedId === id ? null : id;
  updateShareState();
  render();
}

async function load() {
  try {
    const list = await window.knouxPicker.list();
    sources = Array.isArray(list) ? list : [];
    if (sources.length === 1) selectedId = sources[0].id;
    updateShareState();
    render();
  } catch (error) {
    document.getElementById("sources").innerHTML =
      '<div class="empty">Failed to load sources.</div>';
  }
}

document
  .getElementById("sources")
  .addEventListener("click", selectFromEvent);
document.getElementById("sources").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectFromEvent(event);
  }
});

document.getElementById("shareBtn").addEventListener("click", () => {
  if (!selectedId) return;
  window.knouxPicker.choose(
    selectedId,
    document.getElementById("shareAudio").checked,
  );
});

document.getElementById("cancelBtn").addEventListener("click", () => {
  window.knouxPicker.cancel();
});

load();
