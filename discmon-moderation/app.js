import { publishableKey, supabaseUrl } from "./config.js";

const $ = (id) => document.getElementById(id);
if (window.self !== window.top) {
  $("message").textContent = "Open DiscMon Moderation in its own browser tab.";
  $("message").hidden = false;
  throw new Error("Moderation requires a top-level window.");
}
const labels = {
  nickname: "Inappropriate nickname",
  abuse: "Offensive or abusive content",
  cheating: "Suspected cheating",
  spam: "Spam",
  other: "Other",
};
const number = new Intl.NumberFormat();
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const authUrl = new URL("/auth/v1/", supabaseUrl);
const moderationUrl = new URL("/functions/v1/leaderboard/moderation", supabaseUrl);
let session = null;
let expiryTimer;
let generation = 0;
let reportOffset = 0;
let auditOffset = 0;
let acting = false;
let setupToken = null;
let setupTimer;

class RequestError extends Error {
  constructor(status) {
    super("Request failed");
    this.status = status;
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options, cache: "no-store", credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new RequestError(response.status);
  return response.status === 204 || url.pathname.endsWith("/logout") ? null : response.json();
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, className) {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", handler);
  return node;
}

function time(value) {
  const node = element("time", dateTime.format(new Date(value)));
  node.dateTime = value;
  return node;
}

function message(text = "", error = false) {
  $("message").textContent = text;
  $("message").hidden = !text;
  $("message").toggleAttribute("data-error", error);
}

function showAuthPanel(id) {
  for (const panel of ["sign-in", "recovery", "password-setup"]) {
    $(panel).hidden = panel !== id;
  }
}

function showRecovery(text = "", error = false) {
  setupToken = null;
  clearTimeout(setupTimer);
  showAuthPanel("recovery");
  $("recovery-email").value ||= $("email").value;
  message(text, error);
  $("recovery-email").focus();
}

const expiredLink = "This password link has expired or was already used. Request a fresh link below.";

function authRequest(path, method, body, token) {
  return request(new URL(path, authUrl), {
    method,
    headers: {
      apikey: publishableKey,
      ...(token && { Authorization: "Bearer " + token }),
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });
}

async function openAuthCallback() {
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const params = url.searchParams;
  const read = (key) => fragment.get(key) ?? params.get(key);
  const keys = ["access_token", "refresh_token", "token_hash", "code", "error", "error_code", "error_description"];
  if (!keys.some((key) => read(key) !== null)) return;
  // Remove one-time credentials from the address bar before any API calls.
  history.replaceState(null, "", url.pathname);
  if (read("error") || read("error_code") || read("error_description")) {
    showRecovery(read("error_code") === "otp_expired" ? expiredLink :
      "This password link could not be opened. Request a fresh link below.", true);
    return;
  }
  const type = read("type");
  const accessToken = fragment.get("access_token");
  const tokenHash = read("token_hash");
  if (!["invite", "recovery"].includes(type) || (!accessToken && !tokenHash)) {
    showRecovery("This password link could not be opened here. Request a fresh link below.", true);
    return;
  }
  showAuthPanel(null);
  message("Checking your password link…");
  let token = accessToken;
  try {
    if (!token) token = (await authRequest("verify", "POST", { token_hash: tokenHash, type })).access_token;
    if (!token || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new RequestError(401);
    // Only an approved DiscMon account can use this password setup screen.
    await request(moderationUrl, { headers: { Authorization: "Bearer " + token } });
    setupToken = token;
    setupTimer = setTimeout(() => {
      if (setupToken === token) showRecovery(expiredLink, true);
    }, 10 * 60 * 1000);
    showAuthPanel("password-setup");
    message();
    $("new-password").focus();
  } catch (error) {
    if (error.status === 403) {
      showAuthPanel("sign-in");
      message("Access denied. An approved DiscMon administrator account is required.", true);
    } else {
      showRecovery([400, 401, 422].includes(error.status) ? expiredLink :
        "Unable to verify this password link. Request a fresh link and try again.", true);
    }
  }
}

$("forgot-password").addEventListener("click", () => showRecovery());
$("back-to-login").addEventListener("click", () => {
  $("email").value = $("recovery-email").value;
  showAuthPanel("sign-in");
  message();
  $("email").focus();
});
$("recover").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  $("back-to-login").disabled = true;
  message("Requesting a reset link…");
  const redirect = new URL(location.pathname, location.origin);
  try {
    await authRequest("recover?redirect_to=" + encodeURIComponent(redirect.href), "POST", {
      email: $("recovery-email").value.trim(),
    });
    message("If this email can receive a reset link, check your inbox and use the newest email.");
  } catch (error) {
    message(error.status === 429 ? "Too many reset requests. Wait a few minutes and try again." :
      "Unable to request a reset link right now. Try again shortly.", true);
  } finally {
    submit.disabled = false;
    $("back-to-login").disabled = false;
  }
});
$("set-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = setupToken;
  if (!token) { showRecovery(expiredLink, true); return; }
  const password = $("new-password").value;
  if (password !== $("confirm-password").value) {
    message("The passwords do not match.", true);
    return;
  }
  const submit = event.submitter;
  submit.disabled = true;
  clearTimeout(setupTimer);
  message("Saving your password…");
  try {
    await authRequest("user", "PUT", { password }, token);
    setupToken = null;
    try { await authRequest("logout?scope=local", "POST", null, token); } catch { /* Discard the session locally. */ }
    showAuthPanel("sign-in");
    message("Password saved. Sign in with your new password.");
    $("email").focus();
  } catch (error) {
    if ([401, 403].includes(error.status)) showRecovery(expiredLink, true);
    else message([400, 422].includes(error.status)
      ? "Supabase rejected this password. Choose a different, stronger password."
      : "Unable to save your password. Try again.", true);
  } finally {
    $("new-password").value = "";
    $("confirm-password").value = "";
    submit.disabled = false;
  }
});

