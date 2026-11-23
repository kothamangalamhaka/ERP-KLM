document.addEventListener("DOMContentLoaded", () => {
  if (sessionStorage.getItem("emp_token")) {
    unlockPage();
  } else {
    document.getElementById("entryPin").focus();
  }
});

async function verifyEntryPin() {
  const pin = document.getElementById("entryPin").value;
  try {
    const res = await fetch("/api/employees/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem("emp_token", data.token);
      unlockPage();
    } else {
      showToast("Incorrect Security Code!", false);
      document.getElementById("entryPin").value = "";
    }
  } catch (err) {
    showToast("Server Error. Check connection.", false);
  }
}

function unlockPage() {
  document.getElementById("pageBlocker").style.display = "none";
  document.getElementById("mainContent").style.display = "block";
  loadEmployees();
}

function goBackToReport() {
  window.location.href = "./Employee_Timesheet_Card.html";
}

async function loadEmployees() {
  const token = sessionStorage.getItem("emp_token");
  if (!token) return;

  try {
    const response = await fetch("/api/employees", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Unauthorized");

    const employees = await response.json();
    const tableBody = document.getElementById("employeeTableBody");
    tableBody.innerHTML = "";

    employees.forEach((emp) => {
      const statusColor = emp.status === "Active" ? "green" : "red";
      const row = `<tr>
                        <td>${emp.name}</td>
                        <td>${emp.mobile || "-"}</td>
                        <td>${emp.base_salary || 0}</td>
                        <td>${emp.shift_hours || 0}</td>
                        <td style="color: ${statusColor}; font-weight: bold;">${emp.status || "Active"}</td>
                        <td>
                            <button class="action-btn" onclick="editEmployee('${emp.id}', '${emp.name}', '${emp.mobile || ""}', '${emp.base_salary}', '${emp.shift_hours}', '${emp.mobile_allowance || 0}', '${emp.start_date || ""}', '${emp.end_date || ""}')">Edit</button>
                            <button class="action-btn" style="background: #0284c7; margin-left: 5px;" onclick="openHikeModal('${emp.id}', '${emp.name}')">Salary Hike</button>
                        </td>
                    </tr>`;
      tableBody.innerHTML += row;
    });
  } catch (error) {
    console.error("Error loading employees:", error);
    sessionStorage.removeItem("emp_token");
    window.location.reload();
  }
}

function openModal() {
  document.getElementById("modalTitle").innerText = "Register New Employee";
  document.getElementById("empId").value = "";
  document.getElementById("empName").value = "";
  document.getElementById("empMobile").value = "";
  document.getElementById("baseSalary").value = "20000";
  document.getElementById("shiftHrs").value = "10";
  document.getElementById("mobileAllowance").value = "0"; // Newly Added
  document.getElementById("startDate").value = "";
  document.getElementById("endDate").value = "";
  document.getElementById("regModal").style.display = "block";
}

function closeModal() {
  document.getElementById("regModal").style.display = "none";
}

function editEmployee(id, name, mobile, baseSal, shiftHrs, mobileAllowance, start, end) {
  document.getElementById("modalTitle").innerText = "Edit Employee";
  document.getElementById("empId").value = id;
  document.getElementById("empName").value = name;
  document.getElementById("empMobile").value = mobile;
  document.getElementById("baseSalary").value = baseSal;
  document.getElementById("shiftHrs").value = shiftHrs;
  document.getElementById("mobileAllowance").value = mobileAllowance; // Newly Added
  document.getElementById("startDate").value = start;
  document.getElementById("endDate").value = end;
  document.getElementById("regModal").style.display = "block";
}

function showToast(message, isSuccess = true) {
  const toast = document.getElementById("toastMessage");
  toast.innerText = message;
  toast.className = isSuccess ? "toast show success" : "toast show error";

  if (document.getElementById("pageBlocker").style.display !== "none") {
    toast.style.zIndex = "10000";
  }

  setTimeout(() => {
    toast.className = toast.className.replace("show", "");
  }, 3000);
}

async function saveEmployee() {
  const id = document.getElementById("empId").value;
  const data = {
    name: document.getElementById("empName").value,
    mobile: document.getElementById("empMobile").value,
    base_salary: parseFloat(document.getElementById("baseSalary").value) || 0,
    shift_hours: parseFloat(document.getElementById("shiftHrs").value) || 0,
    mobile_allowance:
      parseFloat(document.getElementById("mobileAllowance").value) || 0, // NEW
    start: document.getElementById("startDate").value,
    end: document.getElementById("endDate").value,
  };

  if (!data.name) return showToast("Name is required!", false);

  const method = id ? "PUT" : "POST";
  const url = id ? `/api/employees/${id}` : "/api/employees/new";
  const token = sessionStorage.getItem("emp_token");

  try {
    const res = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      showToast("Employee Data Saved!");
      closeModal();
      loadEmployees();
    } else {
      showToast("Failed to save data.", false);
    }
  } catch (error) {
    showToast("Server Error", false);
  }
}

