// site.js - Complete merged version (conflicts resolved)

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot,
         query, orderBy, limit, deleteDoc, doc, 
         serverTimestamp, getDoc, setDoc, getDocs, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

// Global state
window._chatTabPending = false;
window._usersTabPending = false;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let uid = localStorage.getItem('wl_uid');
if (!uid) { uid = crypto.randomUUID(); localStorage.setItem('wl_uid', uid); }

let currentUser = null;
let chatStarted = false;
let currentAccount = null;
let usersListStarted = false;
let usersByUsernameLower = new Map();
let currentProfileUsername = '';
let latestUsersListDocs = [];
let badgeDefinitions = new Map();
let userBadgesByUsernameLower = new Map();
let currentUserCanModerateChat = false;
let currentUserIsFirestoreAdmin = false;
let currentTimeoutUntilMs = 0;
let chatTimeoutUnsubscribe = null;
const embeddedBadgeConfig = window.__BADGE_CONFIG__ || {};
const embeddedProfileButtons = window.__PROFILE_BUTTON_ASSETS__ || [];
const DEFAULT_UI_BAR_COLOR = '#000080';
const MAX_PROFILE_BUTTONS = 150;

// Utility functions
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeHttpUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value).trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeButtonAssetPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('./assets/buttons/')) return raw;
  if (raw.startsWith('/assets/buttons/')) return `.${raw}`;
  if (raw.startsWith('assets/buttons/')) return `./${raw}`;
  return '';
}

function labelFromButtonPath(pathValue) {
  return pathValue
    .replace(/^\.\/assets\/buttons\//, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'button';
}

const profileButtonAssets = Array.from(
  new Set(
    (Array.isArray(embeddedProfileButtons) ? embeddedProfileButtons : [])
      .map((value) => normalizeButtonAssetPath(value))
      .filter(Boolean)
  )
);
const profileButtonAssetSet = new Set(profileButtonAssets);

function initialsForProfile(profile) {
  const source = String(profile.displayName || profile.username || '?').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function profileImageHintFromStatus(profile) {
  if (profile.profileImageStatus === 'pending') {
    return 'Profile image update request is pending approval.';
  }
  if (profile.profileImageStatus === 'rejected') {
    return 'Last profile image request was not approved.';
  }
  if (profile.profileImageStatus === 'approved' && profile.profileImageUrl) {
    return 'Current profile image is approved and visible.';
  }
  return 'No custom profile image submitted yet.';
}

function youtubeEmbedUrl(songUrl) {
  if (!songUrl) return '';
  try {
    const parsed = new URL(songUrl);
    const host = parsed.hostname.toLowerCase();
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = parsed.pathname.slice(1);
    } else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        videoId = parsed.searchParams.get('v') || '';
      } else if (parsed.pathname.startsWith('/embed/')) {
        videoId = parsed.pathname.slice('/embed/'.length);
      } else if (parsed.pathname.startsWith('/shorts/')) {
        videoId = parsed.pathname.slice('/shorts/'.length);
      }
    }

    videoId = videoId.split('/')[0].split('?')[0].trim();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return '';
    return `https://www.youtube.com/embed/${videoId}`;
  } catch {
    return '';
  }
}

