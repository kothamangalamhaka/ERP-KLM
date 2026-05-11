const companyData = {
  Haka: {
    header: "https://i.ibb.co/Ld752yD5/hd.png",
    seal: "https://i.ibb.co/mrLFJdBy/sl.png",
    text: "Prepared & Approved by Haka Accounts",
    signature: "https://i.ibb.co/CK8X4YpV/Screenshot-2026-03-28-111438.png",
  },
  Aljoda: {
    header: "https://i.ibb.co/3yMwhgD5/Screenshot-2026-03-28-103621.png",
    seal: "https://i.ibb.co/4gRPdGXc/Screenshot-2026-03-28-103653.png",
    text: "Prepared & Approved by Aljoda Sara Rentals Accounts",
    signature: "https://i.ibb.co/Z1b8gCwT/Screenshot-2026-03-28-111323.png",
  },
  "Masar Wheels": {
    header: "https://i.ibb.co/gM7QnS59/Screenshot-2026-03-28-103016.png",
    seal: "https://i.ibb.co/Y63vHZ9/Screenshot-2026-03-28-103341.png",
    text: "Prepared & Approved by Masar Wheels Accounts",
    signature: "https://i.ibb.co/bMPNp3SJ/Screenshot-2026-03-28-111529.png",
  },
  "We1 Track": {
    header: "https://i.ibb.co/4w55CkbM/Screenshot-2026-03-28-103434.png",
    seal: "https://i.ibb.co/XfybvXzL/Screenshot-2026-03-28-103519.png",
    text: "Prepared & Approved by We1 Track Accounts",
    signature: "https://i.ibb.co/pBmhnB2j/Screenshot-2026-03-28-111612.png",
  },
};

let masterData = [];
let savedBillingData = [];
let manualTableCount = 0;
let isCombinedView = false;

document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (token) verifyToken(token);
  else document.getElementById("loginUserId").focus();
});

async function verifyToken(token) {
  document.getElementById("loader").style.display = "flex";
  try {
    const res = await fetch("/billing/verify-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    document.getElementById("loader").style.display = "none";
    if (res.ok) {
      const data = await res.json();
      if (data.success) loadApp();
      else executeLogout();
    } else executeLogout();
  } catch (err) {
    document.getElementById("loader").style.display = "none";
    executeLogout();
  }
}

async function executeLogin() {
  const username = document.getElementById("loginUserId").value;
  const password = document.getElementById("loginPass").value;
  if (!username || !password) return alert("Enter credentials");

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem("token", data.token);
      loadApp();
    } else alert(data.message);
  } catch (err) {
    alert("Server Error.");
  }
}

function executeLogout() {
  localStorage.removeItem("token");
  window.location.reload();
}

function loadApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("mainAppContainer").style.display = "block";
  initMonth();
}

function initMonth() {
  const optsContainer = document.getElementById("monthOptions");
  optsContainer.innerHTML = "";
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  let currentD = new Date();
  for (let y = 2026; y <= currentD.getFullYear(); y++) {
    let mEnd = y === currentD.getFullYear() ? currentD.getMonth() : 11;
    for (let m = 0; m <= mEnd; m++) {
      let value = `${months[m]} ${y}`;
      optsContainer.innerHTML += `<div class="custom-dropdown-item" onclick="selectMonth('${value}')">${value}</div>`;
    }
  }
  selectMonth(`${months[currentD.getMonth()]} ${currentD.getFullYear()}`);
}

function selectMonth(val) {
  document.getElementById("selectedMonthText").innerText = val;
  document.getElementById("monthOptions").classList.remove("show");
  document
    .querySelectorAll(".date-cell")
    .forEach((cell) => (cell.innerText = getShortDate()));
}

function getShortDate() {
  let val = document.getElementById("selectedMonthText").innerText.trim();
  let parts = val.split(" ");
  if (parts.length >= 2)
    return parts[0].substring(0, 3) + " " + parts[1].substring(2, 4);
  return val;
}

function toggleDropdown(id) {
  let el = document.getElementById(id);
  let isShowing = el.classList.contains("show");
  document
    .querySelectorAll(".custom-dropdown-options")
    .forEach((d) => d.classList.remove("show"));
  if (!isShowing) el.classList.add("show");
}
document.addEventListener("click", function (e) {
  if (!e.target.closest(".custom-dropdown")) {
    document
      .querySelectorAll(".custom-dropdown-options")
      .forEach((d) => d.classList.remove("show"));
  }
});

function filterCheckboxList(inputId, listId) {
  let filter = document.getElementById(inputId).value.toUpperCase();
  let items = document.getElementById(listId).querySelectorAll(".dynamic-item");
  items.forEach((item) => {
    let txt = item.innerText || item.textContent;
    item.style.display = txt.toUpperCase().includes(filter) ? "" : "none";
  });
}
function toggleAllCheckboxes(listId, isChecked) {
  let items = document
    .getElementById(listId)
    .querySelectorAll(".dynamic-check");
  items.forEach((item) => {
    if (item.parentElement.style.display !== "none") item.checked = isChecked;
  });
  updateSelectTexts();
}
function getSelectedCheckboxes(listId) {
  let selected = [];
  document
    .getElementById(listId)
    .querySelectorAll(".dynamic-check:checked")
    .forEach((chk) => selected.push(chk.value));
  return selected;
}
function updateSelectTexts() {
  let owners = getSelectedCheckboxes("ownerList");
  let sites = getSelectedCheckboxes("siteList");
  document.getElementById("ownerSelectText").innerText =
    owners.length > 0 ? `${owners.length} Selected` : "None Selected";
  document.getElementById("siteSelectText").innerText =
    sites.length > 0 ? `${sites.length} Selected` : "None Selected";
}