function clearSession(text = "", error = false) {
  session = null;
  clearTimeout(expiryTimer);
  generation += 1;
  reportOffset = 0;
  auditOffset = 0;
  $("reports").replaceChildren();
  $("audit-entries").replaceChildren();
  $("audit").open = false;
  $("audit-more").hidden = true;
  if ($("confirm").open) $("confirm").close("cancel");
  $("note").value = "";
  $("filter").value = "pending";
  for (const key of ["pending", "resolved", "dismissed", "total"]) $("count-" + key).textContent = "—";
  $("dashboard").hidden = true;
  $("sign-out").hidden = true;
  showAuthPanel("sign-in");
  message(text, error);
}

function handleError(error, fallback) {
  if (error.status === 401) clearSession("Your session expired. Sign in again.", true);
  else if (error.status === 403) clearSession("Access denied. An approved DiscMon administrator account is required.", true);
  else if (error.status === 409) message("This report or score changed. Refresh and review it again.", true);
  else if (error.status === 404) message("This report or score is no longer available. Refresh the queue.", true);
  else message(fallback, true);
}

async function moderate(params = {}, body) {
  const token = session?.access_token;
  if (!token) throw new RequestError(401);
  const url = new URL(moderationUrl);
  url.search = new URLSearchParams(params);
  return request(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + token, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
}

$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  message("Signing in…");
  try {
    session = await request(new URL("token?grant_type=password", authUrl), {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value }),
    });
    const result = await moderate({ filter: "pending" });
    expiryTimer = setTimeout(() => clearSession("Your session expired. Sign in again.", true),
      Math.max(0, session.expires_at * 1000 - Date.now()));
    $("sign-in").hidden = true;
    $("sign-out").hidden = false;
    $("dashboard").hidden = false;
    renderQueue(result);
    message();
    $("filter").focus();
  } catch (error) {
    const text = error.status === 403 ? "Access denied. An approved DiscMon administrator account is required."
      : [400, 401, 422].includes(error.status) ? "Sign-in failed. Check your email and password."
      : error.status === 429 ? "Too many sign-in attempts. Try again later."
      : "Sign-in could not be completed. Check your connection and try again.";
    clearSession(text, true);
  } finally {
    $("password").value = "";
    submit.disabled = false;
  }
});