function normalizeSongUrl(songUrl) {
  if (!songUrl) return '';
  
  const embedUrl = youtubeEmbedUrl(songUrl);
  if (embedUrl) {
    return embedUrl.replace('/embed/', '/watch?v=');
  }

  const isAudioFile = /\.(mp3|wav|ogg|m4a|flac)$/i.test(songUrl.split(/[#?]/)[0]);
  if (isAudioFile) {
    return normalizeHttpUrl(songUrl);
  }

  return '';
}

function formatAudioTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const PROFILE_THEME_PRESETS = {
  classic: {
    accent: '#000080',
    bgStart: '#f8f8f8',
    bgEnd: '#e5e5e5',
    text: '#000000',
    textMuted: '#444444',
    panelBg: '#ffffff',
    bar: '#000080'
  },
  'pydra-light': {
    accent: '#2596be',
    bgStart: '#e0f7ff',
    bgEnd: '#81d4fa',
    text: '#2c3e50',
    textMuted: '#4b647a',
    panelBg: '#ffffff',
    bar: '#2596be'
  },
  'pydra-dark': {
    accent: '#2596be',
    bgStart: '#0a0a0a',
    bgEnd: '#141414',
    text: '#ffffff',
    textMuted: '#b0b0b0',
    panelBg: '#2a2a2a',
    bar: '#1f7fa1'
  },
  sunset: {
    accent: '#c2410c',
    bgStart: '#fff1e6',
    bgEnd: '#ffd8b3',
    text: '#3f1d00',
    textMuted: '#7c2d12',
    panelBg: '#fffaf5',
    bar: '#c2410c'
  },
  matrix: {
    accent: '#00a651',
    bgStart: '#0f1a14',
    bgEnd: '#0a120d',
    text: '#b7f7cf',
    textMuted: '#7bc89f',
    panelBg: '#102218',
    bar: '#0f5f2f'
  },
  midnight: {
    accent: '#4f46e5',
    bgStart: '#0f172a',
    bgEnd: '#111827',
    text: '#e5e7eb',
    textMuted: '#94a3b8',
    panelBg: '#1f2937',
    bar: '#4f46e5'
  },
  bliish: {
    accent: '#6b21a8',
    bgStart: '#f0ebfa',
    bgEnd: '#ddd6fe',
    text: '#1a1a1a',
    textMuted: '#6b7280',
    panelBg: '#fdfcff',
    bar: '#6b21a8'
  }
};

function normalizeThemePreset(value) {
  const preset = String(value || '').trim().toLowerCase();
  if (preset === 'ocean') return 'pydra-light';
  if (!preset || !PROFILE_THEME_PRESETS[preset]) return 'classic';
  return preset;
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  return '';
}

function profileThemeFromData(data) {
  const preset = normalizeThemePreset(data.profileThemePreset || 'classic');
  const base = PROFILE_THEME_PRESETS[preset];
  const stored = data.profileThemeColors && typeof data.profileThemeColors === 'object'
    ? data.profileThemeColors
    : {};

  return {
    preset,
    colors: {
      accent: normalizeHexColor(stored.accent) || base.accent,
      bgStart: normalizeHexColor(stored.bgStart) || base.bgStart,
      bgEnd: normalizeHexColor(stored.bgEnd) || base.bgEnd,
      text: normalizeHexColor(stored.text) || base.text,
      textMuted: normalizeHexColor(stored.textMuted) || base.textMuted,
      panelBg: normalizeHexColor(stored.panelBg) || base.panelBg,
      bar: normalizeHexColor(stored.bar) || base.bar
    }
  };
}

function setThemeInputValues(colors) {
  const accent = document.getElementById('profile-theme-accent');
  const bgStart = document.getElementById('profile-theme-bg-start');
  const bgEnd = document.getElementById('profile-theme-bg-end');
  const text = document.getElementById('profile-theme-text');
  const textMuted = document.getElementById('profile-theme-text-muted');
  const panelBg = document.getElementById('profile-theme-panel-bg');
  const bar = document.getElementById('profile-theme-bar');

  if (accent) accent.value = colors.accent;
  if (bgStart) bgStart.value = colors.bgStart;
  if (bgEnd) bgEnd.value = colors.bgEnd;
  if (text) text.value = colors.text;
  if (textMuted) textMuted.value = colors.textMuted;
  if (panelBg) panelBg.value = colors.panelBg;
  if (bar) bar.value = colors.bar;
}

function readThemeInputValues(preset) {
  const base = PROFILE_THEME_PRESETS[normalizeThemePreset(preset)];
  const accent = normalizeHexColor(document.getElementById('profile-theme-accent')?.value) || base.accent;
  const bgStart = normalizeHexColor(document.getElementById('profile-theme-bg-start')?.value) || base.bgStart;
  const bgEnd = normalizeHexColor(document.getElementById('profile-theme-bg-end')?.value) || base.bgEnd;
  const text = normalizeHexColor(document.getElementById('profile-theme-text')?.value) || base.text;
  const textMuted = normalizeHexColor(document.getElementById('profile-theme-text-muted')?.value) || base.textMuted;
  const panelBg = normalizeHexColor(document.getElementById('profile-theme-panel-bg')?.value) || base.panelBg;
  const bar = normalizeHexColor(document.getElementById('profile-theme-bar')?.value) || base.bar;

  return { accent, bgStart, bgEnd, text, textMuted, panelBg, bar };
}

function applyGlobalBarColor(color) {
  const resolved = normalizeHexColor(color) || DEFAULT_UI_BAR_COLOR;
  document.documentElement.style.setProperty('--theme-bar-bg', resolved);
}

function resetGlobalBarColor() {
  document.documentElement.style.setProperty('--theme-bar-bg', DEFAULT_UI_BAR_COLOR);
}

function colorLuminance(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return 0;
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return ((0.2126 * r) + (0.7152 * g) + (0.0722 * b)) / 255;
}

function applyGlobalBackground(barColor) {
  const base = normalizeHexColor(barColor) || '#008080';
  const isDark = colorLuminance(base) < 0.45;
  const grid = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
  const root = document.documentElement;
  root.style.setProperty('--theme-body-start', base);
  root.style.setProperty('--theme-body-end', base);
  root.style.setProperty('--theme-body-grid', grid);
}

function resetGlobalBackground() {
  const root = document.documentElement;
  root.style.setProperty('--theme-body-start', '#008080');
  root.style.setProperty('--theme-body-end', '#008080');
  root.style.setProperty('--theme-body-grid', 'rgba(255, 255, 255, 0.05)');
}

function applyGlobalThemeFromProfile(profile) {
  const theme = profileThemeFromData(profile || {});
  applyGlobalBarColor(theme.colors.bar);
  applyGlobalBackground(theme.colors.bar);
}

function profileFromAccountData(data) {
  const username = String(data.username || 'unknown').trim();
  const displayName = String(data.displayName || username).trim();
  const bio = String(data.bio || '').trim();
  const pronouns = String(data.pronouns || '').trim();
  const songUrl = String(data.songUrl || '').trim();
  const songTitle = String(data.songTitle || '').trim();
  const songArtist = String(data.songArtist || '').trim();
  const profileImageUrl = normalizeHttpUrl(data.profileImageUrl || '');
  const profileImageRequestedUrl = normalizeHttpUrl(data.profileImageRequestedUrl || '');
  const theme = profileThemeFromData(data);
  const profileButtons = Array.isArray(data.profileButtons)
    ? data.profileButtons
        .map((value) => normalizeButtonAssetPath(value))
        .filter((value, index, arr) => profileButtonAssetSet.has(value) && arr.indexOf(value) === index)
        .slice(0, MAX_PROFILE_BUTTONS)
    : [];
  const rawProfileImageStatus = String(data.profileImageStatus || '').trim().toLowerCase();
  let profileImageStatus = 'none';
  if (rawProfileImageStatus === 'approved' && profileImageUrl) {
    profileImageStatus = 'approved';
  } else if (rawProfileImageStatus === 'pending' && profileImageRequestedUrl) {
    profileImageStatus = 'pending';
  } else if (rawProfileImageStatus === 'rejected') {
    profileImageStatus = 'rejected';
  }

  return {
    username,
    usernameLower: normalizeUsername(data.usernameLower || username),
    displayName,
    bio,
    pronouns,
    songUrl,
    songTitle,
    songArtist,
    profileImageUrl,
    profileImageRequestedUrl,
    profileImageStatus,
    profileThemePreset: theme.preset,
    profileThemeColors: theme.colors,
    profileButtons
  };
}

function renderProfileButtonPicker(selectedButtons = []) {
  const picker = document.getElementById('profile-button-picker');
  if (!picker) return;

  picker.innerHTML = '';
  if (!profileButtonAssets.length) {
    picker.textContent = 'No profile buttons available.';
    return;
  }

  const selectedSet = new Set(
    (Array.isArray(selectedButtons) ? selectedButtons : [])
      .map((value) => normalizeButtonAssetPath(value))
      .filter((value) => profileButtonAssetSet.has(value))
      .slice(0, MAX_PROFILE_BUTTONS)
  );

  profileButtonAssets.forEach((assetPath) => {
    const option = document.createElement('label');
    option.className = 'users-profile-button-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'profile-button-asset';
    checkbox.value = assetPath;
    checkbox.checked = selectedSet.has(assetPath);

    checkbox.addEventListener('change', () => {
      if (!checkbox.checked) return;
      const checkedCount = picker.querySelectorAll('input[name="profile-button-asset"]:checked').length;
      if (checkedCount > MAX_PROFILE_BUTTONS) {
        checkbox.checked = false;
      }
    });

    const image = document.createElement('img');
    image.className = 'users-profile-button-image';
    image.src = assetPath;
    image.alt = labelFromButtonPath(assetPath);
    image.loading = 'lazy';

    option.appendChild(checkbox);
    option.appendChild(image);
    picker.appendChild(option);
  });
}

function authEmailForUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  const hex = Array.from(normalized)
    .map(ch => ch.codePointAt(0).toString(16).padStart(4, '0'))
    .join('');
  return `u${hex}@users.wavelength.local`;
}

function buildBadgeElement(badge, className = 'profile-badge') {
  const el = document.createElement('span');
  el.className = className;
  el.title = badge.title;
  el.dataset.tooltip = badge.title;
  el.setAttribute('aria-label', badge.title);
  el.tabIndex = 0;

  if (badge.image) {
    const img = document.createElement('img');
    img.className = `${className}-img`;
    img.src = badge.image;
    img.alt = badge.label;
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.remove();
      const text = document.createElement('span');
      text.className = `${className}-text`;
      text.textContent = badge.label;
      el.appendChild(text);
    });
    el.appendChild(img);
  } else {
    const text = document.createElement('span');
    text.className = `${className}-text`;
    text.textContent = badge.label;
    el.appendChild(text);
  }

  return el;
}

function badgesForUsername(username) {
  const ids = userBadgesByUsernameLower.get(normalizeUsername(username)) || [];
  return ids.map((id) => badgeDefinitions.get(id)).filter(Boolean);
}

function normalizeBadgeImagePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('./')) return raw;
  if (raw.startsWith('/')) return `.${raw}`;
  return `./${raw}`;
}

function normalizeBadgeConfig(rawConfig) {
  const defs = new Map();
  const userMap = new Map();
  const badges = Array.isArray(rawConfig?.badges) ? rawConfig.badges : [];
  const assignments = rawConfig?.users && typeof rawConfig.users === 'object' ? rawConfig.users : {};

  badges.forEach((item) => {
    const id = normalizeUsername(item?.id);
    if (!id) return;
    defs.set(id, {
      id,
      label: String(item?.label || id).trim(),
      image: normalizeBadgeImagePath(item?.image || ''),
      title: String(item?.title || item?.label || id).trim()
    });
  });

  Object.entries(assignments).forEach(([username, badgeIds]) => {
    const normalizedUser = normalizeUsername(username);
    if (!normalizedUser || !Array.isArray(badgeIds)) return;
    const normalizedIds = badgeIds
      .map((id) => normalizeUsername(id))
      .filter((id) => defs.has(id));
    if (normalizedIds.length) {
      userMap.set(normalizedUser, normalizedIds);
    }
  });

  badgeDefinitions = defs;
  userBadgesByUsernameLower = userMap;
}