function fetchDataFromERP() {
  const fullMonth = document
    .getElementById("selectedMonthText")
    .innerText.trim();
  const token = localStorage.getItem("token");
  if (!fullMonth || fullMonth === "Loading...")
    return showToast("Select a month.");

  document.getElementById("loader").style.display = "flex";
  fetch("/billing/vehicles?month=" + encodeURIComponent(fullMonth), {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (res) => {
      if (res.status === 401 || res.status === 403) {
        executeLogout();
        throw new Error("Session Expired");
      }
      return res.json();
    })
    .then((data) => {
      if (data.success) {
        masterData = data.data;
        savedBillingData = data.saved_bills || [];
        populateCheckboxes();
        showToast(
          `Fetched ${masterData.length} vehicles! Select filters and click 'Arrange ✨'`,
        );
      } else showToast("Backend Error: " + data.message);
      document.getElementById("loader").style.display = "none";
    })
    .catch((err) => {
      document.getElementById("loader").style.display = "none";
      if (err.message !== "Session Expired")
        showToast("Server Connection Failed!");
    });
}

function populateCheckboxes() {
  let owners = [
    ...new Set(
      masterData.map(
        (item) => item.owner?.trim().toUpperCase() || "COMPANY VEHICLE",
      ),
    ),
  ].sort();
  let sites = [
    ...new Set(masterData.map((item) => item.site?.trim() || "N/A")),
  ].sort();

  let oList = document.getElementById("ownerList");
  let sList = document.getElementById("siteList");

  oList.querySelectorAll(".dynamic-item").forEach((e) => e.remove());
  sList.querySelectorAll(".dynamic-item").forEach((e) => e.remove());

  owners.forEach(
    (o) =>
      (oList.innerHTML += `<label class="check-item dynamic-item"><input type="checkbox" class="dynamic-check" value="${o}" checked onchange="updateSelectTexts()"> ${o}</label>`),
  );
  sites.forEach(
    (s) =>
      (sList.innerHTML += `<label class="check-item dynamic-item"><input type="checkbox" class="dynamic-check" value="${s}" checked onchange="updateSelectTexts()"> ${s}</label>`),
  );
  updateSelectTexts();
}

function getCompanyFromSite(siteName) {
  if (!siteName) return "Haka";
  let s = siteName.toUpperCase();
  if (s.includes("ALJODA")) return "Aljoda";
  if (s.includes("MASAR")) return "Masar Wheels";
  if (s.includes("WE1") || s.includes("WE 1")) return "We1 Track";
  return "Haka";
}

let currentArrangeMode = "split"; // 'split', 'site', 'owner'

window.setArrangeMode = function (mode) {
  currentArrangeMode = mode;
  arrangeProperly();
};

function arrangeProperly() {
  if (masterData.length === 0 && savedBillingData.length === 0)
    return showToast("Fetch data first!");

  let selectedOwners = getSelectedCheckboxes("ownerList");
  let selectedSites = getSelectedCheckboxes("siteList");

  if (selectedOwners.length === 0 || selectedSites.length === 0)
    return showToast("Please select at least one Owner and one Site.");

  document.getElementById("loader").style.display = "flex";
  document.getElementById("loaderText").innerText = "Arranging Bills...";

  setTimeout(() => {
    let groups = {};
    masterData.forEach((item) => {
      let owner =
        item.owner && item.owner.trim() !== ""
          ? item.owner.trim().toUpperCase()
          : "COMPANY VEHICLE";
      let site = item.site || "N/A";
      if (!selectedOwners.includes(owner) || !selectedSites.includes(site))
        return;
      let comp = getCompanyFromSite(site);

      // 🟢 NEW: 4 TYPES OF GROUPING LOGIC
      let key = "";
      if (currentArrangeMode === "site") {
        key = comp + "|||" + site;
      } else if (currentArrangeMode === "owner_comp") {
        key = comp + "|||" + owner; // 🟢 Same Company, Same Owner
      } else if (currentArrangeMode === "owner_all") {
        key = owner; // 🟢 Same Owner (Ignores company and site)
      } else {
        key = comp + "|||" + owner + "|||" + site; // Default Split
      }

      if (!groups[key]) {
        groups[key] = {
          company: currentArrangeMode === "owner_all" ? "Haka" : comp,
          owner: currentArrangeMode === "site" ? "VARIOUS OWNERS" : owner,
          items: [],
        };
      }
      groups[key].items.push(item);
    });

    const container = document.getElementById("dynamicBillsContainer");
    container.innerHTML = "";

    if (Object.keys(groups).length === 0) {
      container.innerHTML = `<div style="text-align:center; padding: 50px; background: white; border-radius:8px;"><h2>No Vehicles Found for Selected Filters</h2></div>`;
    } else {
      let groupCount = 0;
      Object.values(groups).forEach((group) => {
        // Sort plates alphabetically for combined views
        if (currentArrangeMode !== "split") {
          group.items.sort((a, b) => {
            let plateA = (a.plate_number || a.plate || "").toUpperCase();
            let plateB = (b.plate_number || b.plate || "").toUpperCase();
            return plateA.localeCompare(plateB);
          });
        }

        groupCount++;
        container.appendChild(createBillCard(group, `group_${groupCount}`));
      });
      document
        .querySelectorAll(".nhr, .othr, .nrate, .otrate, .rent")
        .forEach((el) => calculateRow(el));
      showToast(`Successfully generated ${groupCount} table(s)!`);
    }
    document.getElementById("loader").style.display = "none";
    document.getElementById("loaderText").innerText = "Processing Data...";
  }, 500);
}

function createManualTable() {
  manualTableCount++;
  const container = document.getElementById("dynamicBillsContainer");
  if (container.innerHTML.includes("No Bills Generated Yet"))
    container.innerHTML = "";

  let manualGroup = {
    company: "Haka",
    owner: "",
    items: [
      {
        vehicle_type: "",
        driver: "",
        site: "",
        plate_number: "",
        nrate: 0,
        otrate: 0,
        vat_bill: "Yes",
      },
    ],
  };
  container.insertAdjacentElement(
    "afterbegin",
    createBillCard(manualGroup, `manual_${manualTableCount}`),
  );
  showToast("Blank Manual Table Added!");
}

function createBillCard(group, id) {
  const card = document.createElement("div");
  card.className = "container bill-card";
  card.id = `billCard_${id}`;
  card.dataset.company = group.company;
  card.dataset.owner = group.owner;

  const compConfig = companyData[group.company] || companyData["Haka"];
  const shortDate = getShortDate();

  let requiresVat = group.items.some((item) => item.vat_bill === "Yes");
  if (id.toString().startsWith("manual_")) requiresVat = true;
  let vatDisplay = requiresVat ? "" : "none";

  let html = `
        <div class="no-export" style="display:flex; justify-content:space-between; margin-bottom:15px; background:#f8f9fa; padding:10px; border-radius:5px; border:1px solid #ddd;">
            <div style="display:flex; gap:10px; align-items:center;">
                <b style="color:#1a4d80; font-size:16px;">${group.company} - ${group.owner || "Manual Entry"}</b>
                <button class="icon-btn" title="Toggle Images" style="background:#6f42c1;" onclick="toggleCardImages('${id}')"><i class="material-icons">visibility</i></button>
                <button class="icon-btn" title="Adjustments" style="background:#6c757d;" onclick="toggleCardAdjustments('${id}')"><i class="material-icons">settings</i></button>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="icon-btn" title="Download Image" style="background:#007bff;" onclick="exportSingleImage('${id}')"><i class="material-icons">download</i></button>
                <button class="icon-btn" title="Share WhatsApp" style="background:#25D366;" onclick="shareSingleWhatsApp('${id}')"><i class="material-icons">chat</i></button>
                <button class="icon-btn" title="Remove Table" style="background:#dc3545; margin-left:15px;" onclick="this.closest('.bill-card').remove()"><i class="material-icons">delete</i></button>
            </div>
        </div>

        <div class="print-area" id="printArea_${id}">
            <img src="${compConfig.header}" class="header-img hidden-image" alt="Header" crossorigin="anonymous">
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px;">
                <div style="font-weight: 800; font-size: 16px; color: #1a4d80; text-transform: uppercase;">
                    OWNER : <input type="text" class="owner-input" value="${group.owner}" placeholder="Enter Owner Name" style="border:none; border-bottom:1px solid #ccc; font-weight:bold; font-size:16px; color:#1a4d80; width:300px; text-transform:uppercase; background:transparent;">
                </div>
            </div>

            <h3>Bill Summary for Each Month ملخص فاتورة الشهر</h3>

            <table class="billTable">
                <thead>
                    <tr>
                        <th class="col-num">#</th>
                        <th class="col-date">Date</th>
                        <th class="col-vtype">Vehicle Type</th>
                        <th class="col-driver">Driver</th>
                        <th class="col-site site-col">Site</th> <th class="col-plate">Plate No</th>
                        <th class="col-small">N.Hr</th>
                        <th class="col-rate rate-col">N.Rate</th> 
                        <th class="col-small">OT Hr</th>
                        <th class="col-rate rate-col">OT Rate</th> 
                        <th class="col-money">Rent</th>
                        <th class="col-vat-p vat-col" style="display:${vatDisplay};">VAT %</th>
                        <th class="col-money vat-col" style="display:${vatDisplay};">VAT Amt</th>
                        <th class="col-money total-col" style="display:${vatDisplay};">Total</th>
                        <th class="col-action no-export">Act</th>
                    </tr>
                </thead>
                <tbody class="tableBody">
    `;

  group.items.forEach((item, index) => {
    let saved = savedBillingData.find(
      (s) => s.plate_no === item.plate_number && s.site_name === item.site,
    );
    let nhr = saved ? saved.nhr : 0;
    let othr = saved ? saved.othr : 0;

    // 🟢 FIXED: Removed .toFixed(2) here to load exact rates from DB
    let nrate = parseFloat(saved ? saved.nrate : item.nrate || 0);
    let otrate = parseFloat(saved ? saved.otrate : item.otrate || 0);

    let vatPerc = saved ? saved.vat_percent : item.vat_bill === "Yes" ? 15 : 0;
    let driverName = item.driver_name || item.driver || "";
    if (saved && saved.driver) driverName = saved.driver;

    html += generateRowHTML(
      index + 1,
      shortDate,
      item.vehicle_type,
      driverName,
      item.site,
      item.plate_number,
      nhr,
      nrate,
      othr,
      otrate,
      vatPerc,
      vatDisplay,
    );
  });

  html += `
                </tbody>
                <tfoot>
                    <tr class="total-row">
                        <td colspan="6" class="footer-colspan" style="text-align:right; padding-right:15px;">Grand Total:</td>
                        <td class="grandNHr">0</td>
                        <td class="rate-col"></td>
                        <td class="grandOTHr">0</td>
                        <td class="rate-col"></td>
                        <td class="grandRent">0.00</td>
                        <td class="vat-col" style="display:${vatDisplay};"></td>
                        <td class="grandVat vat-col" style="display:${vatDisplay};">0.00</td>
                        <td class="grandTotal total-col" style="display:${vatDisplay};">0.00</td>
                        <td class="no-export" style="text-align: center;">
                            <button type="button" class="btn-add-circle" onclick="addDynamicRow('${id}')">+</button>
                        </td>
                    </tr>
                </tfoot>
            </table>

            ${
              id.toString().startsWith("manual_")
                ? `
            <div class="no-export" style="text-align: right; margin-top: 15px;">
                <button type="button" class="btn" style="background:#ff9800; color:white; display:inline-flex; align-items:center; gap:5px; padding: 10px 15px;" onclick="arrangeSingleCard('${id}')">
                    <i class="material-icons" style="font-size:18px;">auto_awesome</i> Arrange Manual Data
                </button>
            </div>
            `
                : ""
            }

            <div class="adjustmentsSection" style="display:none; margin-top: 20px;">
                <h4 style="margin-bottom:5px; color:#1a4d80;">Adjustments</h4>
                <table class="adjTable">
                    <thead>
                        <tr>
                            <th class="col-date">Date</th>
                            <th class="col-plate">Plate No</th>
                            <th>Description</th>
                            <th class="col-money">Amount</th>
                            <th class="col-small no-export-col">Type</th>
                            <th class="col-action no-export"><button type="button" class="btn-add-circle" onclick="addAdjRowToCard('${id}')">+</button></th>
                        </tr>
                    </thead>
                    <tbody class="adjBody"></tbody>
                    <tfoot>
                        <tr class="balance-row">
                            <td colspan="3" style="text-align:right; padding-right:15px; border:none;">Final Balance After Adjustment:</td>
                            <td class="finalBalance" style="width:130px; border: 1px solid #ccc; text-align:center;">0.00</td>
                            <td colspan="2" class="no-export" style="border:none;"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div class="footer" style="margin-top:40px; display:flex; justify-content:space-between; align-items:flex-end;">
                <div style="text-align: left;">
                    <img src="${compConfig.signature}" class="signature-img hidden-image" alt="Signature" crossorigin="anonymous">
                    <p style="margin-bottom: 5px;"><b>${compConfig.text}</b></p>
                    <p style="border-top: 1px solid #333; width: 250px;"></p>
                </div>
                <div style="text-align: right;">
                    <img src="${compConfig.seal}" class="seal hidden-image" alt="Company Seal" crossorigin="anonymous">
                </div>
            </div>
        </div>
    `;

  card.innerHTML = html;
  return card;
}

function generateRowHTML(
  index,
  date,
  vtype,
  driver,
  site,
  plate,
  nhr,
  nrate,
  othr,
  otrate,
  vatPerc,
  vatDisplay,
) {
  return `
        <tr>
            <td class="row-num">${index}</td>
            <td class="date-cell">${date}</td>
            <td><input type="text" class="vtype" value="${vtype || ""}"></td>
            <td><input type="text" class="driver" value="${driver || ""}"></td>
            <td class="site-col"><input type="text" class="site" value="${site || ""}"></td> <td class="autocomplete-wrapper">
                <input type="text" class="plate" value="${plate || ""}" oninput="showSuggestions(this)" onkeydown="handleGlobalKeyDown(event, this)" onblur="handlePlateBlur(this)" autocomplete="off">
                <div class="suggestion-box"></div>
            </td>
            <td><input type="number" class="nhr" value="${nhr}" oninput="calculateRow(this)"></td>
            <td class="rate-col"><input type="number" class="nrate" value="${nrate}" oninput="calculateRow(this)"></td> 
            <td><input type="number" class="othr" value="${othr}" oninput="calculateRow(this)"></td>
            <td class="rate-col"><input type="number" class="otrate" value="${otrate}" oninput="calculateRow(this)"></td> 
            <td><input type="number" class="rent" value="0.00" oninput="calculateFromRent(this)"></td>
            <td class="vat-col" style="display:${vatDisplay};">
                <select class="vat-rate table-select" onchange="calculateRow(this)">
                    <option value="15" ${vatPerc == 15 ? "selected" : ""}>15%</option>
                    <option value="0" ${vatPerc == 0 ? "selected" : ""}>0%</option>
                </select>
            </td>
            <td class="vat vat-col" style="display:${vatDisplay};">0.00</td>
            <td class="total total-col" style="display:${vatDisplay};">0.00</td>
            <td class="no-export"><button type="button" class="btn-remove" onclick="removeDynamicRow(this)">✖</button></td>
        </tr>
    `;
}

window.arrangeSingleCard = function (cardId) {
  const card = document.getElementById(`billCard_${cardId}`);
  let itemsToGroup = [];
  let fallbackOwner = card.querySelector(".owner-input")
    ? card.querySelector(".owner-input").value.trim()
    : card.dataset.owner;

  card.querySelectorAll(".tableBody tr").forEach((row) => {
    let plate = row.querySelector(".plate").value.trim().toUpperCase();
    let site = row.querySelector(".site").value.trim();
    let vtype = row.querySelector(".vtype").value.trim();
    let driver = row.querySelector(".driver").value.trim();
    let nhr = parseFloat(row.querySelector(".nhr").value) || 0;
    let nrate = parseFloat(row.querySelector(".nrate").value) || 0;
    let othr = parseFloat(row.querySelector(".othr").value) || 0;
    let otrate = parseFloat(row.querySelector(".otrate").value) || 0;
    let vatSelect = row.querySelector(".vat-rate");
    let vatPerc = vatSelect ? parseFloat(vatSelect.value) || 0 : 0;
    let isVat = vatPerc > 0 ? "Yes" : "No";

    if (!plate && !site && nhr === 0 && othr === 0) return;

    let itemOwner = fallbackOwner;
    if (plate) {
      let masterMatch = masterData.find(
        (m) => (m.plate_number || m.plate || "").toUpperCase() === plate,
      );
      if (masterMatch && masterMatch.owner)
        itemOwner = masterMatch.owner.trim();
    }
    if (!itemOwner) itemOwner = "COMPANY VEHICLE";

    itemsToGroup.push({
      plate_number: plate,
      site: site,
      vehicle_type: vtype,
      driver_name: driver,
      nrate: nrate,
      otrate: otrate,
      vat_bill: isVat,
      owner: itemOwner,
      temp_nhr: nhr,
      temp_othr: othr,
    });
  });

  if (itemsToGroup.length === 0) return showToast("No data to arrange!");

  document.getElementById("loader").style.display = "flex";
  document.getElementById("loaderText").innerText = "Arranging Manual Data...";

  // (അതിലെ setTimeout നുള്ളിലെ ഗ്രൂപ്പിംഗ് ഭാഗം മാത്രം താഴെ കാണുന്നതുപോലെ മാറ്റുക)

  setTimeout(() => {
    let groups = {};
    itemsToGroup.forEach((item) => {
      let comp = getCompanyFromSite(item.site);

      // 🟢 NEW MANUAL ARRANGE LOGIC
      let key = "";
      if (currentArrangeMode === "site") {
        key = comp + "|||" + item.site;
      } else if (currentArrangeMode === "owner_comp") {
        key = comp + "|||" + item.owner.toUpperCase(); // 🟢 Same Company, Same Owner
      } else if (currentArrangeMode === "owner_all") {
        key = item.owner.toUpperCase(); // 🟢 Same Owner Only
      } else {
        key = comp + "|||" + item.owner.toUpperCase() + "|||" + item.site; // Default Split
      }

      if (!groups[key]) {
        groups[key] = {
          company: currentArrangeMode === "owner_all" ? "Haka" : comp,
          owner:
            currentArrangeMode === "site"
              ? "VARIOUS OWNERS"
              : item.owner.toUpperCase(),
          items: [],
        };
      }
      groups[key].items.push(item);
    });

    let groupCount = 0;
    Object.values(groups).forEach((group) => {
      // 🟢 NEW: COMBINE ചെയ്യുമ്പോൾ Plate No A-Z ഓർഡറിൽ ആക്കാൻ (മാന്വൽ എൻട്രി)
      if (isCombinedView) {
        group.items.sort((a, b) => {
          let plateA = (a.plate_number || a.plate || "").toUpperCase();
          let plateB = (b.plate_number || b.plate || "").toUpperCase();
          return plateA.localeCompare(plateB);
        });
      }

      groupCount++;
      let newId = "manual_arr_" + Date.now() + "_" + groupCount;
      let newCard = createBillCard(group, newId);

      group.items.forEach((item, idx) => {
        let row = newCard.querySelector(`.tableBody tr:nth-child(${idx + 1})`);
        if (row) {
          row.querySelector(".nhr").value = item.temp_nhr;
          row.querySelector(".othr").value = item.temp_othr;
          calculateRow(row.querySelector(".nhr"));
        }
      });
      card.insertAdjacentElement("afterend", newCard);
    });

    card.remove();
    document.getElementById("loader").style.display = "none";
    showToast(`Arranged into ${groupCount} table(s)!`);
  }, 300);
};

function addDynamicRow(cardId) {
  const card = document.getElementById(`billCard_${cardId}`);
  const tbody = card.querySelector(".tableBody");
  const index = tbody.rows.length + 1;
  let vatCol = card.querySelector(".vat-col");
  let vatDisplay = vatCol ? vatCol.style.display : "";
  const tr = document.createElement("tr");

  // 🟢 FIXED: Changed rate strings to 0 for raw calculation
  tr.innerHTML = generateRowHTML(
    index,
    getShortDate(),
    "",
    "",
    "",
    "",
    0,
    0,
    0,
    0,
    15,
    vatDisplay,
  );
  tbody.appendChild(tr);
}

function removeDynamicRow(btn) {
  const card = btn.closest(".bill-card");
  btn.closest("tr").remove();
  let tbody = card.querySelector(".tableBody");
  Array.from(tbody.rows).forEach(
    (r, idx) => (r.querySelector(".row-num").innerText = idx + 1),
  );
  updateCardTotals(card);
}

function showSuggestions(input) {
  const val = input.value.trim().toUpperCase().replace(/\s+/g, "");
  const box = input.parentElement.querySelector(".suggestion-box");
  if (!val) {
    box.style.display = "none";
    return;
  }

  const plates = [...new Set(masterData.map((r) => r.plate_number || r.plate))];
  const matches = plates.filter(
    (p) => p && p.toUpperCase().replace(/\s+/g, "").includes(val),
  );

  if (matches.length > 0) {
    box.innerHTML = "";
    matches.forEach((match, index) => {
      let div = document.createElement("div");
      div.className = "suggestion-item";
      if (index === 0) div.classList.add("active");
      div.innerText = match;
      div.onmousedown = function (e) {
        e.preventDefault();
        input.value = match;
        box.style.display = "none";
        autoFill(input);
      };
      box.appendChild(div);
    });
    box.style.display = "block";
  } else box.style.display = "none";
}

function handlePlateBlur(input) {
  setTimeout(() => {
    let box = input.parentElement.querySelector(".suggestion-box");
    if (box) box.style.display = "none";

    autoFill(input);
  }, 200);
}

function handleGlobalKeyDown(e, input) {
  const box = input.parentElement.querySelector(".suggestion-box");
  if (box && box.style.display === "block") {
    let items = box.querySelectorAll(".suggestion-item");
    let activeIndex = Array.from(items).findIndex((item) =>
      item.classList.contains("active"),
    );

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      updateActiveSuggestion(items, activeIndex, box);
      return;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      updateActiveSuggestion(items, activeIndex, box);
      return;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      input.value =
        activeIndex > -1 ? items[activeIndex].innerText : items[0].innerText;
      box.style.display = "none";
      autoFill(input);
      return;
    }
  }
}