$("sign-out").addEventListener("click", async () => {
  const token = session?.access_token;
  clearSession("Signed out.");
  $("email").focus();
  if (!token) return;
  try {
    await request(new URL("logout?scope=local", authUrl), {
      method: "POST", headers: { apikey: publishableKey, Authorization: "Bearer " + token },
    });
  } catch {
    if (!session) message("Signed out here. Supabase could not confirm session revocation.", true);
  }
});

function renderQueue(result) {
  for (const [key, value] of Object.entries(result.counts)) $("count-" + key).textContent = number.format(value);
  const filter = $("filter").value;
  $("reports").replaceChildren(...result.groups.map((group) => renderGroup(group, filter)));
  if (!result.groups.length) $("reports").append(element("p", "No reports on this page.", "empty"));
  $("pages").hidden = !result.has_more && !reportOffset;
  $("previous").disabled = !reportOffset;
  $("next").disabled = !result.has_more;
  $("page").textContent = "Page " + (reportOffset / 20 + 1);
}

async function loadQueue(feedback = "") {
  const version = ++generation;
  const filter = $("filter").value;
  $("reports").replaceChildren(element("p", "Loading reports…", "empty"));
  $("pages").hidden = true;
  try {
    const result = await moderate({ filter, offset: reportOffset });
    if (version !== generation) return;
    renderQueue(result);
    message(feedback);
  } catch (error) {
    if (version !== generation) return;
    $("reports").replaceChildren();
    handleError(error, "Unable to load reports. Select Refresh to retry.");
  }
}

function renderGroup(group, filter) {
  const details = element("details", undefined, "score");
  const summary = element("summary");
  const heading = element("span", undefined, "score-heading");
  heading.append(
    element("span", group.nickname ?? "Unavailable"),
    element("span", number.format(group.report_count) + (group.report_count === 1 ? " report" : " reports")),
  );
  summary.append(heading);
  const body = element("div", undefined, "score-body");
  const meta = element("p",
    "Score " + (group.score == null ? "unavailable" : number.format(group.score)) +
    " · Level " + (group.level ?? "unavailable") + (group.hidden_at ? " · Score hidden" : ""), "entry-meta");
  const id = element("p", "Entry ID " + group.id, "entry-meta identifiers muted");
  const rows = element("div");
  body.append(meta, id, rows);
  details.append(summary, body);
  let offset = 0;
  async function loadDetails() {
    const token = session?.access_token;
    const loading = element("p", "Loading reports…", "empty");
    rows.append(loading);
    try {
      const data = await moderate({ view: "detail", filter, id: group.id, offset });
      if (session?.access_token !== token || !rows.isConnected) return;
      rows.append(...data.items.map((report) => renderReport(report, group, details)));
      if (offset === 0 && !data.items.length) rows.append(element("p", "No matching reports.", "empty"));
      offset += data.items.length;
      if (data.has_more) rows.append(button("Load older reports", (event) => {
        event.currentTarget.remove();
        void loadDetails();
      }));
    } catch (error) {
      if (session?.access_token !== token || !rows.isConnected) return;
      handleError(error, "Unable to load report details.");
      rows.append(button("Retry report details", (event) => {
        event.currentTarget.remove();
        void loadDetails();
      }));
    } finally {
      loading.remove();
    }
  }
  details.addEventListener("toggle", () => {
    if (details.open && !rows.hasChildNodes()) void loadDetails();
  });
  return details;
}

function renderReport(report, group, details) {
  const article = element("article", undefined, "report");
  const heading = element("div", undefined, "report-heading");
  const status = element("span", report.status, "status");
  status.dataset.status = report.status;
  heading.append(element("h3", labels[report.reason] ?? report.reason), status);
  article.append(heading, time(report.created_at), element("p", "Report ID " + report.id, "identifiers muted"));
  const actions = element("div", undefined, "toolbar");
  if (report.status === "pending") {
    actions.append(
      button("Dismiss Report", () => changeReport("dismiss", report, null)),
      button("Mark Resolved", () => changeReport("resolve", report, null)),
      button("Review Later", () => {
        details.open = false;
        details.querySelector("summary").focus();
      }),
    );
  }
  if (!group.hidden_at) {
    actions.append(button("Remove Score", () => confirmRemoval(report, group), "danger"));
  }
  if (actions.childElementCount) article.append(actions);
  return article;
}