async function ensureBadgeConfigLoaded() {
  if (badgeDefinitions.size > 0 || userBadgesByUsernameLower.size > 0) return;
  try {
    normalizeBadgeConfig(embeddedBadgeConfig || {});
  } catch {
    // Keep default empty config when badge metadata cannot be loaded.
  }
}

// Tab switching
window.switchTab = function switchTab(name, e) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name !== 'profile') {
    resetGlobalBarColor();
    resetGlobalBackground();
    const url = new URL(window.location.href);
    url.searchParams.delete('profile');
    history.replaceState({}, '', url);
  }
  if (e && e.target) {
    e.target.classList.add('active');
  } else {
    const tabButton = document.querySelector(`.tab[data-tab="${name}"]`);
    if (tabButton) tabButton.classList.add('active');
  }
  if (name === 'chat') {
    if (window.openChatTab) {
      window.openChatTab();
    } else {
      window._chatTabPending = true;
    }
  }
  if (name === 'users') {
    if (window.openUsersTab) {
      window.openUsersTab();
    } else {
      window._usersTabPending = true;
    }
  }
  if (name === 'profile' && window.openProfileTab) {
    window.openProfileTab();
  }
  if (name === 'games') window.onGamesTabVisible?.();
};

window.closeCreditsModal = function closeCreditsModal() {
  const modal = document.getElementById('game-credits-modal');
  if (modal) modal.style.display = 'none';
};

window.closeUsernameModal = function closeUsernameModal() {
  const modal = document.getElementById('username-modal');
  if (modal) modal.style.display = 'none';
  const errorEl = document.getElementById('username-error');
  if (errorEl) errorEl.textContent = '';
};

// Users/Auth functions
function setUsersMessage(text, isError = false) {
  const el = document.getElementById('users-auth-message');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('users-auth-message-error', isError);
}

function setUsersAuthUI(isLoggedIn) {
  const forms = document.getElementById('users-auth-forms');
  const loggedIn = document.getElementById('users-auth-logged-in');
  const settings = document.getElementById('users-settings');
  
  if (forms) forms.style.display = isLoggedIn ? 'none' : 'block';
  if (loggedIn) loggedIn.style.display = isLoggedIn ? 'block' : 'none';
  if (settings && !isLoggedIn) settings.style.display = 'none';
}

async function refreshFirestoreAdminStatus() {
  if (!currentAccount?.uid) {
    currentUserIsFirestoreAdmin = false;
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', currentAccount.uid));
    const adminData = adminSnap.exists() ? adminSnap.data() : null;
    currentUserIsFirestoreAdmin = adminData?.admin === true;
  } catch {
    currentUserIsFirestoreAdmin = false;
  }

  currentUserCanModerateChat = currentUserIsFirestoreAdmin;
}