function updateActiveSuggestion(items, index, box) {
  items.forEach((item) => item.classList.remove("active"));
  if (items[index]) {
    items[index].classList.add("active");
    const itemTop = items[index].offsetTop;
    if (itemTop < box.scrollTop) box.scrollTop = itemTop;
    else if (
      itemTop + items[index].offsetHeight >
      box.scrollTop + box.offsetHeight
    ) {
      box.scrollTop = itemTop + items[index].offsetHeight - box.offsetHeight;
    }
  }
}

// 🟢 NEW: MULTIPLE SITES AUTOFILL POPUP LOGIC
let currentAutoFillInput = null;
let currentAutoFillMatches = [];

function autoFill(input) {
  if (document.getElementById("siteSelectionModal").style.display === "flex") {
    return;
  }

  const val = input.value.trim().toUpperCase();
  if (!val) return;

  let matches = masterData.filter(
    (d) => (d.plate_number || d.plate || "").toUpperCase() === val,
  );

  if (matches.length === 0) return;

  if (matches.length === 1) {
    applyAutoFillData(input, matches[0]);
  } else {
    // SHOW POPUP IF 2 OR MORE SITES
    currentAutoFillInput = input;
    currentAutoFillMatches = matches;

    document.getElementById("modalPlateNo").innerText = val;
    let listHtml = "";
    matches.forEach((m, idx) => {
      let siteName = m.site || m.site_name || "N/A";
      listHtml += `<label><input type="checkbox" class="modal-site-checkbox" value="${idx}"> <b>${siteName}</b> (Rate: ${m.nrate ? (m.nrate * 260).toFixed(2) : 0})</label>`;
    });
    document.getElementById("modalSiteList").innerHTML = listHtml;
    document.getElementById("modalSelectAll").checked = false;
    document.getElementById("siteSelectionModal").style.display = "flex";
  }
}

