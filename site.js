import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot,
         query, orderBy, limit, deleteDoc, doc, 
         serverTimestamp, getDoc, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

window._chatTabPending = false;
window._usersTabPending = false;

window.switchTab = function switchTab(name, e) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    if (e && e.target) e.target.classList.add('active');
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
    if (name === 'games') window.onGamesTabVisible?.();
};

window.closeCreditsModal = function closeCreditsModal() {
    document.getElementById('game-credits-modal').style.display = 'none';
};

window.closeUsernameModal = function closeUsernameModal() {
  document.getElementById('username-modal').style.display = 'none';
  document.getElementById('username-error').textContent = '';
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db  = getFirestore(app);

let uid = localStorage.getItem('wl_uid');
if (!uid) { uid = crypto.randomUUID(); localStorage.setItem('wl_uid', uid); }

let currentUser = null;
let chatStarted = false;
let currentAccount = null;
let usersListStarted = false;

function setUsersMessage(text, isError = false) {
  const el = document.getElementById('users-auth-message');
  el.textContent = text || '';
  el.classList.toggle('users-auth-message-error', isError);
}

function setUsersAuthUI(isLoggedIn) {
  document.getElementById('users-auth-forms').style.display = isLoggedIn ? 'none' : 'block';
  document.getElementById('users-auth-logged-in').style.display = isLoggedIn ? 'block' : 'none';
}

function authEmailForUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  const hex = Array.from(normalized)
    .map(ch => ch.codePointAt(0).toString(16).padStart(4, '0'))
    .join('');
  return `u${hex}@users.wavelength.local`;
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

function renderUsersList(docs) {
  const list = document.getElementById('users-list');
  const status = document.getElementById('users-list-status');

  if (!docs.length) {
    list.innerHTML = '';
    status.textContent = 'No registered users yet.';
    return;
  }

  status.textContent = `${docs.length} registered user${docs.length === 1 ? '' : 's'}`;
  list.innerHTML = docs.map((d, i) => {
    const data = d.data();
    const name = esc(data.username || 'unknown');
    return `<div class="users-list-item"><span class="users-list-rank">${i + 1}.</span> <span class="users-list-name">${name}</span></div>`;
  }).join('');
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
    document.getElementById('users-list-status').textContent = 'Could not load users list.';
  });
}

window.openUsersTab = function () {
  startUsersListListener();
  if (!currentAccount) {
    setTimeout(() => document.getElementById('users-register-name')?.focus(), 50);
  }
};

window.registerUser = async function () {
  const username = document.getElementById('users-register-name').value.trim();
  const password = document.getElementById('users-register-password').value;
  const authEmail = authEmailForUsername(username);

  if (!username || username.length < 2) {
    setUsersMessage('Username must be at least 2 characters.', true);
    return;
  }
  if (!password || password.length < 6) {
    setUsersMessage('Password must be at least 6 characters.', true);
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, authEmail, password);
    await setDoc(doc(db, 'accounts', cred.user.uid), {
      uid: cred.user.uid,
      username,
      createdAt: serverTimestamp()
    }, { merge: true });
    setUsersMessage('Account created. You are now logged in.');
    await updateChatLinkUI();
  } catch (err) {
    setUsersMessage(err?.message || 'Registration failed.', true);
  }
};