function chatTimeoutLabel(untilMs) {
  return new Date(untilMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isCurrentUserTimedOut() {
  return currentTimeoutUntilMs > Date.now();
}

function updateChatInputState() {
  const input = document.getElementById('chat-msg-input');
  const btn = document.querySelector('.chat-footer .win-btn');
  if (!input || !btn) return;

  const defaultPlaceholder = input.dataset.defaultPlaceholder || input.placeholder || 'type a message...';
  input.dataset.defaultPlaceholder = defaultPlaceholder;

  if (isCurrentUserTimedOut()) {
    input.disabled = true;
    btn.disabled = true;
    input.placeholder = `timed out until ${chatTimeoutLabel(currentTimeoutUntilMs)}`;
    return;
  }

  if (input.dataset.cooldownActive === '1') return;

  input.disabled = false;
  btn.disabled = false;
  input.placeholder = defaultPlaceholder;
}

async function updateChatLinkUI() {
  const linkStatus = document.getElementById('chat-link-status');
  const linkBtn = document.getElementById('chat-link-btn');
  if (!linkStatus || !linkBtn) return;

  if (!currentUser) {
    linkStatus.textContent = '';
    linkBtn.style.display = 'none';
    return;
  }

  if (!currentAccount) {
    linkStatus.textContent = '[ not linked ]';
    linkBtn.style.display = 'inline-block';
    return;
  }

  try {
    const nameRef = doc(db, 'usernames', currentUser.toLowerCase());
    const snap = await getDoc(nameRef);
    const linkedUid = snap.exists() ? snap.data().authUid : null;
    const isLinked = linkedUid === currentAccount.uid;

    if (isLinked) {
      linkStatus.textContent = '[ linked to account ]';
      linkBtn.style.display = 'none';
    } else {
      linkStatus.textContent = '[ not linked ]';
      linkBtn.style.display = 'inline-block';
    }
  } catch {
    linkStatus.textContent = '[ link status unavailable ]';
    linkBtn.style.display = 'inline-block';
  }
}

function setProfileStatus(text, isError = false) {
  const statusEl = document.getElementById('profile-status');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.classList.toggle('users-auth-message-error', isError);
}

function renderProfileView(profile) {
  // 1. Primary Containers
  const view = document.getElementById('profile-view');
  const links = document.getElementById('profile-links');
  const songWrap = document.getElementById('profile-song-player-wrap');
  
  // 2. Players & Skins
  const songPlayer = document.getElementById('profile-song-player'); // Youtube iframe
  const audioPlayer = document.getElementById('profile-audio-player'); // Hidden audio tag
  const retroSkin = document.getElementById('retro-audio-skin'); // The visual Win95/XP UI
  const statusText = document.getElementById('audio-status-text');
  const audioPlayBtn = document.getElementById('profile-audio-play-btn');
  const audioStopBtn = document.getElementById('profile-audio-stop-btn');
  const audioSongName = document.getElementById('audio-song-name');
  const audioArtistName = document.getElementById('audio-artist-name');
  const audioTimeCurrent = document.getElementById('audio-time-current');
  const audioTimeDuration = document.getElementById('audio-time-duration');
  const audioTimestampStart = document.getElementById('audio-timestamp-start');
  const audioTimestampEnd = document.getElementById('audio-timestamp-end');
  const audioProgressFill = document.getElementById('audio-progress-fill');

  // 3. Profile Info Elements
  const avatar = document.getElementById('profile-avatar-view');
  const avatarFallback = document.getElementById('profile-avatar-fallback');
  const badgesWrap = document.getElementById('profile-badges-view');
  const imageNote = document.getElementById('profile-image-note-view');
  const displayNameEl = document.getElementById('profile-display-name-view');
  const usernameEl = document.getElementById('profile-username-view');
  const pronounsEl = document.getElementById('profile-pronouns-view');
  const bioEl = document.getElementById('profile-bio-view');
  const profileButtonsWrap = document.getElementById('profile-buttons-view');

  // Validation Check
  if (!view || !links || !songWrap || !songPlayer || !avatar || !avatarFallback) return;
  const card = view.querySelector('.profile-card');

  const theme = profileThemeFromData(profile);
  applyGlobalThemeFromProfile(profile);

  if (card) {
    card.style.setProperty('--profile-accent', theme.colors.accent);
    card.style.setProperty('--profile-bg-start', theme.colors.bgStart);
    card.style.setProperty('--profile-bg-end', theme.colors.bgEnd);
    card.style.setProperty('--profile-text', theme.colors.text);
    card.style.setProperty('--profile-text-muted', theme.colors.textMuted);
    card.style.setProperty('--profile-panel-bg', theme.colors.panelBg);
  }

  // Set Profile Identity
  currentProfileUsername = profile.username;
  if (displayNameEl) displayNameEl.textContent = profile.displayName;
  if (usernameEl) usernameEl.textContent = `@${profile.username}`;
  if (pronounsEl) pronounsEl.textContent = profile.pronouns ? `[ ${profile.pronouns} ]` : '';
  if (bioEl) bioEl.textContent = profile.bio || 'No bio yet.';
  if (profileButtonsWrap) {
    profileButtonsWrap.innerHTML = '';
    if (profile.profileButtons.length) {
      profileButtonsWrap.style.display = 'flex';
      profile.profileButtons.forEach((assetPath) => {
        const item = document.createElement('span');
        item.className = 'profile-button-item';
        const image = document.createElement('img');
        image.className = 'profile-button-image';
        image.src = assetPath;
        image.alt = labelFromButtonPath(assetPath);
        image.loading = 'lazy';
        item.appendChild(image);
        profileButtonsWrap.appendChild(item);
      });
    } else {
      profileButtonsWrap.style.display = 'none';
    }
  }

  // Handle Avatar
  if (profile.profileImageUrl) {
    avatar.src = profile.profileImageUrl;
    avatar.style.display = 'block';
    avatarFallback.style.display = 'none';
    avatar.onerror = () => {
      avatar.style.display = 'none';
      avatarFallback.style.display = 'flex';
    };
  } else {
    avatar.style.display = 'none';
    avatarFallback.style.display = 'flex';
    avatarFallback.textContent = initialsForProfile(profile);
  }

  // Handle Badges & Notes
  if (badgesWrap) {
    badgesWrap.innerHTML = '';
    badgesForUsername(profile.username).forEach(badge => {
      badgesWrap.appendChild(buildBadgeElement(badge, 'profile-badge'));
    });
  }
  if (imageNote) {
    const hint = profileImageHintFromStatus(profile);
    imageNote.textContent = hint;
    imageNote.style.display = hint ? 'block' : 'none';
  }

  // --- AUDIO / VIDEO PLAYER LOGIC ---
  links.innerHTML = '';
  const songUrl = (profile.songUrl || '').trim();
  const songEmbed = youtubeEmbedUrl(songUrl);
  const isAudioFile = /\.(mp3|wav|ogg|m4a|flac)$/i.test(songUrl.split(/[#?]/)[0]);

  // Clean slate for players
  songPlayer.style.display = 'none';
  songPlayer.removeAttribute('src');
  if (audioPlayer) {
    audioPlayer.pause();
    audioPlayer.style.display = 'none';
    audioPlayer.removeAttribute('src');
  }
  if (retroSkin) retroSkin.style.display = 'none';
  if (statusText) statusText.innerText = 'STOPPED';
  if (audioPlayBtn) audioPlayBtn.disabled = true;
  if (audioStopBtn) audioStopBtn.disabled = true;
  if (audioSongName) audioSongName.textContent = 'Unknown Track';
  if (audioArtistName) audioArtistName.textContent = profile.displayName || `@${profile.username}`;
  if (audioTimeCurrent) audioTimeCurrent.textContent = '0:00';
  if (audioTimeDuration) audioTimeDuration.textContent = '0:00';
  if (audioTimestampStart) audioTimestampStart.textContent = '00:00';
  if (audioTimestampEnd) audioTimestampEnd.textContent = '00:00';
  if (audioProgressFill) audioProgressFill.style.width = '0%';

  const updateAudioTimeline = () => {
    if (!audioPlayer) return;
    const current = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
    const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
    const percent = duration > 0 ? Math.min((current / duration) * 100, 100) : 0;
    if (audioTimeCurrent) audioTimeCurrent.textContent = formatAudioTime(current);
    if (audioTimeDuration) audioTimeDuration.textContent = formatAudioTime(duration);
    if (audioTimestampStart) audioTimestampStart.textContent = '00:00';
    if (audioTimestampEnd) audioTimestampEnd.textContent = formatAudioTime(duration);
    if (audioProgressFill) audioProgressFill.style.width = `${percent}%`;
  };

  if (audioPlayer) {
    audioPlayer.onplay = () => { if (statusText) statusText.innerText = 'PLAYING...'; };
    audioPlayer.onended = () => { if (statusText) statusText.innerText = 'ENDED'; };
    audioPlayer.onpause = () => {
      if (!statusText) return;
      statusText.innerText = audioPlayer.currentTime > 0 && !audioPlayer.ended ? 'PAUSED' : 'STOPPED';
    };
    audioPlayer.onwaiting = () => { if (statusText) statusText.innerText = 'BUFFERING...'; };
    audioPlayer.ontimeupdate = updateAudioTimeline;
    audioPlayer.onloadedmetadata = updateAudioTimeline;
    audioPlayer.ondurationchange = updateAudioTimeline;
  }

  // Build Profile Link
  const profileLink = document.createElement('a');
  profileLink.className = 'profile-link-btn';
  profileLink.href = `?profile=${encodeURIComponent(profile.username)}#profile`;
  profileLink.textContent = `@${profile.username}`;
  profileLink.onclick = (e) => { e.preventDefault(); setProfileQuery(profile.username); };
  links.appendChild(profileLink);

  if (songEmbed) {
    // YouTube Path
    const songLink = document.createElement('a');
    songLink.className = 'profile-link-btn';
    songLink.href = songUrl;
    songLink.target = '_blank';
    songLink.textContent = 'Background song (YouTube)';
    links.appendChild(songLink);

    songPlayer.src = songEmbed;
    songPlayer.style.display = 'block';
    songWrap.style.display = 'block';

  } else if (isAudioFile) {
    // Direct Audio Path (Retro Skin)
    const songLink = document.createElement('a');
    songLink.className = 'profile-link-btn';
    songLink.href = songUrl;
    songLink.target = '_blank';
    songLink.textContent = 'Background song (Audio File)';
    links.appendChild(songLink);

    if (audioPlayer) {
      const trackName = String(profile.songTitle || '').trim() || 'Unknown Track';
      const artistName = String(profile.songArtist || '').trim() || profile.displayName || `@${profile.username}`;
      if (audioSongName) audioSongName.textContent = trackName;
      if (audioArtistName) audioArtistName.textContent = artistName;

      audioPlayer.src = songUrl;
      audioPlayer.load();
      if (retroSkin) retroSkin.style.display = 'block';
      if (audioPlayBtn) {
        audioPlayBtn.disabled = false;
        audioPlayBtn.onclick = () => {
          audioPlayer.play().catch(err => {
            console.log("Autoplay blocked:", err);
            if (statusText) statusText.innerText = 'PAUSED';
          });
        };
      }
      if (audioStopBtn) {
        audioStopBtn.disabled = false;
        audioStopBtn.onclick = () => {
          audioPlayer.pause();
          audioPlayer.currentTime = 0;
          if (statusText) statusText.innerText = 'STOPPED';
          updateAudioTimeline();
        };
      }
      if (statusText) statusText.innerText = 'LOADING...';
      updateAudioTimeline();
      
      audioPlayer.play().catch(err => {
        console.log("Autoplay blocked:", err);
        if (statusText) statusText.innerText = 'PAUSED';
      });
    }
    songWrap.style.display = 'block';

  } else {
    // No Song
    songWrap.style.display = 'none';
  }

  view.style.display = 'block';
  setProfileStatus('');
}

async function loadProfileByUsername(username) {
  const normalized = normalizeUsername(username);
  if (!normalized) {
    setProfileStatus('Profile username is missing.', true);
    return;
  }

  const existing = usersByUsernameLower.get(normalized);
  if (existing) {
    currentProfileUsername = existing.username;
    renderProfileView(existing);
    setProfileQuery(existing.username);
    return;
  }

  const status = document.getElementById('profile-status');
  if (status) status.textContent = 'Loading profile...';

  try {
    const profileQuery = query(collection(db, 'accounts'), where('usernameLower', '==', normalized), limit(1));
    const snap = await getDocs(profileQuery);
    if (snap.empty) {
      const view = document.getElementById('profile-view');
      if (view) view.style.display = 'none';
      setProfileStatus('Profile not found.', true);
      currentProfileUsername = '';
      setProfileQuery('');
      resetGlobalBarColor();
      resetGlobalBackground();
      return;
    }

    const profile = profileFromAccountData(snap.docs[0].data());
    usersByUsernameLower.set(profile.usernameLower, profile);
    currentProfileUsername = profile.username;
    renderProfileView(profile);
    setProfileQuery(profile.username);
  } catch {
    const view = document.getElementById('profile-view');
    if (view) view.style.display = 'none';
    setProfileStatus('Could not load profile.', true);
    currentProfileUsername = '';
    setProfileQuery('');
    resetGlobalBarColor();
    resetGlobalBackground();
  }
}

function fillProfileSettings(profile) {
  const displayName = document.getElementById('profile-display-name');
  const pronouns = document.getElementById('profile-pronouns');
  const songUrl = document.getElementById('profile-song-url');
  const songTitle = document.getElementById('profile-song-title');
  const songArtist = document.getElementById('profile-song-artist');
  const imageUrl = document.getElementById('profile-image-url');
  const imageStatus = document.getElementById('profile-image-request-status');
  const bio = document.getElementById('profile-bio');
  const themePreset = document.getElementById('profile-theme-preset');
  const theme = profileThemeFromData(profile);
  
  if (displayName) displayName.value = profile.displayName || '';
  if (pronouns) pronouns.value = profile.pronouns || '';
  if (songUrl) songUrl.value = profile.songUrl || '';
  if (songTitle) songTitle.value = profile.songTitle || '';
  if (songArtist) songArtist.value = profile.songArtist || '';
  if (imageUrl) imageUrl.value = profile.profileImageRequestedUrl || profile.profileImageUrl || '';
  if (imageStatus) imageStatus.textContent = profileImageHintFromStatus(profile);
  if (bio) bio.value = profile.bio || '';
  if (themePreset) themePreset.value = theme.preset;
  setThemeInputValues(theme.colors);
  renderProfileButtonPicker(profile.profileButtons || []);
}

window.applyProfileThemePreset = function () {
  const preset = normalizeThemePreset(document.getElementById('profile-theme-preset')?.value);
  setThemeInputValues(PROFILE_THEME_PRESETS[preset]);
};

window.resetProfileThemeColors = function () {
  const preset = normalizeThemePreset(document.getElementById('profile-theme-preset')?.value);
  setThemeInputValues(PROFILE_THEME_PRESETS[preset]);
};

function renderUsersList(docs) {
  latestUsersListDocs = docs;
  const list = document.getElementById('users-list');
  const status = document.getElementById('users-list-status');
  usersByUsernameLower = new Map();

  if (!list || !status) return;

  if (!docs.length) {
    list.innerHTML = '';
    status.textContent = 'No registered users yet.';
    return;
  }

  status.textContent = `${docs.length} registered user${docs.length === 1 ? '' : 's'}`;
  list.innerHTML = '';

  docs.forEach((d, i) => {
    const profile = profileFromAccountData(d.data());
    usersByUsernameLower.set(profile.usernameLower, profile);

    const row = document.createElement('div');
    row.className = 'users-list-item';

    const rank = document.createElement('span');
    rank.className = 'users-list-rank';
    rank.textContent = `${i + 1}.`;

    const link = document.createElement('a');
    link.className = 'users-list-link';
    link.href = `?profile=${encodeURIComponent(profile.username)}#profile`;
    link.textContent = profile.displayName;
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      window.switchTab('profile');
      await loadProfileByUsername(profile.username);
    });

    const badges = badgesForUsername(profile.username);
    row.appendChild(rank);
    row.appendChild(link);

    if (badges.length) {
      const badgesWrap = document.createElement('span');
      badgesWrap.className = 'users-list-badges';
      badges.forEach((badge) => {
        badgesWrap.appendChild(buildBadgeElement(badge, 'users-list-badge'));
      });
      row.appendChild(badgesWrap);
    }

    list.appendChild(row);
  });
}

function startUsersListListener() {
  if (usersListStarted) return;
  usersListStarted = true;

  const q = query(collection(db, 'accounts'), orderBy('createdAt', 'desc'), limit(200));
  onSnapshot(q, snap => {
    const docs = [];
    snap.forEach(d => docs.push(d));
    renderUsersList(docs);
  }, () => {
    const status = document.getElementById('users-list-status');
    if (status) status.textContent = 'Could not load users list.';
  });
}

// Chat functions
function startSendCooldown() {
  const input = document.getElementById('chat-msg-input');
  const btn = document.querySelector('.chat-footer .win-btn');
  if (!input || !btn) return;
  
  const original = input.dataset.defaultPlaceholder || input.placeholder;
  input.dataset.defaultPlaceholder = original;

  input.dataset.cooldownActive = '1';
  input.disabled = true;
  btn.disabled = true;

  let remaining = 5;
  input.placeholder = `wait ${remaining}s before sending...`;

  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      input.dataset.cooldownActive = '0';
      updateChatInputState();
    } else {
      input.placeholder = `wait ${remaining}s before sending...`;
    }
  }, 1000);
}