function confirmRemoval(report, group) {
  const dialog = $("confirm");
  if (acting || dialog.open) return;
  $("confirm-copy").textContent =
    "Hide the score for " + group.nickname + " from the public leaderboard and resolve pending reports for this entry?";
  $("note").value = "";
  dialog.returnValue = "cancel";
  dialog.addEventListener("close", () => {
    const note = $("note").value.trim() || null;
    $("note").value = "";
    if (dialog.returnValue === "remove") void changeReport("remove", report, note);
  }, { once: true });
  dialog.showModal();
}

async function changeReport(action, report, note) {
  if (acting) return;
  acting = true;
  const token = session?.access_token;
  message("Saving moderation action…");
  try {
    await moderate({}, { action, report_id: report.id, expected: report.status, note });
    if (session?.access_token !== token) return;
    reportOffset = 0;
    await loadQueue({ dismiss: "Report dismissed.", resolve: "Report resolved.", remove: "Score hidden." }[action]);
    if ($("audit").open) void loadAudit(true);
  } catch (error) {
    if (session?.access_token === token) {
      handleError(error, "Unable to confirm the action. Refresh before trying again.");
    }
  } finally {
    acting = false;
  }
}

async function loadAudit(reset = false) {
  if (reset) {
    auditOffset = 0;
    $("audit-entries").replaceChildren();
  }
  const token = session?.access_token;
  $("audit-more").hidden = true;
  const loading = element("p", "Loading moderation history…", "empty");
  $("audit-entries").append(loading);
  try {
    const data = await moderate({ view: "audit", offset: auditOffset });
    if (session?.access_token !== token || !loading.isConnected) return;
    for (const item of data.items) {
      const row = element("article", undefined, "audit-item");
      row.append(
        element("h3", ({ dismiss: "Dismissed report", resolve: "Resolved report", remove: "Removed score" })[item.action] ?? item.action),
        time(item.created_at),
        element("p", "Administrator " + (item.administrator_id ?? item.operator_label), "muted identifiers"),
        element("p", "Entry ID " + item.score_id, "muted identifiers"),
      );
      if (item.report_id) row.append(element("p", "Report ID " + item.report_id, "muted identifiers"));
      if (item.previous_status) row.append(element("p", item.previous_status + " → " + item.new_status, "muted"));
      if (item.note) row.append(element("p", item.note, "identifiers"));
      $("audit-entries").append(row);
    }
    if (auditOffset === 0 && !data.items.length) $("audit-entries").append(element("p", "No moderation actions yet.", "empty"));
    auditOffset += data.items.length;
    $("audit-more").textContent = "Load older actions";
    $("audit-more").hidden = !data.has_more;
  } catch (error) {
    if (session?.access_token !== token || !loading.isConnected) return;
    handleError(error, "Unable to load moderation history.");
    if (session) {
      $("audit-more").textContent = "Retry history";
      $("audit-more").hidden = false;
    }
  } finally {
    loading.remove();
  }
}

$("filter").addEventListener("change", () => { reportOffset = 0; void loadQueue(); });
$("refresh").addEventListener("click", () => {
  void loadQueue();
  if ($("audit").open) void loadAudit(true);
});
$("previous").addEventListener("click", () => { reportOffset -= 20; void loadQueue(); });
$("next").addEventListener("click", () => { reportOffset += 20; void loadQueue(); });
$("audit").addEventListener("toggle", () => { if ($("audit").open) void loadAudit(true); });
$("audit-more").addEventListener("click", () => { void loadAudit(); });

const secure = location.protocol === "https:" ||
  (location.protocol === "http:" && location.hostname === "127.0.0.1");
if (secure && /^(sb_publishable_[\w-]+|[\w-]+\.[\w-]+\.[\w-]+)$/.test(publishableKey)) {
  $("login").querySelector('[type="submit"]').disabled = false;
  $("forgot-password").disabled = false;
  showAuthPanel("sign-in");
  void openAuthCallback();
} else {
  message("Configure a Supabase publishable key and open this page over HTTPS or the local preview URL.", true);
}
