(function () {
  const protectedPages = new Set([
    "AKS.html",
    "AKS_Summary.html",
    "Assets.html",
    "Dashboard.html",
    "list.html",
    "monthly_list_summary.html",
    "summary.html",
  ]);
  const returnPages = new Set([...protectedPages, "Dashboard.html"]);
  const directory = window.location.pathname.slice(
    0,
    window.location.pathname.lastIndexOf("/") + 1,
  );

  function getLoginDestination() {
    const requested = new URLSearchParams(window.location.search).get(
      "redirect",
    );
    if (!requested) return "Dashboard.html";

    try {
      const destination = new URL(requested, window.location.href);
      const page = destination.pathname.slice(
        destination.pathname.lastIndexOf("/") + 1,
      );
      if (
        destination.origin === window.location.origin &&
        destination.pathname === `${directory}${page}` &&
        returnPages.has(page)
      ) {
        return `${page}${destination.search}${destination.hash}`;
      }
    } catch (error) {
      // Invalid return targets fall back to the tracker dashboard.
    }

    return "Dashboard.html";
  }

  function getReturnTarget() {
    const page = window.location.pathname.slice(
      window.location.pathname.lastIndexOf("/") + 1,
    );
    return returnPages.has(page)
      ? `${page}${window.location.search}${window.location.hash}`
      : "Dashboard.html";
  }

  function logout() {
    localStorage.removeItem("eq_token");
    localStorage.removeItem("eq_user");
    const isAdminPage = window.location.pathname.endsWith("/admin/index.html");
    window.location.replace(
      isAdminPage
        ? "../index.html"
        : `index.html?redirect=${encodeURIComponent(getReturnTarget())}`,
    );
  }

  function requirePage() {
    if (localStorage.getItem("eq_token")) {
      document.documentElement.style.visibility = "";
      return true;
    }

    document.documentElement.style.visibility = "hidden";
    window.location.replace(
      `index.html?redirect=${encodeURIComponent(getReturnTarget())}`,
    );
    return false;
  }

  function handleSessionStorageChange(event) {
    const sessionCleared =
      (event.key === "eq_token" && !event.newValue) ||
      (event.key === null && !localStorage.getItem("eq_token"));
    if (!sessionCleared) return;

    const isAdminPage = window.location.pathname.endsWith("/admin/index.html");
    const currentPage = window.location.pathname.slice(
      window.location.pathname.lastIndexOf("/") + 1,
    );
    if (currentPage === "index.html" && !isAdminPage) return;

    document.documentElement.style.visibility = "hidden";
    window.location.replace(
      isAdminPage
        ? "../index.html"
        : `index.html?redirect=${encodeURIComponent(getReturnTarget())}`,
    );
  }

  window.ownEquipmentSession = { getLoginDestination, requirePage, logout };
  window.addEventListener("storage", handleSessionStorageChange);

  const currentPage = window.location.pathname.slice(
    window.location.pathname.lastIndexOf("/") + 1,
  );
  if (protectedPages.has(currentPage)) {
    requirePage();
    window.addEventListener("pageshow", requirePage);
  }
})();