let badWordMatchers = [];

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildBadWordMatcher(entry) {
  const normalized = entry.normalize('NFKC').trim().toLowerCase();
  if (!normalized) return null;

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (!tokens.length) return null;

  const phrasePattern = tokens.map(escapeRegex).join('[\\s\\p{P}\\p{S}_]*');
  return new RegExp(`(?<![\\p{L}\\p{N}])${phrasePattern}(?![\\p{L}\\p{N}])`, 'giu');
}

fetch('./assets/badwords.txt')
  .then(r => r.text())
  .then(t => {
    badWordMatchers = t
      .split(/\r?\n/u)
      .map(buildBadWordMatcher)
      .filter(Boolean);
  })
  .catch(() => {
    badWordMatchers = [];
  });

function filterText(text) {
  let filtered = text.normalize('NFKC');
  for (const regex of badWordMatchers) {
    filtered = filtered.replace(regex, m => '*'.repeat(Array.from(m).length));
  }
  return filtered;
}

function containsBlockedWord(text) {
  const candidate = String(text || '').normalize('NFKC');
  for (const regex of badWordMatchers) {
    regex.lastIndex = 0;
    if (regex.test(candidate)) return true;
  }
  return false;
}

function startListener() {
  const q = query(collection(db, 'messages'), orderBy('time', 'desc'), limit(100));
  onSnapshot(q, (snap) => {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = '';
    const docs = [];
    snap.forEach(d => docs.push(d));
    docs.reverse();
    docs.forEach((d) => {
      try {
        renderMessage(d);
      } catch {
        // Skip malformed documents
      }
    });
    box.scrollTop = box.scrollHeight;
  }, () => {
    const box = document.getElementById('chat-messages');
    if (box && !box.dataset.listenerErrorShown) {
      box.dataset.listenerErrorShown = '1';
      box.innerHTML = '<div class="msg-time">chat connection failed. reload to retry.</div>';
    }
  });
}