window.toggleModalSites = function (isChecked) {
  document.querySelectorAll(".modal-site-checkbox").forEach((chk) => {
    chk.checked = isChecked;
  });
};

window.closeSiteModal = function () {
  document.getElementById("siteSelectionModal").style.display = "none";
  currentAutoFillInput = null;
  currentAutoFillMatches = [];
};

window.applySiteSelection = function () {
  let checked = document.querySelectorAll(".modal-site-checkbox:checked");
  if (checked.length === 0)
    return showToast("Please select at least one site!");

  let selectedMatches = Array.from(checked).map(
    (chk) => currentAutoFillMatches[parseInt(chk.value)],
  );

  // 🟢 FIXED: ഇവിടെ 'false' എന്ന് ചേർത്തതുകൊണ്ട് ഇനി ഇടയിൽ ബ്ലാങ്ക് വരി വരില്ല!
  applyAutoFillData(currentAutoFillInput, selectedMatches[0], false);

  const row = currentAutoFillInput.closest("tr");
  const tbody = row.parentElement;
  const cardId = currentAutoFillInput
    .closest(".bill-card")
    .id.replace("billCard_", "");

  // ബാക്കിയുള്ളവയ്ക്ക് പുതിയ വരികൾ ഉണ്ടാക്കി ഫിൽ ചെയ്യുന്നു
  for (let i = 1; i < selectedMatches.length; i++) {
    addDynamicRow(cardId);
    let newRow = tbody.lastElementChild;
    let newInput = newRow.querySelector(".plate");
    newInput.value = (
      selectedMatches[i].plate_number ||
      selectedMatches[i].plate ||
      ""
    ).toUpperCase();
    applyAutoFillData(newInput, selectedMatches[i], false);
  }

  // 🟢 അവസാനം മാത്രം ഒരു ബ്ലാങ്ക് വരി കൊടുക്കാൻ
  let lastRowInput = tbody.lastElementChild.querySelector(".plate").value;
  if (lastRowInput !== "") addDynamicRow(cardId);

  closeSiteModal();
};

