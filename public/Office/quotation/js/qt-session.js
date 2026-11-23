(function () {
  const protectedPages = new Set(["index.html", "dashboard.html"]);
  const directory = window.location.pathname.slice(
    0,
    window.location.pathname.lastIndexOf("/") + 1,
  );

  function getCurrentPage() {
    const file = window.location.pathname.slice(
      window.location.pathname.lastIndexOf("/") + 1,
    );
    return file || "index.html";
  }

  function getLoginDestination() {
    const requested = new URLSearchParams(window.location.search).get(
      "redirect",
    );
    if (!requested) return "index.html";

    try {
      const destination = new URL(requested, window.location.href);
      const page = destination.pathname.slice(
        destination.pathname.lastIndexOf("/") + 1,
      );
      if (
        destination.origin === window.location.origin &&
        destination.pathname === `${directory}${page}` &&
        protectedPages.has(page)
      ) {
        return `${page}${destination.search}${destination.hash}`;
      }
    } catch (e) {}

    return "index.html";
  }

  function requirePage() {
    if (localStorage.getItem("qt_token")) {
      document.documentElement.style.visibility = "";
      return true;
    }

    const page = getCurrentPage();
    const returnTarget = protectedPages.has(page)
      ? `${page}${window.location.search}${window.location.hash}`
      : "index.html";

    document.documentElement.style.visibility = "hidden";
    window.location.replace(
      `login.html?redirect=${encodeURIComponent(returnTarget)}`,
    );
    return false;
  }

  function logoutQT() {
    localStorage.removeItem("qt_token");
    localStorage.removeItem("qt_user");
    window.location.replace("login.html");
  }

  function handleSessionStorageChange(event) {
    const sessionCleared =
      (event.key === "qt_token" && !event.newValue) ||
      (event.key === null && !localStorage.getItem("qt_token"));
    if (!sessionCleared) return;

    if (getCurrentPage() === "login.html") return;
    document.documentElement.style.visibility = "hidden";
    window.location.replace("login.html");
  }

  window.qtSession = { getLoginDestination, requirePage, logoutQT };
  window.addEventListener("storage", handleSessionStorageChange);

  if (protectedPages.has(getCurrentPage())) {
    requirePage();
    window.addEventListener("pageshow", requirePage);
  }
})();