async function openHikeModal(empId, empName) {
  document.getElementById("hikeEmpId").value = empId;
  document.getElementById("hikeModalTitle").innerText = `Salary Hike - ${empName}`;
  document.getElementById("hikeBaseSalary").value = "";
  document.getElementById("hikeStartDate").value = "";
  document.getElementById("hikeModal").style.display = "block";
  await loadSalaryHistory(empId);
}

function closeHikeModal() {
  document.getElementById("hikeModal").style.display = "none";
}

async function loadSalaryHistory(empId) {
  const token = sessionStorage.getItem("emp_token");
  try {
    const res = await fetch(`/api/employees/${empId}/salary-history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const history = await res.json();
    const tbody = document.getElementById("hikeHistoryBody");
    tbody.innerHTML = "";

    if (!history.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:8px; color:#888;">No hike records found</td></tr>`;
      return;
    }

    history.forEach((item) => {
      const endDisp = item.end_date ? item.end_date.split("T")[0] : "<span style='color:green;font-weight:bold;'>Ongoing</span>";
      tbody.innerHTML += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 6px; font-weight: bold;">${parseFloat(item.base_salary).toFixed(2)}</td>
          <td style="padding: 6px;">${item.start_date.split("T")[0]}</td>
          <td style="padding: 6px;">${endDisp}</td>
          <td style="padding: 6px; text-align: center;">
            <button class="del-btn" style="color:#ef4444; border:none; background:transparent; cursor:pointer;" onclick="deleteSalaryHike('${item.id}', '${empId}')">✖</button>
          </td>
        </tr>
      `;
    });
  } catch (err) {
    showToast("Error loading salary history", false);
  }
}

async function saveSalaryHike() {
  const empId = document.getElementById("hikeEmpId").value;
  const baseSalary = parseFloat(document.getElementById("hikeBaseSalary").value);
  const startDate = document.getElementById("hikeStartDate").value;
  const token = sessionStorage.getItem("emp_token");

  if (!baseSalary || !startDate) {
    return showToast("Base Salary and Effective Date are required!", false);
  }

  try {
    const res = await fetch(`/api/employees/${empId}/salary-history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ base_salary: baseSalary, start_date: startDate }),
    });

    if (res.ok) {
      showToast("Salary hike recorded!");
      document.getElementById("hikeBaseSalary").value = "";
      document.getElementById("hikeStartDate").value = "";
      await loadSalaryHistory(empId);
      loadEmployees();
    } else {
      showToast("Failed to save salary hike", false);
    }
  } catch (err) {
    showToast("Server Error", false);
  }
}

async function deleteSalaryHike(hikeId, empId) {
  if (!confirm("Are you sure you want to delete this salary record?")) return;
  const token = sessionStorage.getItem("emp_token");
  try {
    const res = await fetch(`/api/employees/salary-history/${hikeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      showToast("Record deleted!");
      await loadSalaryHistory(empId);
      loadEmployees();
    } else {
      showToast("Failed to delete record", false);
    }
  } catch (err) {
    showToast("Server Error", false);
  }
}