function applyAutoFillData(input, match, addBlankRow = true) {
  const row = input.closest("tr");

  if (match.vehicle_type || match.vtype)
    row.querySelector(".vtype").value = match.vehicle_type || match.vtype;
  if (match.driver_name || match.driver)
    row.querySelector(".driver").value = match.driver_name || match.driver;
  if (match.site || match.site_name)
    row.querySelector(".site").value = match.site || match.site_name;

  if (match.nrate) row.querySelector(".nrate").value = parseFloat(match.nrate);
  if (match.otrate)
    row.querySelector(".otrate").value = parseFloat(match.otrate);

  let vatSelect = row.querySelector(".vat-rate");
  if (vatSelect) vatSelect.value = match.vat_bill === "Yes" ? "15" : "0";

  calculateRow(input);

  if (addBlankRow) {
    const tbody = row.parentElement;
    if (row === tbody.lastElementChild) {
      const card = row.closest(".bill-card");
      const cardId = card.id.replace("billCard_", "");
      addDynamicRow(cardId);
    }
  }
}

function calculateRow(input) {
  const row = input.closest("tr");
  const card = input.closest(".bill-card");

  const nhr = parseFloat(row.querySelector(".nhr").value) || 0;
  // 🟢 FIXED: Removed .toFixed(2) from calculation to keep EXACT rate
  let nrate = parseFloat(row.querySelector(".nrate").value) || 0;
  const othr = parseFloat(row.querySelector(".othr").value) || 0;
  let otrate = parseFloat(row.querySelector(".otrate").value) || 0;

  // 🟢 FIXED: Exact calculation without early rounding
  if (input && input.classList.contains("nrate")) {
    otrate = nrate * 0.7;
    row.querySelector(".otrate").value = otrate; // Keep exact value in input
  }

  // 🟢 Rent calculation uses the EXACT rates
  const rent = nhr * nrate + othr * otrate;
  row.querySelector(".rent").value = rent.toFixed(2); // Only rent gets rounded to 2 decimals for display

  updateRowVat(row, rent);
  updateCardTotals(card);
}