window.loginUser = async function () {
  const username = document.getElementById('users-register-name').value.trim();
  const password = document.getElementById('users-register-password').value;
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
      switchTab('users');
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

onAuthStateChanged(auth, async user => {
  currentAccount = user || null;
  const statusEl = document.getElementById('users-auth-status');
  const helloEl = document.getElementById('users-auth-hello');

  if (!statusEl || !helloEl) return;

  if (!user) {
    statusEl.textContent = 'Not logged in.';
    helloEl.textContent = '';
    setUsersAuthUI(false);
    await updateChatLinkUI();
    return;
  }

  const accountRef = doc(db, 'accounts', user.uid);
  const snap = await getDoc(accountRef);
  const data = snap.exists() ? snap.data() : {};
  const username = data.username || user.email || 'user';

  statusEl.textContent = `Logged in as ${username}`;
  helloEl.textContent = `Welcome back, ${username}.`;
  setUsersAuthUI(true);
  await updateChatLinkUI();
});

window.openChatTab = async function () {
  const saved = localStorage.getItem('wl_username');
  if (saved) {
    const nameRef = doc(db, 'usernames', saved.toLowerCase());
    const snap = await getDoc(nameRef);
    const canClaimByLink = snap.exists() && currentAccount && snap.data().authUid === currentAccount.uid;
    if (!snap.exists() || snap.data().uid === uid || canClaimByLink) {
      const payload = { uid, name: saved };
      if (currentAccount) payload.authUid = currentAccount.uid;
      await setDoc(nameRef, payload, { merge: true });
      currentUser = saved;
      showChatUI();
      return;
    } else {
      localStorage.removeItem('wl_username');
    }
  }
  document.getElementById('username-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('username-input').focus(), 50);
};

window.joinChat = async function () {
  const name = document.getElementById('username-input').value.trim();
  const errorEl = document.getElementById('username-error');
  if (!name) return;

  const nameRef = doc(db, 'usernames', name.toLowerCase());
  const snap = await getDoc(nameRef);

  const canClaimByLink = snap.exists() && currentAccount && snap.data().authUid === currentAccount.uid;
  if (snap.exists() && snap.data().uid !== uid && !canClaimByLink) {
    errorEl.textContent = '✕ that name is taken, choose another.';
    return;
  }

  const payload = { uid, name };
  if (currentAccount) payload.authUid = currentAccount.uid;
  await setDoc(nameRef, payload, { merge: true });
  currentUser = name;
  localStorage.setItem('wl_username', name);
  document.getElementById('username-modal').style.display = 'none';
  errorEl.textContent = '';
  showChatUI();
};

function showChatUI () {
  document.getElementById('chat-ui').style.display = 'block';
  document.getElementById('chat-user-label').textContent = '[ logged in as: ' + currentUser + ' ]';
  updateChatLinkUI();
  if (!chatStarted) { startListener(); chatStarted = true; }
}

function startSendCooldown() {
  const input = document.getElementById('chat-msg-input');
  const btn = document.querySelector('.chat-footer .win-btn');
  const original = input.placeholder;

  input.disabled = true;
  btn.disabled = true;

  let remaining = 5;
  input.placeholder = `wait ${remaining}s before sending...`;

  const interval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(interval);
      input.disabled = false;
      btn.disabled = false;
      input.placeholder = original;
    } else {
      input.placeholder = `wait ${remaining}s before sending...`;
    }
  }, 1000);
}

function startListener () {
  const q = query(collection(db, 'messages'), orderBy('time', 'desc'), limit(100));
  onSnapshot(q, snap => {
    const box = document.getElementById('chat-messages');
    box.innerHTML = '';
    const docs = [];
    snap.forEach(d => docs.push(d));
    docs.reverse();
    docs.forEach(d => renderMessage(d));
    box.scrollTop = box.scrollHeight;
  });
}

function renderMessage (docSnap) {
  const data   = docSnap.data();
  const isMine = data.uid === uid;
  const time   = data.time?.toDate
    ? data.time.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const el = document.createElement('div');
  el.className = 'chat-msg' + (isMine ? ' chat-msg-mine' : '');
  el.innerHTML =
    `<span class="msg-user">${esc(data.user)}</span>` +
    `<span class="msg-time">${time}</span>` +
    `<span class="msg-text">${esc(data.text)}</span>` +
    (isMine ? `<button class="msg-del" title="delete" onclick="deleteMsg('${docSnap.id}')">✕</button>` : '');

  document.getElementById('chat-messages').appendChild(el);
}

let badWords = [];
fetch('./assets/badwords.txt')
  .then(r => r.text())
  .then(t => {
    badWords = t.split('\n').map(w => w.trim().toLowerCase()).filter(Boolean);
  });

function filterText(text) {
  let filtered = text;
  for (const word of badWords) {
    if (!word) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'gi');
    filtered = filtered.replace(regex, m => '*'.repeat(m.length));
  }
  return filtered;
}

window.sendMessage = async function () {
  const input = document.getElementById('chat-msg-input');
  const text  = input.value.trim();
  if (!text || !currentUser || input.disabled) return;
  input.value = '';
  startSendCooldown();
  await addDoc(collection(db, 'messages'), {
    user: currentUser,
    uid,
    text: filterText(text),
    time: serverTimestamp()
  });
};

window.deleteMsg = async function (id) {
  await deleteDoc(doc(db, 'messages', id));
};

function esc (s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.changeUsername = async function () {
  if (currentUser) {
    const oldRef = doc(db, 'usernames', currentUser.toLowerCase());
    const oldSnap = await getDoc(oldRef);
    if (oldSnap.exists() && oldSnap.data().uid === uid) {
      await deleteDoc(oldRef);
    }
  }
  currentUser = null;
  localStorage.removeItem('wl_username');
  document.getElementById('chat-ui').style.display = 'none';
  document.getElementById('chat-link-status').textContent = '';
  document.getElementById('chat-link-btn').style.display = 'none';
  document.getElementById('username-input').value = '';
  document.getElementById('username-error').textContent = '';
  document.getElementById('username-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('username-input').focus(), 50);
};

if (window._chatTabPending) {
  window._chatTabPending = false;
  window.openChatTab();
}
if (window._usersTabPending) {
  window._usersTabPending = false;
  window.openUsersTab();
}