function renderMessage(docSnap) {
  const data = docSnap.data();
  const isMine = data.uid === uid;
  const canDelete = isMine || currentUserCanModerateChat;
  const username = String(data.user || '').trim() || 'user';
  const badges = badgesForUsername(username);
  const time = data.time?.toDate
    ? data.time.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const el = document.createElement('div');
  el.className = 'chat-msg' + (isMine ? ' chat-msg-mine' : '');

  const userMeta = document.createElement('span');
  userMeta.className = 'msg-user-meta';

  const userEl = document.createElement('span');
  userEl.className = 'msg-user';
  userEl.textContent = username;
  userMeta.appendChild(userEl);

  if (badges.length) {
    const badgesWrap = document.createElement('span');
    badgesWrap.className = 'msg-badges';
    badges.forEach((badge) => {
      badgesWrap.appendChild(buildBadgeElement(badge, 'chat-badge'));
    });
    userMeta.appendChild(badgesWrap);
  }

  const timeEl = document.createElement('span');
  timeEl.className = 'msg-time';
  timeEl.textContent = time;

  const textEl = document.createElement('span');
  textEl.className = 'msg-text';
  textEl.textContent = String(data.text || '');

  el.appendChild(userMeta);
  el.appendChild(timeEl);
  el.appendChild(textEl);

  if (canDelete) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-del';
    delBtn.title = 'delete';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      window.deleteMsg(docSnap.id, String(data.uid || ''));
    });
    el.appendChild(delBtn);
  }

  const box = document.getElementById('chat-messages');
  if (box) box.appendChild(el);
}

async function applyTimeoutToUid(uidToTimeout, targetUserLabel = 'user') {
  const untilPrompt = window.prompt(`Timeout ${targetUserLabel} for how many minutes?`, '10');
  if (untilPrompt === null) return;

  const minutes = Number.parseInt(untilPrompt, 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    window.alert('Enter a number of minutes between 1 and 1440.');
    return;
  }

  const untilMs = Date.now() + (minutes * 60 * 1000);
  await setDoc(doc(db, 'chatTimeouts', uidToTimeout), {
    uid: uidToTimeout,
    username: String(targetUserLabel || '').trim(),
    untilMs,
    byUid: uid,
    byUser: currentUser || '',
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function showChatUI() {
  await ensureBadgeConfigLoaded();
  await refreshFirestoreAdminStatus();
  
  const chatUI = document.getElementById('chat-ui');
  const userLabel = document.getElementById('chat-user-label');
  const timeoutBtn = document.getElementById('chat-timeout-btn');
  
  if (chatUI) chatUI.style.display = 'block';
  if (userLabel) userLabel.textContent = '[ logged in as: ' + currentUser + ' ]';
  if (timeoutBtn) {
    timeoutBtn.style.display = currentUserCanModerateChat ? '' : 'none';
  }
  
  if (!chatTimeoutUnsubscribe) {
    try {
      chatTimeoutUnsubscribe = onSnapshot(
        doc(db, 'chatTimeouts', uid),
        (snap) => {
          const timeoutData = snap.exists() ? snap.data() : {};
          currentTimeoutUntilMs = Number(timeoutData?.untilMs || 0);
          updateChatInputState();
        },
        () => {
          currentTimeoutUntilMs = 0;
          updateChatInputState();
        }
      );
    } catch {
      currentTimeoutUntilMs = 0;
    }
  }
  updateChatInputState();
  updateChatLinkUI();
  if (!chatStarted) {
    startListener();
    chatStarted = true;
  }
}

// Public API

// Timeout any user (guest or registered) by username
window.timeoutUserByName = async function () {
  if (!currentUserCanModerateChat) return;
  const username = prompt('Enter the username to timeout (case-sensitive):');
  if (!username) return;
  const normalized = normalizeUsername(username);
  try {
    // Try usernames collection first
    const nameRef = doc(db, 'usernames', normalized);
    const snap = await getDoc(nameRef);
    let targetUid = snap.exists() ? snap.data().uid : null;
    if (!targetUid) {
      // If not found, search recent chat messages for the username
      const q = query(collection(db, 'messages'), orderBy('time', 'desc'), limit(100));
      const msgSnap = await getDocs(q);
      let found = false;
      msgSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (normalizeUsername(data.user) === normalized && data.uid) {
          targetUid = data.uid;
          found = true;
        }
      });
      if (!found) {
        alert('That user is not currently active in chat.');
        return;
      }
    }
    await applyTimeoutToUid(targetUid, username);
    alert(`User '${username}' has been timed out.`);
  } catch (e) {
    alert('Failed to timeout user: ' + (e && e.message ? e.message : e));
  }
};
window.openChatTab = async function () {
  const saved = localStorage.getItem('wl_username');
  if (saved) {
    if (containsBlockedWord(saved)) {
      localStorage.removeItem('wl_username');
    } else {
      const nameRef = doc(db, 'usernames', saved.toLowerCase());
      const snap = await getDoc(nameRef);
      const canClaimByLink = snap.exists() && currentAccount && snap.data().authUid === currentAccount.uid;
      if (!snap.exists() || snap.data().uid === uid || canClaimByLink) {
        const payload = { uid, name: saved };
        if (currentAccount) payload.authUid = currentAccount.uid;
        await setDoc(nameRef, payload, { merge: true });
        currentUser = saved;
        await showChatUI();
        return;
      } else {
        localStorage.removeItem('wl_username');
      }
    }
  }
  const modal = document.getElementById('username-modal');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('username-input')?.focus(), 50);
  }
};

window.joinChat = async function () {
  const name = document.getElementById('username-input')?.value.trim();
  const errorEl = document.getElementById('username-error');
  if (!name) return;
  if (containsBlockedWord(name)) {
    if (errorEl) errorEl.textContent = '✕ that name contains blocked words.';
    return;
  }

  const nameRef = doc(db, 'usernames', name.toLowerCase());
  const snap = await getDoc(nameRef);

  const canClaimByLink = snap.exists() && currentAccount && snap.data().authUid === currentAccount.uid;
  if (snap.exists() && snap.data().uid !== uid && !canClaimByLink) {
    if (errorEl) errorEl.textContent = '✕ that name is taken, choose another.';
    return;
  }

  const payload = { uid, name };
  if (currentAccount) payload.authUid = currentAccount.uid;
  await setDoc(nameRef, payload, { merge: true });
  currentUser = name;
  localStorage.setItem('wl_username', name);
  
  const modal = document.getElementById('username-modal');
  if (modal) modal.style.display = 'none';
  if (errorEl) errorEl.textContent = '';
  await showChatUI();
};