function calculateFromRent(input) {
  const row = input.closest("tr");
  const card = input.closest(".bill-card");
  const rent = parseFloat(row.querySelector(".rent").value) || 0;

  row.querySelector(".nhr").value = 0;
  row.querySelector(".othr").value = 0;

  updateRowVat(row, rent);
  updateCardTotals(card);
}

function updateRowVat(row, rent) {
  let vatSelect = row.querySelector(".vat-rate");
  let vatRate = vatSelect ? parseFloat(vatSelect.value) || 0 : 0;
  let vat = rent * (vatRate / 100);
  let vatCell = row.querySelector(".vat");
  let totalCell = row.querySelector(".total");

  if (vatCell) vatCell.innerText = vat.toFixed(2);
  if (totalCell) totalCell.innerText = (rent + vat).toFixed(2);
}

function updateCardTotals(card) {
  let gRent = 0,
    gVat = 0,
    gTotal = 0,
    gNhr = 0,
    gOthr = 0;

  card.querySelectorAll(".tableBody tr").forEach((row) => {
    gNhr += parseFloat(row.querySelector(".nhr").value) || 0;
    gOthr += parseFloat(row.querySelector(".othr").value) || 0;
    gRent += parseFloat(row.querySelector(".rent").value) || 0;
    gVat += parseFloat(row.querySelector(".vat")?.innerText || 0);
    let rowTotalStr = row.querySelector(".total")?.innerText;
    gTotal += rowTotalStr
      ? parseFloat(rowTotalStr)
      : parseFloat(row.querySelector(".rent").value || 0);
  });

  card.querySelector(".grandNHr").innerText = gNhr;
  card.querySelector(".grandOTHr").innerText = gOthr;
  card.querySelector(".grandRent").innerText = gRent.toFixed(2);

  let gVatEl = card.querySelector(".grandVat");
  let gTotalEl = card.querySelector(".grandTotal");
  if (gVatEl) gVatEl.innerText = gVat.toFixed(2);
  if (gTotalEl) gTotalEl.innerText = gTotal.toFixed(2);

  let finalBal = gTotal;
  card.querySelectorAll(".adjBody tr").forEach((row) => {
    let amt = parseFloat(row.querySelector(".adj-amt").value) || 0;
    let type = row.querySelector(".adj-type").value;
    finalBal += type === "add" ? amt : -Math.abs(amt);
  });
  card.querySelector(".finalBalance").innerText = finalBal.toFixed(2);
}

function toggleCardImages(id) {
  const card = document.getElementById(`billCard_${id}`);
  card
    .querySelectorAll(".header-img, .seal, .signature-img")
    .forEach((img) => img.classList.toggle("hidden-image"));
}

function toggleCardAdjustments(id) {
  const card = document.getElementById(`billCard_${id}`);
  const sec = card.querySelector(".adjustmentsSection");
  sec.style.display = sec.style.display === "none" ? "block" : "none";
}