window.sendMessage = async function () {
  const input = document.getElementById('chat-msg-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !currentUser || input.disabled) return;
  if (isCurrentUserTimedOut()) {
    updateChatInputState();
    return;
  }
  input.value = '';
  startSendCooldown();
  await addDoc(collection(db, 'messages'), {
    user: currentUser,
    uid,
    text: filterText(text),
    time: serverTimestamp()
  });
};

window.deleteMsg = async function (id, messageOwnerUid = '') {
  if (messageOwnerUid !== uid && !currentUserCanModerateChat) return;
  await deleteDoc(doc(db, 'messages', id));
};

window.changeUsername = async function () {
  if (currentUser) {
    const oldRef = doc(db, 'usernames', currentUser.toLowerCase());
    const oldSnap = await getDoc(oldRef);
    if (oldSnap.exists() && oldSnap.data().uid === uid) {
      await deleteDoc(oldRef);
    }
  }
  currentUser = null;
  currentTimeoutUntilMs = 0;
  if (chatTimeoutUnsubscribe) {
    chatTimeoutUnsubscribe();
    chatTimeoutUnsubscribe = null;
  }
  localStorage.removeItem('wl_username');
  
  const chatUI = document.getElementById('chat-ui');
  const linkStatus = document.getElementById('chat-link-status');
  const linkBtn = document.getElementById('chat-link-btn');
  const timeoutBtn = document.getElementById('chat-timeout-btn');
  const usernameInput = document.getElementById('username-input');
  const errorEl = document.getElementById('username-error');
  const modal = document.getElementById('username-modal');
  
  if (chatUI) chatUI.style.display = 'none';
  if (linkStatus) linkStatus.textContent = '';
  if (linkBtn) linkBtn.style.display = 'none';
  if (timeoutBtn) timeoutBtn.style.display = 'none';
  if (usernameInput) usernameInput.value = '';
  if (errorEl) errorEl.textContent = '';
  if (modal) modal.style.display = 'flex';
  
  setTimeout(() => document.getElementById('username-input')?.focus(), 50);
};

window.openUsersTab = function () {
  startUsersListListener();
  if (!currentAccount) {
    setTimeout(() => document.getElementById('users-register-name')?.focus(), 50);
  }
};

window.openProfileTab = function () {
  if (!currentProfileUsername) {
    resetGlobalBarColor();
    resetGlobalBackground();
    setProfileStatus('Select a user from the users list.');
    return;
  }

  const existing = usersByUsernameLower.get(normalizeUsername(currentProfileUsername));
  if (existing) {
    applyGlobalThemeFromProfile(existing);
    return;
  }

  void loadProfileByUsername(currentProfileUsername);
};

window.openProfileByUsername = async function (username) {
  window.switchTab('profile');
  await loadProfileByUsername(username);
};

window.openMyProfile = async function () {
  if (!currentAccount) {
    setUsersMessage('Log in to view your profile.', true);
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'accounts', currentAccount.uid));
    if (!snap.exists()) {
      setUsersMessage('Could not find your account profile.', true);
      return;
    }
    const profile = profileFromAccountData(snap.data());
    usersByUsernameLower.set(profile.usernameLower, profile);
    currentProfileUsername = profile.username;
    window.switchTab('profile');
    renderProfileView(profile);
    setProfileQuery(profile.username);
  } catch {
    setUsersMessage('Could not load your profile.', true);
  }
};

window.openProfileSettings = async function () {
  if (!currentAccount) {
    setUsersMessage('Log in to edit profile settings.', true);
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'accounts', currentAccount.uid));
    const profile = profileFromAccountData(snap.exists() ? snap.data() : {});
    fillProfileSettings(profile);
    const settings = document.getElementById('users-settings');
    if (settings) settings.style.display = 'block';
    setUsersMessage('');
  } catch {
    setUsersMessage('Could not open profile settings.', true);
  }
};

window.closeProfileSettings = function () {
  const settings = document.getElementById('users-settings');
  if (settings) settings.style.display = 'none';
};

window.saveProfileSettings = async function () {
  if (!currentAccount) {
    setUsersMessage('Log in to edit profile settings.', true);
    return;
  }

  const displayName = document.getElementById('profile-display-name')?.value.trim() || '';
  const pronouns = document.getElementById('profile-pronouns')?.value.trim() || '';
  const bio = document.getElementById('profile-bio')?.value.trim() || '';
  const songUrlInput = document.getElementById('profile-song-url')?.value.trim() || '';
  const songTitle = document.getElementById('profile-song-title')?.value.trim() || '';
  const songArtist = document.getElementById('profile-song-artist')?.value.trim() || '';
  const songUrl = normalizeSongUrl(songUrlInput);
  const profileImageInput = document.getElementById('profile-image-url')?.value.trim() || '';
  const requestedImageUrl = normalizeHttpUrl(profileImageInput);
  const profileThemePreset = normalizeThemePreset(document.getElementById('profile-theme-preset')?.value || 'classic');
  const profileThemeColors = readThemeInputValues(profileThemePreset);
  const profileButtons = Array.from(document.querySelectorAll('#profile-button-picker input[name="profile-button-asset"]:checked'))
    .map((input) => normalizeButtonAssetPath(input?.value || ''))
    .filter((value, index, arr) => profileButtonAssetSet.has(value) && arr.indexOf(value) === index)
    .slice(0, MAX_PROFILE_BUTTONS);

  if (songUrlInput && !songUrl) {
    setUsersMessage('Background song must be a valid YouTube or direct audio URL.', true);
    return;
  }

  if (profileImageInput && !requestedImageUrl) {
    setUsersMessage('Profile image must be a valid http(s) URL.', true);
    return;
  }
  if (displayName && containsBlockedWord(displayName)) {
    setUsersMessage('Display name contains blocked words.', true);
    return;
  }

  try {
    const accountRef = doc(db, 'accounts', currentAccount.uid);
    const snap = await getDoc(accountRef);
    const existing = snap.exists() ? snap.data() : {};
    const username = String(existing.username || '').trim();
    if (!username) {
      setUsersMessage('Your account is missing a username.', true);
      return;
    }

    const existingApprovedImage = normalizeHttpUrl(existing.profileImageUrl || '');
    const existingRequestedImage = normalizeHttpUrl(existing.profileImageRequestedUrl || '');
    let profileImageStatus = String(existing.profileImageStatus || '').trim().toLowerCase();
    let profileImageUrl = existingApprovedImage;
    let profileImageRequestedUrl = existingRequestedImage;
    let isNewImageRequest = false;

    if (requestedImageUrl) {
      if (requestedImageUrl === existingApprovedImage) {
        profileImageRequestedUrl = '';
        profileImageStatus = existingApprovedImage ? 'approved' : 'none';
      } else {
        profileImageRequestedUrl = requestedImageUrl;
        profileImageStatus = 'pending';
        isNewImageRequest = requestedImageUrl !== existingRequestedImage;
      }
    } else if (!existingApprovedImage) {
      profileImageRequestedUrl = '';
      profileImageStatus = 'none';
    }

    if (!profileImageUrl && profileImageStatus === 'approved') {
      profileImageStatus = 'none';
    }
    if (profileImageStatus === 'pending' && !profileImageRequestedUrl) {
      profileImageStatus = 'none';
    }

    const updatePayload = {
      uid: currentAccount.uid,
      username,
      usernameLower: normalizeUsername(username),
      displayName: displayName || username,
      pronouns,
      bio,
      songUrl,
      songTitle,
      songArtist,
      profileImageUrl,
      profileImageRequestedUrl,
      profileImageStatus,
      profileThemePreset,
      profileThemeColors,
      profileButtons,
      updatedAt: serverTimestamp()
    };

    if (isNewImageRequest) {
      updatePayload.profileImageRequestedAt = serverTimestamp();
    }

    await setDoc(accountRef, updatePayload, { merge: true });

    const profile = profileFromAccountData({
      ...existing,
      username,
      displayName: displayName || username,
      pronouns,
      bio,
      songUrl,
      songTitle,
      songArtist,
      profileImageUrl,
      profileImageRequestedUrl,
      profileImageStatus,
      profileThemePreset,
      profileThemeColors,
      profileButtons
    });
    usersByUsernameLower.set(profile.usernameLower, profile);

    if (currentProfileUsername && normalizeUsername(currentProfileUsername) === profile.usernameLower) {
      renderProfileView(profile);
    }

    if (isNewImageRequest) {
      setUsersMessage('Profile updated. Image request submitted for approval.');
    } else {
      setUsersMessage('Profile updated.');
    }
    
    const settings = document.getElementById('users-settings');
    if (settings) settings.style.display = 'none';
  } catch (err) {
    setUsersMessage(err?.message || 'Could not save profile settings.', true);
  }
};

window.registerUser = async function () {
  const username = document.getElementById('users-register-name')?.value.trim();
  const password = document.getElementById('users-register-password')?.value;
  const authEmail = authEmailForUsername(username);

  if (!username || username.length < 2) {
    setUsersMessage('Username must be at least 2 characters.', true);
    return;
  }
  if (!password || password.length < 6) {
    setUsersMessage('Password must be at least 6 characters.', true);
    return;
  }
  if (containsBlockedWord(username)) {
    setUsersMessage('Username contains blocked words.', true);
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, authEmail, password);
    await setDoc(doc(db, 'accounts', cred.user.uid), {
      uid: cred.user.uid,
      username,
      usernameLower: normalizeUsername(username),
      displayName: username,
      bio: '',
      pronouns: '',
      songUrl: '',
      songTitle: '',
      songArtist: '',
      profileImageUrl: '',
      profileImageRequestedUrl: '',
      profileImageStatus: 'none',
      profileThemePreset: 'classic',
      profileThemeColors: PROFILE_THEME_PRESETS.classic,
      profileButtons: [],
      createdAt: serverTimestamp()
    }, { merge: true });
    setUsersMessage('Account created. You are now logged in.');
    await updateChatLinkUI();
  } catch (err) {
    setUsersMessage(err?.message || 'Registration failed.', true);
  }
};

window.loginUser = async function () {
  const username = document.getElementById('users-register-name')?.value.trim();
  const password = document.getElementById('users-register-password')?.value;
  const authEmail = authEmailForUsername(username);

  if (!username || !password) {
    setUsersMessage('Enter your username and password to log in.', true);
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, authEmail, password);
    setUsersMessage('Logged in successfully.');
    await updateChatLinkUI();
  } catch (err) {
    setUsersMessage(err?.message || 'Login failed.', true);
  }
};

window.logoutUser = async function () {
  try {
    await signOut(auth);
    setUsersMessage('Logged out.');
    await updateChatLinkUI();
  } catch (err) {
    setUsersMessage(err?.message || 'Logout failed.', true);
  }
};

window.linkChatToAccount = async function () {
  if (!currentUser) {
    setUsersMessage('Pick a chat username first.', true);
    return;
  }
  if (!currentAccount) {
    const shouldCreate = window.confirm('You do not have a linked account yet. Create or log in to an account now?');
    if (shouldCreate) {
      window.switchTab('users');
      const usernameInput = document.getElementById('users-register-name');
      if (usernameInput && !usernameInput.value.trim()) {
        usernameInput.value = currentUser;
      }
      setUsersMessage('Create or log in to an account, then press [ LINK ACCOUNT ] again from chat.');
      setTimeout(() => document.getElementById('users-register-password')?.focus(), 50);
    } else {
      setUsersMessage('Log in from the users tab, then link your chat username.', true);
    }
    return;
  }

  try {
    const nameRef = doc(db, 'usernames', currentUser.toLowerCase());
    const snap = await getDoc(nameRef);
    if (!snap.exists()) {
      setUsersMessage('Chat username record not found.', true);
      return;
    }

    const data = snap.data();
    if (data.uid !== uid) {
      setUsersMessage('You can only link your own active chat username.', true);
      return;
    }

    await setDoc(nameRef, { authUid: currentAccount.uid }, { merge: true });
    setUsersMessage(`Linked chat username ${currentUser} to your account.`);
    await updateChatLinkUI();
  } catch (err) {
    setUsersMessage(err?.message || 'Could not link chat username.', true);
  }
};

window.timeoutUserByName = async function () {
  if (!currentUserCanModerateChat) return;
  const usernameInput = window.prompt('Enter the username to timeout:', '');
  if (usernameInput === null) return;

  const targetUsername = String(usernameInput || '').trim();
  const targetLower = normalizeUsername(targetUsername);
  if (!targetLower) return;

  const nameRef = doc(db, 'usernames', targetLower);
  const nameSnap = await getDoc(nameRef);
  if (!nameSnap.exists()) {
    window.alert('That username is not currently registered in chat.');
    return;
  }

  const targetUid = String(nameSnap.data()?.uid || '').trim();
  if (!targetUid) {
    window.alert('Could not find a UID for that username.');
    return;
  }
  if (targetUid === uid) {
    window.alert('You cannot timeout yourself.');
    return;
  }

  await applyTimeoutToUid(targetUid, targetUsername);
};

// Auth state listener
onAuthStateChanged(auth, async user => {
  currentAccount = user || null;
  const statusEl = document.getElementById('users-auth-status');
  const helloEl = document.getElementById('users-auth-hello');

  if (!statusEl || !helloEl) return;

  if (!user) {
    currentUserIsFirestoreAdmin = false;
    currentUserCanModerateChat = false;
    statusEl.textContent = 'Not logged in.';
    helloEl.textContent = '';
    setUsersAuthUI(false);
    if (currentUser) {
      const timeoutBtn = document.getElementById('chat-timeout-btn');
      if (timeoutBtn) timeoutBtn.style.display = 'none';
    }
    await updateChatLinkUI();
    return;
  }

  const accountRef = doc(db, 'accounts', user.uid);
  const snap = await getDoc(accountRef);
  const data = snap.exists() ? snap.data() : {};
  const username = String(data.username || user.email || 'user').trim();
  const usernameLower = normalizeUsername(data.usernameLower || username);
  const displayName = String(data.displayName || username).trim();

  if (data.username && (!data.usernameLower || !data.displayName)) {
    await setDoc(accountRef, {
      usernameLower,
      displayName
    }, { merge: true });
  }

  statusEl.textContent = `Logged in as ${displayName}`;
  helloEl.textContent = `Welcome back, ${displayName}.`;
  setUsersAuthUI(true);
  await refreshFirestoreAdminStatus();
  if (currentUser) {
    await showChatUI();
  }
  await updateChatLinkUI();
});

// Initialize badge config and handle initial profile route
async function applyInitialProfileRoute() {
  const params = new URLSearchParams(window.location.search);
  const username = params.get('profile');
  if (!username) return;
  window.switchTab('profile');
  await loadProfileByUsername(username);
}

ensureBadgeConfigLoaded().then(() => {
  if (latestUsersListDocs.length) {
    renderUsersList(latestUsersListDocs);
  }
  if (currentProfileUsername) {
    const profile = usersByUsernameLower.get(normalizeUsername(currentProfileUsername));
    if (profile) {
      renderProfileView(profile);
    }
  }
});

applyInitialProfileRoute();

// Handle pending tab loads
if (window._chatTabPending) {
  window._chatTabPending = false;
  window.openChatTab();
}
if (window._usersTabPending) {
  window._usersTabPending = false;
  window.openUsersTab();
}