function addAdjRowToCard(id) {
  const card = document.getElementById(`billCard_${id}`);
  const tbody = card.querySelector(".adjBody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
        <td><input type="text" class="adj-date" placeholder="DD-MMM-YY"></td>
        <td><input type="text" class="adj-plate"></td>
        <td><input type="text" class="adj-desc"></td>
        <td><input type="number" class="adj-amt" value="0" oninput="updateCardTotals(this.closest('.bill-card'))"></td>
        <td class="no-export-col"><select class="adj-type table-select" onchange="updateCardTotals(this.closest('.bill-card'))"><option value="add">Add</option><option value="less">Less</option></select></td>
        <td class="no-export"><button class="btn-remove" onclick="this.closest('tr').remove(); updateCardTotals(this.closest('.bill-card'));">✖</button></td>
    `;
  tbody.appendChild(tr);
}

function getDynamicFileName(card) {
  let plates = [];
  let sites = [];
  card.querySelectorAll(".tableBody tr").forEach((row) => {
    let p = row.querySelector(".plate").value.trim();
    let s = row.querySelector(".site").value.trim();
    if (p) plates.push(p);
    if (s) sites.push(s);
  });

  let uniquePlates = [...new Set(plates)];
  let uniqueSites = [...new Set(sites)];
  let shortDate = getShortDate().replace(/ /g, "_");

  let ownerInput = card.querySelector(".owner-input");
  let ownerName = ownerInput ? ownerInput.value.trim() : card.dataset.owner;
  if (!ownerName) ownerName = "Manual";

  let siteStr = uniqueSites.length > 0 ? uniqueSites[0] : "Site";

  let filename = "";
  if (uniquePlates.length === 1)
    filename = `${uniquePlates[0]}_${shortDate}.png`;
  else filename = `${ownerName}_${siteStr}_${shortDate}.png`;

  return filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function convertInputsToText(card) {
  // 🟢 NEW: ഇമേജ് എടുക്കുമ്പോൾ OWNER എന്ന വരി പൂർണ്ണമായും ഹൈഡ് ചെയ്യുന്നു
  let ownerWrapper = card.querySelector(".owner-input")?.parentNode;
  if (ownerWrapper) {
    ownerWrapper.style.display = "none";
  }

  card.querySelectorAll("input").forEach((input) => {
    // ഓണറുടെ ഇൻപുട്ട് അല്ലാത്ത ബാക്കി ഇൻപുട്ടുകൾ മാത്രം സ്പാൻ (span) ആക്കി മാറ്റുന്നു
    if (input.type !== "hidden" && !input.classList.contains("owner-input")) {
      const span = document.createElement("span");
      span.className = "temp-export-span";
      span.innerText =
        input.type === "number" ? input.value || "0" : input.value;
      span.style.cssText =
        "display:block; width:100%; text-align:center; font-size:13px; padding:4px; font-weight:normal; color:#333;";

      input.style.display = "none";
      input.parentNode.appendChild(span);
    }
  });

  card
    .querySelectorAll(".no-export, .no-export-col")
    .forEach((el) => (el.style.display = "none"));
  card
    .querySelectorAll(".rate-col")
    .forEach((el) => (el.style.display = "none"));
  card
    .querySelectorAll(".site-col")
    .forEach((el) => (el.style.display = "none"));

  let footerColspan = card.querySelector(".footer-colspan");
  if (footerColspan) footerColspan.colSpan = 5;

  let grandVat = parseFloat(card.querySelector(".grandVat")?.innerText || 0);
  if (grandVat === 0) {
    card
      .querySelectorAll(".vat-col")
      .forEach((el) => (el.style.display = "none"));
  } else {
    card.querySelectorAll(".vat-col").forEach((el) => (el.style.display = ""));
  }
}

function revertInputsFromText(card) {
  // 🟢 NEW: എക്സ്പോർട്ട് കഴിഞ്ഞ ശേഷം OWNER വരി സ്ക്രീനിൽ തിരികെ കൊണ്ടുവരുന്നു
  let ownerWrapper = card.querySelector(".owner-input")?.parentNode;
  if (ownerWrapper) {
    ownerWrapper.style.display = "";
  }

  card.querySelectorAll(".temp-export-span").forEach((el) => el.remove());
  card.querySelectorAll("input").forEach((input) => (input.style.display = ""));

  card
    .querySelectorAll(".no-export, .no-export-col")
    .forEach((el) => (el.style.display = ""));
  card.querySelectorAll(".rate-col").forEach((el) => (el.style.display = ""));
  card.querySelectorAll(".site-col").forEach((el) => (el.style.display = ""));

  let footerColspan = card.querySelector(".footer-colspan");
  if (footerColspan) footerColspan.colSpan = 6;

  let hasVat = false;
  card.querySelectorAll(".vat-rate").forEach((sel) => {
    if (parseFloat(sel.value) > 0) hasVat = true;
  });
  if (card.id.includes("manual_")) hasVat = true;

  card.querySelectorAll(".vat-col").forEach((el) => {
    el.style.display = hasVat ? "" : "none";
  });
}

async function exportSingleImage(id) {
  const card = document.getElementById(`billCard_${id}`);
  const printArea = document.getElementById(`printArea_${id}`);
  const filename = getDynamicFileName(card);

  convertInputsToText(printArea);
  const canvas = await html2canvas(printArea, { scale: 3, useCORS: true });
  revertInputsFromText(printArea);

  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function shareSingleWhatsApp(id) {
  const card = document.getElementById(`billCard_${id}`);
  const printArea = document.getElementById(`printArea_${id}`);
  const filename = getDynamicFileName(card);

  convertInputsToText(printArea);
  const canvas = await html2canvas(printArea, { scale: 3, useCORS: true });
  revertInputsFromText(printArea);

  canvas.toBlob(
    async (blob) => {
      try {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
        } else {
          showToast("Direct Share not supported. Downloading instead.");
          exportSingleImage(id);
        }
      } catch (error) {
        showToast("Share cancelled.");
      }
    },
    "image/png",
    1.0,
  );
}

async function downloadAllAsZip() {
  const cards = document.querySelectorAll(".bill-card");
  if (cards.length === 0) return showToast("No bills to download!");

  document.getElementById("loader").style.display = "flex";
  document.getElementById("loaderText").innerText =
    "Creating ZIP file... Please wait.";

  const zip = new JSZip();
  let shortDate = getShortDate().replace(/ /g, "_");

  for (let i = 0; i < cards.length; i++) {
    let card = cards[i];
    let printArea = card.querySelector(".print-area");
    let filename = getDynamicFileName(card);

    convertInputsToText(printArea);
    const canvas = await html2canvas(printArea, { scale: 3, useCORS: true });
    revertInputsFromText(printArea);

    let imgData = canvas.toDataURL("image/png").split("base64,")[1];
    zip.file(filename, imgData, { base64: true });
  }

  zip.generateAsync({ type: "blob" }).then(function (content) {
    saveAs(content, `Haka_Bulk_Bills_${shortDate}.zip`);
    document.getElementById("loader").style.display = "none";
    showToast("ZIP Downloaded Successfully!");
  });
}

function submitBulkData() {
  const fullMonth = document
    .getElementById("selectedMonthText")
    .innerText.trim();
  const token = localStorage.getItem("token");
  const cards = document.querySelectorAll(".bill-card");

  if (!fullMonth || cards.length === 0)
    return showToast("No generated bills to save.");

  const dataToUpdate = [];

  cards.forEach((card) => {
    let company = card.dataset.company || "Haka";
    let ownerInput = card.querySelector(".owner-input");
    let fallbackOwner = ownerInput
      ? ownerInput.value.trim()
      : card.dataset.owner;

    let adjDescStr = "";
    let adjAmtTotal = 0;
    card.querySelectorAll(".adjBody tr").forEach((adjRow) => {
      let date = adjRow.querySelector(".adj-date").value.trim();
      let plate = adjRow.querySelector(".adj-plate").value.trim();
      let desc = adjRow.querySelector(".adj-desc").value.trim();
      let fullDesc = `${date} ${plate} ${desc}`.trim();

      let amt = parseFloat(adjRow.querySelector(".adj-amt").value) || 0;
      let type = adjRow.querySelector(".adj-type").value;
      if (type === "less") amt = -Math.abs(amt);

      if (fullDesc || amt !== 0) {
        adjDescStr += (adjDescStr ? ", " : "") + fullDesc;
        adjAmtTotal += amt;
      }
    });

    card.querySelectorAll(".tableBody tr").forEach((row) => {
      let plate = row.querySelector(".plate").value.trim();
      if (plate) {
        let rentVal = parseFloat(row.querySelector(".rent").value) || 0;
        let vatAmt = parseFloat(row.querySelector(".vat")?.innerText || 0);
        let totalVal = rentVal + vatAmt;

        // 🟢 FIX 1: FIND REAL OWNER FOR EACH PLATE (VARIOUS OWNERS എന്ന് സേവ് ആവാതിരിക്കാൻ)
        let realOwner = fallbackOwner;
        let masterMatch = masterData.find(
          (m) =>
            (m.plate_number || m.plate || "").toUpperCase() ===
            plate.toUpperCase(),
        );

        if (
          masterMatch &&
          masterMatch.owner &&
          masterMatch.owner.trim() !== ""
        ) {
          realOwner = masterMatch.owner.trim(); // DB-ൽ നിന്നുള്ള ഒറിജിനൽ ഓണർ
        } else if (realOwner === "VARIOUS OWNERS") {
          realOwner = "COMPANY VEHICLE"; // ഒരു കാരണവശാലും VARIOUS OWNERS എന്ന് സേവ് ആവാതിരിക്കാൻ
        }

        dataToUpdate.push({
          date: row.querySelector(".date-cell").innerText.trim(),
          owner: realOwner, // 🟢 ഒറിജിനൽ ഓണറെ മാത്രം സേവ് ചെയ്യുന്നു
          company: company,
          site_name: row.querySelector(".site").value,
          vtype: row.querySelector(".vtype").value,
          driver: row.querySelector(".driver").value,
          plate: plate,
          nhr: parseFloat(row.querySelector(".nhr").value) || 0,
          nrate: parseFloat(row.querySelector(".nrate").value) || 0,
          othr: parseFloat(row.querySelector(".othr").value) || 0,
          otrate: parseFloat(row.querySelector(".otrate").value) || 0,
          rent: rentVal,
          vat_percent: parseFloat(row.querySelector(".vat-rate")?.value || 0),
          vat_amount: vatAmt,
          total: totalVal,
          adjustment_desc: adjDescStr,
          adjusted_amount: adjAmtTotal,
          after_adjustment: totalVal + adjAmtTotal,
        });
      }
    });
  });

  document.getElementById("loader").style.display = "flex";
  document.getElementById("loaderText").innerText = "Saving to ERP...";

  fetch("/billing/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ billing_period: fullMonth, items: dataToUpdate }),
  })
    .then((res) => res.json())
    .then((res) => {
      document.getElementById("loader").style.display = "none";
      if (res.success) {
        showToast("All Bulk Bills Saved to ERP!");
        // 🟢 FIX 2: മാന്വൽ ഡാറ്റ മായാതിരിക്കാൻ സേവ് ആയ ശേഷം തനിയെ ഒന്ന് ഫെച്ച് (Refresh) ചെയ്യുന്നു
        setTimeout(() => fetchDataFromERP(), 1000);
      } else {
        showToast("Error: " + res.message);
      }
    })
    .catch((err) => {
      document.getElementById("loader").style.display = "none";
      showToast("Error saving data.");
    });
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.className = "show";
  setTimeout(() => (t.className = ""), 3000);
}

document.addEventListener("keydown", function (e) {
  const target = e.target;

  if (
    !target.closest(".billTable") ||
    (target.tagName !== "INPUT" && target.tagName !== "SELECT")
  )
    return;

  if (target.classList.contains("plate")) {
    const box = target.parentElement.querySelector(".suggestion-box");
    if (
      box &&
      box.style.display === "block" &&
      (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter")
    ) {
      return;
    }
  }

  const td = target.closest("td");
  const tr = target.closest("tr");
  const tbody = target.closest("tbody");
  if (!td || !tr || !tbody) return;

  const cellIndex = Array.from(tr.children).indexOf(td);
  const rowIndex = Array.from(tbody.children).indexOf(tr);

  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();

    let targetRow =
      e.key === "ArrowUp"
        ? tbody.children[rowIndex - 1]
        : tbody.children[rowIndex + 1];
    if (targetRow) {
      let targetTd = targetRow.children[cellIndex];
      if (targetTd) {
        let nextInput = targetTd.querySelector("input, select");
        if (nextInput) {
          nextInput.focus();
          if (nextInput.select) nextInput.select();
        }
      }
    }
  }

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    let shouldMove = false;

    if (target.type === "number" || target.tagName === "SELECT") {
      shouldMove = true;
    } else if (target.type === "text") {
      if (e.key === "ArrowLeft" && target.selectionStart === 0)
        shouldMove = true;
      if (e.key === "ArrowRight" && target.selectionEnd === target.value.length)
        shouldMove = true;
    }

    if (shouldMove) {
      e.preventDefault();
      let allInputs = Array.from(
        tr.querySelectorAll('input:not([style*="display: none"]), select'),
      );
      let currentIndex = allInputs.indexOf(target);

      let nextInput =
        e.key === "ArrowLeft"
          ? allInputs[currentIndex - 1]
          : allInputs[currentIndex + 1];
      if (nextInput) {
        nextInput.focus();
        if (nextInput.select) nextInput.select();
      }
    }
  }
});

function goToDashboard() {
  window.location.href = "/billing/dashboard";
}
